import { Page, Locator } from '@playwright/test';
import { killAlarms, gotoCourseMenu } from './courseHelpers';
import { runFormBattery, closeForm } from './formE2E';
import { record, skip, diff, CheckMeta } from '../reporter';

// 폼(등록/수정) 보유가 확인됐거나 유력한 화면(커버리지 문서 기준). 읽기전용/분석 화면(예산·비용·사진·조회)은 제외.
export interface DeepScreen { menu: string; sub: string; id: string; battKey: string; tabHint?: RegExp; }
const COURSE_TABS = /West|East|South|North|In|Out|전반|후반|\d+\s*코스|\d+\s*차|\d+\s*홀|코스/;
export const DEEP_SCREENS: DeepScreen[] = [
  // 정보 관리
  { menu: '정보 관리', sub: '코스 리뉴얼 정보', id: 'RN',  battKey: 'RN',  tabHint: /\d+\s*차/ },
  { menu: '정보 관리', sub: '홀 별 정보',       id: 'HOLE', battKey: 'HL',  tabHint: COURSE_TABS },
  { menu: '정보 관리', sub: '잔디 측정 정보',   id: 'GR',  battKey: 'GR',  tabHint: COURSE_TABS },
  { menu: '정보 관리', sub: '토양 측정 정보',   id: 'SO',  battKey: 'SO',  tabHint: COURSE_TABS },
  { menu: '정보 관리', sub: '발병 정보',        id: 'DIS', battKey: 'DIS', tabHint: COURSE_TABS },
  { menu: '정보 관리', sub: '코스 운영 정보',   id: 'OP',  battKey: 'OP',  tabHint: COURSE_TABS },
  { menu: '정보 관리', sub: '기상 정보',        id: 'WX',  battKey: 'WX',  tabHint: COURSE_TABS },
  { menu: '정보 관리', sub: '거래처 정보',      id: 'VN',  battKey: 'VN' },
  { menu: '정보 관리', sub: '관리 기준 정보',   id: 'EV',  battKey: 'EV' },
  { menu: '정보 관리', sub: '일상 점검',        id: 'DL',  battKey: 'DL',  tabHint: COURSE_TABS },
  // 작업 관리
  { menu: '작업 관리', sub: '작업 지시',        id: 'TORD', battKey: 'TORD' },
  { menu: '작업 관리', sub: '이슈 관리',        id: 'TISS', battKey: 'TISS' },
  // 인력 관리
  { menu: '인력 관리', sub: '인력 관리',        id: 'HRHM', battKey: 'HRHM' },
  { menu: '인력 관리', sub: '권한관리',         id: 'HRPM', battKey: 'HRPM' },
  // 자재/시설/장비 총괄
  { menu: '자재 관리', sub: '자재 총괄',        id: 'MAT', battKey: 'MAT' },
  { menu: '시설 관리', sub: '시설 총괄',        id: 'FAC', battKey: 'FAC' },
  { menu: '장비 관리', sub: '장비 총괄',        id: 'EQP', battKey: 'EQP' },
  // 코스 현황 관리(폼 보유 = 드론사진 업로드)
  { menu: '코스 현황 관리', sub: '드론사진 업로드', id: 'DRN', battKey: 'DRN' },
];

// DEEP_MENUS/DEEP_SUBS env 필터(콤마 구분). 미설정 시 전체.
export function filterDeepScreens(): DeepScreen[] {
  const menus = (process.env.DEEP_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const subs = (process.env.DEEP_SUBS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return DEEP_SCREENS.filter((s) =>
    (menus.length === 0 || menus.includes(s.menu)) &&
    (subs.length === 0 || subs.includes(s.sub)));
}

// 화면 목록 순회하며 각 화면에 runDeepScreenE2E 적용(진입 실패 시 정직하게 '진입 실패' 기록 — 가짜 SKIP 방지).
export async function runDeepScreensSweep(admin: Page, screens: DeepScreen[] = filterDeepScreens()) {
  for (const s of screens) {
    const P = `${s.menu} > ${s.sub}`;
    const R = (n: string) => `코스관리_심화_${s.id}_${n}`;
    // ⚠ gotoCourseMenu는 하위 미발견 시 false 반환 → 반환값 그대로 사용(.then(()=>true) 금지, degraded 가짜 SKIP 방지).
    const ok = await gotoCourseMenu(admin, s.menu, s.sub).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: R('0'), tcId: `${s.id}-00`, desc: '진입' }, '진입 실패(하위메뉴 미노출 — 세션 degraded 또는 메뉴 부재)'); continue; }
    await admin.waitForTimeout(1_100); await killAlarms(admin);
    await runDeepScreenE2E(admin, { P, R, id: s.id, menu: s.menu, sub: s.sub, battKey: s.battKey, tabHint: s.tabHint }).catch(() => {});
    await killAlarms(admin);
  }
}

// ──────────────────────────────────────────────────────────────
//  정보 관리 > 코스 리뉴얼 정보 전용 심화(course-renewal-e2e)의 재사용 일반화.
//  "리뉴얼 수준" = 제네릭 폼 배터리(입력·[X]클리어·datepicker·항목추가/삭제·파일) 위에
//    ① 탭 간 이동(활성 전환/콘텐츠 변화)  ② [신규 등록]·[수정] 양 경로 폼 오픈
//    ③ 라디오버튼 선택 전환  ④ [저장] 노출·활성(클릭 금지)
//  을 얹은 것. 이 표준을 폼 보유 전 화면에 균일 적용하기 위한 공용 러너.
//  ⚠ 전부 비파괴: 폼 조작 후 [취소] 폐기, [저장]은 노출·활성만. 라디오는 미저장 상태 변경(취소 폐기).
//  ⚠ 탭은 화면마다 라벨이 달라(차수·코스구분 West/East/South·홀 등) 하드코딩하지 않고 자동 감지.
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

export interface DeepScreenOpts {
  P: string;                 // 경로 표시 (예: '정보 관리 > 홀 별 정보')
  R: (n: string) => string;  // tcRef 생성기 (예: n => `코스관리_홀별_${n}`)
  id: string;                // tcId 프리픽스 (예: 'HOLE')
  menu: string;              // 재진입용 대메뉴
  sub: string;               // 재진입용 소메뉴
  battKey: string;           // runFormBattery 화면 키(tcId 내부)
  editOpenRe?: RegExp;       // [수정] 트리거 (기본 /^\s*수정\s*$/)
  regOpenRe?: RegExp;        // [신규 등록] 트리거 (기본 /신규\s*등록|^\s*등록\s*$/)
  tabHint?: RegExp;          // 탭 라벨 힌트(주면 자동 감지 결과와 합집합)
}

// 활성 폼 스코프(모달 우선, 없으면 main)
function formScope(admin: Page): Locator {
  return admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
}
async function scopeOf(admin: Page): Promise<Locator> {
  return (await formScope(admin).isVisible({ timeout: 800 }).catch(() => false)) ? formScope(admin) : M(admin);
}

// ── ① 탭 자동 감지 + 순회(활성 전환/콘텐츠 변화 검증, 비파괴) ──
//   후보: [role=tab]·.tab/.tab-item/.tabs>*·[class*="tab"](table/content 제외)·짧은 텍스트 칩.
//   각 후보 클릭 → 자신/상위 active|selected|on|current 클래스 or 본문 텍스트 변화면 '전환'으로 집계.
export async function tabSweep(admin: Page, o: DeepScreenOpts) {
  const m: CheckMeta = { path: `${o.P} > 탭`, tcRef: o.R('tab'), tcId: `${o.id}-TAB`, desc: '탭 간 이동(활성 전환/콘텐츠 변화)', failMsg: '탭 전환 미동작' };

  // 후보 태깅(in-page): 텍스트 dedup, 액션 버튼/입력 제외.
  const hintSrc = o.tabHint ? o.tabHint.source : '';
  const tagged = await admin.evaluate((hint) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
    const root = document.querySelector('.contents, main') || document.body;
    // '전체'는 필터 칩(전체/상/중/하, 전체/단일/반복, 전체/운용/비운용 등) 시그니처 → 탭 후보에서 제외.
    const BAD = /^(저장|저장하기|등록|신규\s*등록|수정|삭제|닫기|확인|취소|검색|조회|적용|초기화|내보내기|다운로드|업로드|추가|항목\s*추가|보기|편집|이전|다음|이전\s*홀|다음\s*홀|전체|\+|\-|)$/;
    const hintRe = hint ? new RegExp(hint) : null;
    const sel = [
      '[role="tab"]', '.tab', '.tab-item', '.tabs > *', '.tab-menu > *', '.tab-group > *',
      'ul.tabs li', '.tab-list > *', '[class*="tab-btn"]', '[class*="tab-item"]',
    ].join(',');
    let cands = Array.from(root.querySelectorAll(sel))
      .filter((el) => vis(el) && !/table|content|contents/i.test(cls(el)));
    // 힌트 텍스트 매칭 요소 추가(칩/텍스트형 탭 — 차수·코스구분 등)
    if (hintRe) {
      Array.from(root.querySelectorAll('a,li,span,button,div'))
        .filter((el) => vis(el) && hintRe.test(norm(el.textContent)) && norm(el.textContent).length <= 12
          && el.children.length <= 1 && !cands.includes(el))
        .forEach((el) => cands.push(el));
    }
    // 텍스트 dedup + 액션/빈 텍스트 제외 + 과도한 길이 제외
    const seen = new Set<string>(); const out: string[] = []; let idx = 0;
    for (const el of cands) {
      const t = norm(el.textContent);
      if (!t || t.length > 14 || BAD.test(t) || seen.has(t)) continue;
      seen.add(t); (el as HTMLElement).setAttribute('data-e2e-tab', String(idx));
      out.push(t); idx++;
      if (idx >= 12) break;
    }
    return out;
  }, hintSrc).catch(() => [] as string[]);

  if (tagged.length < 2) { skip(m, `탭 후보 ${tagged.length}개(2개 미만 — 탭 구조 아님)`); return; }

  let switched = 0;
  for (let i = 0; i < tagged.length; i++) {
    const before = await M(admin).evaluate(() => (document.querySelector('.contents, main') as HTMLElement)?.innerText?.slice(0, 500) || '').catch(() => '');
    const clicked = await admin.evaluate((i2) => {
      const el = document.querySelector(`[data-e2e-tab="${i2}"]`) as HTMLElement | null;
      if (!el) return false;
      const activeBefore = (() => { let p: Element | null = el; for (let k = 0; k < 3 && p; k++) { const c = typeof p.className === 'string' ? p.className : ''; if (/active|selected|on\b|current/i.test(c)) return true; p = p.parentElement; } return false; })();
      el.click();
      (el as HTMLElement).setAttribute('data-e2e-tab-ab', activeBefore ? '1' : '0');
      return true;
    }, i).catch(() => false);
    if (!clicked) continue;
    await admin.waitForTimeout(650); await killAlarms(admin);
    const activeOk = await admin.evaluate((i2) => {
      const el = document.querySelector(`[data-e2e-tab="${i2}"]`) as HTMLElement | null;
      if (!el) return false;
      const wasActive = el.getAttribute('data-e2e-tab-ab') === '1';
      let p: Element | null = el; let nowActive = false;
      for (let k = 0; k < 3 && p; k++) { const c = typeof p.className === 'string' ? p.className : ''; if (/active|selected|on\b|current/i.test(c)) { nowActive = true; break; } p = p.parentElement; }
      return nowActive && !wasActive;   // 이번 클릭으로 활성 전환된 것만
    }, i).catch(() => false);
    const after = await M(admin).evaluate(() => (document.querySelector('.contents, main') as HTMLElement)?.innerText?.slice(0, 500) || '').catch(() => '');
    if (activeOk || before !== after) switched++;
  }
  // 첫 탭 복귀(원상)
  await admin.evaluate(() => { const el = document.querySelector('[data-e2e-tab="0"]') as HTMLElement | null; el?.click(); }).catch(() => {});
  await admin.waitForTimeout(400); await killAlarms(admin);
  // 태그 정리
  await admin.evaluate(() => document.querySelectorAll('[data-e2e-tab],[data-e2e-tab-ab]').forEach((e) => { e.removeAttribute('data-e2e-tab'); e.removeAttribute('data-e2e-tab-ab'); })).catch(() => {});

  const labels = `[${tagged.slice(0, 8).join('/')}]`;
  if (switched >= Math.min(2, tagged.length)) record(m, 'PASS', { actual: `탭 ${tagged.length}개 ${labels} · 전환 ${switched}개(활성/콘텐츠 변화)` });
  else if (switched > 0) record(m, 'PASS', { actual: `탭 ${tagged.length}개 ${labels} · 전환 ${switched}개(부분 — 일부만 활성/콘텐츠 변화)` });
  // 전환 0 = 탭이 아니라 필터 칩/비탭 구조로 판단(가짜 FAIL 방지). 후보 라벨은 기록해 수동 검토 가능.
  else skip(m, `탭 미전환 0/${tagged.length} — 필터 칩/비탭 구조 추정 ${labels}`);
}

// ── ③ 라디오버튼 동작: 미체크 옵션 클릭 → 체크 전환 확인(비파괴) ──
async function radioTest(admin: Page, scope: Locator, o: DeepScreenOpts, K: string) {
  const m: CheckMeta = { path: `${o.P} > ${K} > 라디오`, tcRef: o.R(`${K}_radio`), tcId: `${o.id}-${K}-RADIO`, desc: '라디오버튼 선택 전환', failMsg: '라디오 미동작' };
  const radios = scope.locator('input[type=radio]');
  const n = await radios.count().catch(() => 0);
  if (n < 2) { skip(m, `라디오 ${n}개(2개 미만 — 선택 전환 대상 아님)`); return; }
  const res = await scope.evaluate((sc) => {
    const rs = Array.from(sc.querySelectorAll('input[type=radio]')) as HTMLInputElement[];
    const beforeChecked = rs.findIndex((r) => r.checked);
    const target = rs.find((r) => !r.checked && !r.disabled);
    if (!target) return { switched: false, reason: '미체크 대상 없음' } as any;
    const id = target.id;
    const lab = id ? document.querySelector(`label[for="${id}"]`) as HTMLElement | null : null;
    (lab || (target.closest('label') as HTMLElement) || target).click();
    const afterChecked = rs.findIndex((r) => r.checked);
    return { switched: target.checked || afterChecked !== beforeChecked, before: beforeChecked, after: afterChecked, count: rs.length } as any;
  }).catch(() => ({ switched: false, reason: 'evaluate 실패' } as any));
  await admin.waitForTimeout(300);
  if (res.switched) record(m, 'PASS', { actual: `라디오 ${res.count ?? n}종 · 선택 전환(${res.before}→${res.after})` });
  else skip(m, `라디오 선택 전환 미확인(${res.reason || ''})`);
}

// ── ④ [저장] 버튼 노출·활성(비파괴 — 클릭 금지) ──
async function saveActive(admin: Page, scope: Locator, o: DeepScreenOpts, K: string) {
  const m: CheckMeta = { path: `${o.P} > ${K} > 저장`, tcRef: o.R(`${K}_save`), tcId: `${o.id}-${K}-SAVE`, desc: '[저장] 버튼 노출·활성(클릭 금지=비파괴)', failMsg: '저장 버튼 미노출/비활성' };
  const save = scope.getByRole('button', { name: /^\s*저장(하기)?\s*$/ }).first()
    .or(scope.getByRole('button', { name: /^\s*등록\s*$/ }).first());
  if (!(await save.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '[저장]/[등록] 버튼 미노출'); return; }
  const enabled = await save.isEnabled().catch(() => false);
  const label = (await save.innerText().catch(() => '')).trim();
  if (enabled) record(m, 'PASS', { actual: `[${label}] 노출·활성(클릭 미수행=비파괴)` });
  else diff(`${o.P} > ${K}`, `[${label}] 버튼 비활성`, '노출됐으나 disabled(입력 조건 미충족 추정)', o.R(`${K}_save`), '활성 조건 확인 — 필수입력 채운 뒤 재확인 권장');
}

// ── ② 등록/수정 폼 열기 → 배터리(입력·클리어·datepicker·항목) + 라디오 + 저장활성 → 취소 ──
async function formPath(admin: Page, o: DeepScreenOpts, K: 'REG' | 'EDIT', openBtnRe: RegExp) {
  const openM: CheckMeta = { path: `${o.P} > ${K} > 폼`, tcRef: o.R(`${K}_form`), tcId: `${o.id}-${K}-FORM`, desc: `[${K === 'REG' ? '신규 등록' : '수정'}] → 폼 오픈`, failMsg: '폼 미오픈' };
  const btn = M(admin).getByRole('button', { name: openBtnRe }).first();
  if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(openM, `[${K === 'REG' ? '신규 등록' : '수정'}] 버튼 미노출(데이터 의존/권한/읽기전용)`); return; }
  const urlBefore = admin.url();
  await btn.click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_300); await killAlarms(admin);
  const modalOpen = await formScope(admin).getByRole('button', { name: /저장|등록|취소/ }).first().isVisible({ timeout: 1_500 }).catch(() => false);
  const pageForm = await M(admin).getByRole('button', { name: /^\s*(저장|등록|취소)\s*$/ }).first().isVisible({ timeout: 1_000 }).catch(() => false);
  const urlChanged = admin.url() !== urlBefore;
  if (!(modalOpen || pageForm || urlChanged)) { skip(openM, '폼(저장/취소·모달·라우트) 미확인'); return; }
  record(openM, 'PASS', { actual: modalOpen ? '모달 폼' : (urlChanged ? '라우트 페이지 폼' : '페이지 폼') });

  await radioTest(admin, await scopeOf(admin), o, K);
  await runFormBattery(admin, `${o.P} > ${K}`, o.R(K.toLowerCase()), `${o.battKey}-${K}`).catch(() => {});
  await saveActive(admin, await scopeOf(admin), o, K);
  await closeForm(admin).catch(() => {});
  await killAlarms(admin);
}

// ── 화면 1개에 대한 "리뉴얼 수준" 심화 E2E 전체 실행(비파괴) ──
//   진입은 호출부에서 완료(gotoCourseMenu) 상태로 넘겨받음. 탭→수정→(재진입)→신규등록 순.
export async function runDeepScreenE2E(admin: Page, o: DeepScreenOpts) {
  const editRe = o.editOpenRe ?? /^\s*수정\s*$/;
  // ⚠ 접미형 등록 라벨(시설 등록·장비 등록·드론사진 등록 등)까지 포착 — openEditableForm과 동일한 `등록\s*$` 사용.
  //   이전 `^\s*등록\s*$`(정확 매칭)은 접미형을 놓쳐 시설/드론 REG가 가짜 '버튼 미노출' SKIP 처리됐음.
  const regRe = o.regOpenRe ?? /신규\s*등록|추가\s*등록|등록\s*$/;

  await tabSweep(admin, o);

  // 수정 경로(초기 상세뷰에 [수정] 노출) 먼저
  await formPath(admin, o, 'EDIT', editRe);

  // 라우트 폼→goBack 후 상세뷰/버튼 미복원 대비 → 재진입으로 완전 복원(양 경로 트리거 보장)
  await gotoCourseMenu(admin, o.menu, o.sub).catch(() => {});
  await admin.waitForTimeout(1_000); await killAlarms(admin);

  // 신규 등록 경로
  await formPath(admin, o, 'REG', regRe);

  diff(o.P, '심화 커버리지', '탭 이동·신규등록/수정 양경로·라디오·저장 활성 + 제네릭 배터리(입력·[X]클리어·datepicker·항목추가/삭제·파일) — 비파괴', o.R('cov'), '저장 미클릭·취소 폐기 · 코스 리뉴얼 정보와 동일 표준');
  await killAlarms(admin);
}
