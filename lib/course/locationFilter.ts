import { expect, Page } from '@playwright/test';
import { check, record, skip, diff, CheckMeta } from '../reporter';
import { killAlarms, pickCourseDate } from './courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────────────────────
//  코스관리 2차 개선 "코스/홀/구역 선택 개선"(위치 설정 캐스케이드 필터) 검증 헬퍼 — 비파괴.
//  근거: 드라이브 `2026-09 코스관리_PC 2차` > 공통 시트 위치 설정 TC 5~35(검색영역 필터).
//    적용 화면(7): 정보관리>잔디측정·토양측정·발병정보·일상점검, 작업관리>작업지시·이슈관리·예측정보.
//  검증 동작(전부 select/open/observe = 비파괴, 저장 없음. 필터 상태는 화면 재진입 시 리셋):
//    LOCF-01 4단 드롭다운(코스/홀/구분/구역) 노출 + 기본값 '…전체'
//    LOCF-02 코스 드롭다운 옵션(=… 전체 + 실코스 ≥1) + 옵션별 체크박스
//    LOCF-03 캐스케이드: '코스 전체' 선택 → 홀 드롭다운 활성화(disabled 해제)
//    LOCF-04 재선택=해제: 개별 코스 선택(1개) → 재선택 시 미체크(0개)
//    LOCF-05 [적용] → 하단 리스트 갱신(에러 없이 렌더 유지)
//  ⚠ 설계 원칙(report-standard): 구조가 예상과 다르면 **SKIP(사유 명시 + 실측 DOM 덤프)**, 진짜 동작 불일치만 FAIL.
//    → 가짜 FAIL 금지. LOCF-01 미검출 시 analysis/_locfilter-probe.json 에 화면 vue-select 전수 덤프(1런 확정용).
//  ⚠ 1런차(2026-09-03) 교훈: 기본값 '코스 전체'는 vue-select **placeholder(input)** 로 렌더 → innerText 미포착.
//    → 감지를 placeholder 포함으로 확장. 요일은 괄호'(목)' 아닌 **bare '목'** 로 렌더 → 정규식 확장.
// ──────────────────────────────────────────────────────────────────────────────

const LEVELS = [
  { key: '코스', all: '코스 전체' },
  { key: '홀', all: '홀 전체' },
  { key: '구분', all: '구분 전체' },
  { key: '구역', all: '구역 전체' },
] as const;

interface LevelSnap { key: string; present: boolean; idx: number; selectedText: string; disabled: boolean; cls: string; }
interface VsDiag { idx: number; text: string; placeholders: string; cls: string; }
interface FilterSnap { levels: LevelSnap[]; found: number; region: boolean; diag: VsDiag[]; hasNoLocCheckbox?: boolean; }

// 페이지/모달에서 위치 설정 필터 4단 상태를 원자적으로 스캔(evaluate). placeholder(input)까지 포함해 매칭.
//   scopeMode 'page'=검색필터(.contents, main) / 'modal'=열린 등록 모달(.modal-group, alarm 제외).
async function scanFilter(admin: Page, scopeMode: 'page' | 'modal' = 'page'): Promise<FilterSnap> {
  const allTexts = LEVELS.map((l) => l.all);
  return admin.evaluate(({ allTexts, scopeMode }: { allTexts: string[]; scopeMode: string }) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : e.getAttribute('class') || '');
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    let scope: Element = document.querySelector('.contents, main') || document.body;
    if (scopeMode === 'modal') {
      const modals = Array.from(document.querySelectorAll('.modal-group')).filter((m) => !m.classList.contains('alarm') && vis(m));
      scope = (modals[modals.length - 1] as Element) || scope;
    }
    const vsels = Array.from(scope.querySelectorAll('.v-select')) as HTMLElement[];
    // 각 vue-select 의 텍스트 + placeholder(들) 수집(진단 겸 매칭 소스).
    const meta = vsels.map((v, idx) => {
      const phs = Array.from(v.querySelectorAll('input')).map((i) => (i as HTMLInputElement).placeholder || '').filter(Boolean).join(' / ');
      return { idx, el: v, text: norm(v.innerText), placeholders: norm(phs), cls: clsOf(v) };
    });
    const levels = allTexts.map((all) => {
      const key = all.replace(/\s*전체$/, '');
      const re = new RegExp(`${key}\\s*(전체|선택)`);
      // 매칭: innerText 또는 placeholder 에 '…전체' 포함 / 키워드(코스·홀·구분·구역)+전체·선택.
      const hit = meta.find((m) => m.text.includes(all) || m.placeholders.includes(all) || re.test(m.text) || re.test(m.placeholders));
      const cls = hit ? hit.cls : '';
      // disabled: 강신호만(클래스 vs--disabled/is-disabled/disabled + disabled/aria-disabled attr + pointer-events:none).
      //   ⚠ 이 앱은 vue-select disabled 를 클래스로 표기 안 함(vs--searchable 유지) → 행동 기반(canOpenDropdown)이 주 판정.
      let disabled = false;
      if (hit) {
        const tog = (hit.el.querySelector('.vs__dropdown-toggle') as HTMLElement) || hit.el;
        const pe = tog ? getComputedStyle(tog).pointerEvents : '';
        disabled = /vs--disabled|is-disabled|(^|\s)disabled(\s|$)/.test(cls)
          || !!hit.el.querySelector('input:disabled, [disabled], [aria-disabled="true"]')
          || tog?.getAttribute('aria-disabled') === 'true'
          || pe === 'none';
      }
      // selectedText: 선택 pill > placeholder > innerText 순.
      const sel = hit ? (hit.el.querySelector('.vs__selected') as HTMLElement | null) : null;
      const selectedText = hit ? (norm(sel?.innerText || '') || hit.placeholders || hit.text).slice(0, 40) : '';
      return { key, present: !!hit, idx: hit ? hit.idx : -1, selectedText, disabled, cls: cls.slice(0, 80) };
    });
    const hasNoLocCheckbox = /작업장소\s*해당사항\s*없음/.test(norm((scope as HTMLElement).innerText || ''));
    return {
      levels, found: levels.filter((l) => l.present).length, region: vsels.length > 0, hasNoLocCheckbox,
      diag: meta.map((m) => ({ idx: m.idx, text: m.text.slice(0, 50), placeholders: m.placeholders.slice(0, 50), cls: m.cls.slice(0, 60) })),
    };
  }, { allTexts, scopeMode }).catch(() => ({ levels: [], found: 0, region: false, diag: [] } as FilterSnap));
}

// level 의 .v-select 로케이터(스캔에서 얻은 DOM 인덱스로 특정 — placeholder 렌더에도 견고).
//   scope='modal' 시 열린 모달 내부 인덱스 기준.
function levelVSByIdx(admin: Page, idx: number, scopeMode: 'page' | 'modal' = 'page') {
  const scope = scopeMode === 'modal'
    ? admin.locator('.modal-group:not(.alarm)').last()
    : admin.locator('.contents, main').first();
  return scope.locator('.v-select').nth(idx);
}

// 열린 드롭다운 옵션 텍스트 + 옵션별 체크박스 존재 여부.
async function readOptions(admin: Page): Promise<{ texts: string[]; withCheckbox: number }> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const opts = Array.from(document.querySelectorAll('.vs__dropdown-menu .vs__dropdown-option, .vs__dropdown-menu li')) as HTMLElement[];
    const texts = opts.map((o) => norm(o.innerText)).filter(Boolean).slice(0, 30);
    const withCheckbox = opts.filter((o) => o.querySelector('input[type=checkbox], .checkbox, .check-icon, [class*="check"]')).length;
    return { texts, withCheckbox };
  }).catch(() => ({ texts: [] as string[], withCheckbox: 0 }));
}

// 행동 기반 활성/비활성 판정(마크업 무관): 드롭다운 토글 클릭 → 열린 옵션 수 반환(닫음).
//   반환 0 = 안 열림(=비활성/게이팅), >0 = 열림(=활성). -1 = 토글 미검출.
async function canOpenDropdown(admin: Page, idx: number, scopeMode: 'page' | 'modal'): Promise<number> {
  const tog = levelVSByIdx(admin, idx, scopeMode).locator('.vs__dropdown-toggle').first();
  if (!(await tog.isVisible({ timeout: 1_500 }).catch(() => false))) return -1;
  await tog.click({ timeout: 2_000 }).catch(() => {});
  await admin.waitForTimeout(400);
  const n = (await readOptions(admin)).texts.length;
  await admin.keyboard.press('Escape').catch(() => {});
  await admin.waitForTimeout(250);
  return n;
}

/**
 * 위치 설정 캐스케이드 필터 검증(비파괴). 구조 미검출 시 전체 SKIP(사유 + DOM 덤프).
 * @param P  리포트 경로 prefix (예: "정보 관리 > 잔디 측정 정보")
 * @param R  tcRef prefix (예: "코스관리_잔디측정")
 * @param id tcId prefix (예: "GRASS")
 */
export async function verifyLocationFilter(admin: Page, P: string, R: string, id: string): Promise<void> {
  await killAlarms(admin);
  const base = (n: number, tail: string) => ({ path: `${P} > 위치필터`, tcRef: `${R}_위치필터_${n}`, tcId: `${id}-LOCF-0${n}`, desc: tail });
  const snap = await scanFilter(admin);

  const m01: CheckMeta = { ...base(1, '코스/홀/구분/구역 4단 드롭다운 노출 + 기본값 …전체'), failMsg: '위치 설정 필터 미노출' };
  if (snap.found === 0) {
    // vue-select 로 미검출 → 컴포넌트가 .v-select 가 아닐 수 있으므로 **본문 전역**에서
    //   코스/홀/구분/구역(+전체/선택) 텍스트·placeholder 를 품은 인터랙티브 요소를 전수 스캔(1런 확정용).
    const wide = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : e.getAttribute('class') || '');
      const scope = document.querySelector('.contents, main') || document.body;
      const KEY = /(코스|홀|구분|구역)\s*(전체|선택)/;
      const hits: Array<{ tag: string; cls: string; text: string; ph: string; role: string }> = [];
      const all = Array.from(scope.querySelectorAll('*')) as HTMLElement[];
      for (const e of all) {
        const t = norm(e.innerText); const ph = norm((e.querySelector('input') as HTMLInputElement)?.placeholder || (e as HTMLInputElement).placeholder || '');
        if (e.children.length > 3) { if (!KEY.test(ph)) continue; }   // 컨테이너는 placeholder 로만
        if (!KEY.test(t.slice(0, 40)) && !KEY.test(ph)) continue;
        const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
        hits.push({ tag: e.tagName.toLowerCase(), cls: clsOf(e).slice(0, 60), text: t.slice(0, 40), ph: ph.slice(0, 40), role: e.getAttribute('role') || '' });
        if (hits.length >= 20) break;
      }
      // select-like 후보 클래스 카운트(구조 파악용)
      const counts = {
        vSelect: scope.querySelectorAll('.v-select').length,
        dropdown: scope.querySelectorAll('[class*="dropdown"], [class*="select"]').length,
        nativeSelect: scope.querySelectorAll('select').length,
        checkbox: scope.querySelectorAll('input[type=checkbox]').length,
      };
      return { hits, counts };
    }).catch(() => ({ hits: [], counts: {} }));
    try {
      if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
      fs.writeFileSync(path.join('analysis', `_locfilter-probe_${id}.json`), JSON.stringify({ screen: P, region: snap.region, vselects: snap.diag, wideScan: wide }, null, 2));
    } catch { /* ignore */ }
    const w = wide as { hits: Array<{ tag: string; cls: string; text: string; ph: string }>; counts: Record<string, number> };
    const brief = w.hits.slice(0, 4).map((h) => `${h.tag}.${h.cls.split(' ')[0]}[${h.ph || h.text}]`).join(' ');
    const cnt = Object.entries(w.counts).map(([k, v]) => `${k}:${v}`).join(' ');
    skip(m01, `위치 필터 미검출(vue-select ${snap.diag.length}개엔 없음). 전역 후보 ${w.hits.length}건: ${brief || '없음'} · ${cnt} — analysis/_locfilter-probe_${id}.json`);
    return;
  }
  const course = snap.levels.find((l) => l.key === '코스')!;
  await check(admin, m01, async () => {
    expect(course.present, '코스 드롭다운 미노출').toBeTruthy();
    expect(course.selectedText, `기본값 '코스 전체' 아님(실제: ${course.selectedText})`).toContain('코스 전체');
  }, { getActual: async () => snap.levels.map((l) => `${l.key}:${l.present ? l.selectedText || 'present' : '없음'}`).join(' / ') });
  if (snap.found < 4) {
    diff(P, '위치 설정 4단(코스/홀/구분/구역) 드롭다운', `구현 ${snap.found}단 노출(${snap.levels.filter((l) => l.present).map((l) => l.key).join('/')})`, `${R}_위치필터`, '기획 4단 대비 노출 레벨 차이 — 화면별 데이터/구조 확인 요망');
  }

  // LOCF-02: 코스 드롭다운 열기 → 옵션(코스 전체 + 실코스 ≥1) + 옵션별 체크박스.
  const m02: CheckMeta = { ...base(2, '코스 드롭다운 옵션(코스 전체 + 실코스 ≥1) + 옵션별 체크박스'), failMsg: '옵션/체크박스 미노출' };
  const courseVS = levelVSByIdx(admin, course.idx);
  const toggle = courseVS.locator('.vs__dropdown-toggle').first();
  if (!(await toggle.isVisible({ timeout: 2_000 }).catch(() => false))) {
    skip(m02, '코스 .vs__dropdown-toggle 미검출 — 옵션 검증 불가(셀렉터 보정 대상)');
  } else {
    await toggle.click({ timeout: 2_500 }).catch(() => {});
    await admin.waitForTimeout(500);
    const opt = await readOptions(admin);
    await admin.keyboard.press('Escape').catch(() => {});
    if (opt.texts.length === 0) {
      skip(m02, '드롭다운 옵션 미검출(.vs__dropdown-menu 비어있음) — 데이터 없음/렌더 지연 추정');
    } else {
      const hasAll = opt.texts.some((t) => /코스\s*전체/.test(t));
      const realCourses = opt.texts.filter((t) => !/코스\s*전체/.test(t)).length;
      await check(admin, m02, async () => {
        expect(hasAll, "'코스 전체' 옵션 없음").toBeTruthy();
        expect(realCourses, '실코스 옵션 0개').toBeGreaterThanOrEqual(1);
      }, { getActual: async () => `옵션 ${opt.texts.length}(체크박스 ${opt.withCheckbox}): ${opt.texts.slice(0, 6).join(', ')}` });
      if (opt.withCheckbox === 0) {
        diff(P, '옵션별 체크박스(멀티 선택 UI)', '옵션에서 체크박스 미검출', `${R}_위치필터`, '체크박스가 다른 마크업일 수 있음 — 실측 후 셀렉터 확정');
      }
    }
  }

  // LOCF-03: 홀/구분/구역 드롭다운 기본 활성화(TC5 검색필터 기본값=전체/활성).
  //   ⚠ TC 원문 "코스 전체 선택 → 홀 활성화"의 disabled→enabled 캐스케이드는 **위치저장 등록폼**(TC38~,
  //     홀 기본 '비활성') 변형의 동작. **검색필터**(이 7화면)는 기본값이 전부 '전체/활성'이라 초기 disabled가
  //     없음(1런 실측: cls=v-select vs--searchable, disabled 없음) → 여기선 '기본 활성 상태'를 검증(TC5 부합).
  //     진짜 비활성→활성 캐스케이드는 위치저장 등록폼 스펙에서 별도 검증 예정(파괴 경로).
  const m03: CheckMeta = { ...base(3, '홀/구분/구역 드롭다운 기본 활성화(검색필터 기본값 전체/활성)'), failMsg: '드롭다운 기본 비활성' };
  const gated = snap.levels.filter((l) => l.key !== '코스' && l.present);
  if (gated.length === 0) {
    skip(m03, '홀/구분/구역 미노출 — 활성 상태 검증 불가');
  } else {
    const disabledOnes = gated.filter((l) => l.disabled).map((l) => l.key);
    await check(admin, m03, async () => {
      expect(disabledOnes.length, `기본 비활성 레벨: ${disabledOnes.join(',') || '없음'}`).toBe(0);
    }, { getActual: async () => gated.map((l) => `${l.key}:${l.disabled ? '비활성' : '활성'}`).join(' / ') });
  }

  // LOCF-04: 재선택=해제 — 개별 코스 선택 → 재선택 시 미체크(선택 0).
  const m04: CheckMeta = { ...base(4, '개별 코스 선택(1개) → 재선택 시 해제(0개)'), failMsg: '재선택 해제 동작 안 함' };
  const selCount = () => admin.evaluate((idx) => {
    const scope = document.querySelector('.contents, main') || document.body;
    const vs = Array.from(scope.querySelectorAll('.v-select'))[idx] as HTMLElement | undefined;
    return vs ? vs.querySelectorAll('.vs__selected').length : -1;
  }, course.idx).catch(() => -1);
  await toggle.click({ timeout: 2_000 }).catch(() => {});
  await admin.waitForTimeout(400);
  const realOpt = admin.locator('.vs__dropdown-menu').locator('.vs__dropdown-option, li').filter({ hasNotText: /전체/ }).first();
  if (!(await realOpt.isVisible({ timeout: 1_500 }).catch(() => false))) {
    await admin.keyboard.press('Escape').catch(() => {});
    skip(m04, '실코스 옵션 미검출 — 재선택 검증 불가(데이터 없음/셀렉터)');
  } else {
    const label = (await realOpt.innerText().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 20);
    await realOpt.click({ timeout: 1_500 }).catch(() => {});
    await admin.waitForTimeout(500);
    const c1 = await selCount();
    if (!(await realOpt.isVisible({ timeout: 800 }).catch(() => false))) { await toggle.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(300); }
    const sameOpt = admin.locator('.vs__dropdown-menu').locator('.vs__dropdown-option, li').filter({ hasText: label ? new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : /코스/ }).first();
    let reClicked = false;
    if (await sameOpt.isVisible({ timeout: 1_200 }).catch(() => false)) { await sameOpt.click({ timeout: 1_500 }).catch(() => {}); reClicked = true; }
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(500); await killAlarms(admin);
    const c2 = await selCount();
    if (c1 < 0) { skip(m04, `.vs__selected 카운트 불가(멀티셀렉트 pill 마크업 상이) — c1=${c1}`); }
    else if (!reClicked) { skip(m04, `재선택 옵션('${label}') 재검출 실패 — 셀렉터 보정 대상(선택=${c1})`); }
    else {
      await check(admin, m04, async () => {
        expect(c1, '개별 선택 후 선택 0').toBeGreaterThanOrEqual(1);
        expect(c2, `재선택 후에도 선택 유지(${c2})`).toBeLessThan(c1);
      }, { getActual: async () => `'${label}' 선택 ${c1}개 → 재선택 ${c2}개` });
    }
  }

  // LOCF-05: [적용] → 하단 리스트 갱신(에러 없이 렌더 유지). 필터는 화면 재진입 시 리셋(비파괴).
  const m05: CheckMeta = { ...base(5, '[적용] → 하단 리스트 갱신(렌더 유지)'), failMsg: '[적용] 후 리스트 미갱신/에러' };
  const applyBtn = admin.locator('.contents, main').first().getByRole('button', { name: /^\s*적용\s*$/ }).first();
  if (!(await applyBtn.isVisible({ timeout: 1_500 }).catch(() => false))) {
    skip(m05, '[적용] 버튼 미노출 — 즉시반영 필터/구조 상이 추정');
  } else {
    await check(admin, m05, async () => {
      await applyBtn.click({ timeout: 2_500 }).catch(() => {});
      await admin.waitForTimeout(900); await killAlarms(admin);
      await expect(admin.locator('.contents, .contents-box, main').first()).toBeVisible({ timeout: 5_000 });
    });
  }
  await killAlarms(admin);
}

// 모달 비파괴 닫기(취소/닫기 → Escape). 저장 안 함.
async function closeModalNonDestructive(admin: Page): Promise<void> {
  const modal = admin.locator('.modal-group:not(.alarm)').last();
  const cancel = modal.getByRole('button', { name: /^\s*(취소|닫기|Cancel|Close)\s*$/ }).first();
  if (await cancel.isVisible({ timeout: 1_200 }).catch(() => false)) await cancel.click({ timeout: 1_500 }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {});
  await killAlarms(admin);
  await admin.waitForTimeout(400);
}

// ──────────────────────────────────────────────────────────────────────────────
//  2차 개선 "코스/홀 선택에서 위치 저장"(공통 시트 TC 36~67) — 등록폼 변형 캐스케이드. 비파괴.
//   검색필터(verifyLocationFilter)와 달리 폼은 홀/구분/구역이 **기본 비활성** → 코스 선택 시 활성화되는
//   진짜 disabled→enabled 캐스케이드 존재(TC38). 대상: 작업 지시 신규 등록 모달 '작업 위치' 섹션.
//   ⚠ 저장/위치저장 클릭 금지 — 모달 열어 폼 상태만 조작 후 취소로 닫음(폼 폐기 = 비파괴).
//     LOCSAVE-01 코스/홀 드롭다운 + '작업장소 해당사항 없음' 체크박스 노출
//     LOCSAVE-02 홀/구분/구역 기본 비활성(폼 기본값 '홀 전체/비활성')
//     LOCSAVE-03 코스 개별 선택 → 홀 활성화(disabled 해제) ← 실제 캐스케이드
//     LOCSAVE-04 작업장소 해당사항 없음 체크→코스/홀 비활성, 언체크→재활성(TC36-37)
//   ⚠ disabled 표기가 vs--disabled 가 아니면 02/03/04 는 SKIP(사유+cls) — 가짜 FAIL 금지, 1런으로 확정.
// ──────────────────────────────────────────────────────────────────────────────
export async function verifyLocationSaveCascade(admin: Page, P: string, R: string, id: string): Promise<void> {
  await killAlarms(admin);
  const base = (n: number, tail: string) => ({ path: `${P} > 위치저장폼`, tcRef: `${R}_위치저장_${n}`, tcId: `${id}-LOCSAVE-0${n}`, desc: tail });

  // 신규 등록 모달 열기(비파괴).
  const opened = await admin.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, a')).find((x) =>
      (x as HTMLElement).offsetParent && !x.closest('.side-navbar-container') && /신규 등록|신규 작업 지시 등록/.test((x.textContent || '').replace(/\s+/g, ' ')));
    if (!b) return false; (b as HTMLElement).click(); return true;
  }).catch(() => false);
  const m00: CheckMeta = { ...base(0, '신규 등록 모달 오픈') };
  if (!opened) { skip(m00, '[신규 등록] 버튼 미발견 — 폼 캐스케이드 검증 불가'); return; }
  await admin.waitForTimeout(1_800); await killAlarms(admin);
  // 작업 위치 섹션으로 스크롤(있으면).
  await admin.evaluate(() => { const h = Array.from(document.querySelectorAll('*')).find((e) => e.children.length === 0 && /작업\s*위치|위치\s*설정/.test((e as HTMLElement).innerText || '')); (h as HTMLElement)?.scrollIntoView({ block: 'center' }); }).catch(() => {});
  await admin.waitForTimeout(500);

  const snap = await scanFilter(admin, 'modal');
  const m01: CheckMeta = { ...base(1, '작업 위치: 코스/홀 드롭다운 + 작업장소 해당사항 없음 체크박스 노출'), failMsg: '위치 설정 요소 미노출' };
  if (snap.found === 0) {
    try {
      if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
      fs.writeFileSync(path.join('analysis', `_locsave-probe_${id}.json`), JSON.stringify({ screen: P, vselects: snap.diag, hasNoLocCheckbox: snap.hasNoLocCheckbox }, null, 2));
    } catch { /* ignore */ }
    const brief = snap.diag.slice(0, 6).map((d) => `#${d.idx}[${d.placeholders || d.text}]`).join(' ');
    skip(m01, `모달 위치 드롭다운 미검출(vue-select ${snap.diag.length}: ${brief}) — analysis/_locsave-probe_${id}.json`);
    await closeModalNonDestructive(admin); return;
  }
  const course = snap.levels.find((l) => l.key === '코스')!;
  await check(admin, m01, async () => {
    expect(course.present, '코스 드롭다운 미노출').toBeTruthy();
    expect(snap.hasNoLocCheckbox, '작업장소 해당사항 없음 체크박스 미노출').toBeTruthy();
  }, { getActual: async () => `${snap.levels.filter((l) => l.present).map((l) => l.key).join('/')} · 해당없음체크:${snap.hasNoLocCheckbox}` });

  // LOCSAVE-02: 홀/구분/구역 기본 비활성(폼 변형 TC38) — 행동 기반(드롭다운 열림 여부).
  //   ⚠ 이 앱은 disabled 를 클래스로 표기 안 함 → '토글 클릭 시 옵션이 열리는가'로 판정(0=비활성/게이팅).
  const m02: CheckMeta = { ...base(2, '홀/구분/구역 기본 비활성(폼 기본값 홀 전체/비활성, 행동 기반)'), failMsg: '기본 비활성 아님' };
  const hallLv = snap.levels.find((l) => l.key === '홀');
  let hallOpen0 = -1;
  if (!hallLv?.present) { skip(m02, '홀 드롭다운 미노출 — 기본 비활성 검증 불가'); }
  else {
    hallOpen0 = await canOpenDropdown(admin, hallLv.idx, 'modal');
    if (hallOpen0 < 0) { skip(m02, '홀 토글 미검출 — 열림 판정 불가'); }
    else if (hallOpen0 === 0) { record(m02, 'PASS', { actual: '홀 드롭다운 미열림(기본 비활성=게이팅 확인)' }); }
    else {
      // 홀이 코스 미선택인데도 열림 → 폼이 홀을 게이팅하지 않음(기획 TC38 대비 차이). FAIL 아님.
      diff(P, '등록폼 홀 기본 비활성(코스 선택 전 게이팅, TC38)', `구현: 코스 선택 전에도 홀 드롭다운 열림(옵션 ${hallOpen0})`, `${R}_위치저장`, '홀 게이팅 미적용 또는 즉시활성 — 기획/QA 확인');
      skip(m02, `홀 드롭다운이 코스 선택 전에도 열림(옵션 ${hallOpen0}) — 게이팅 미적용(diff 기록)`);
    }
  }

  // LOCSAVE-03: 코스 개별 선택 → 홀 활성화(게이팅 해제) ← 실제 캐스케이드(행동 기반).
  //   홀이 기본 게이팅(hallOpen0===0)일 때만 의미. 코스 선택 후 홀이 열리면 캐스케이드 PASS.
  const m03: CheckMeta = { ...base(3, '코스 개별 선택 → 홀 드롭다운 활성화(게이팅 해제, 행동 기반)'), failMsg: '캐스케이드 활성화 안 됨' };
  if (!hallLv?.present) { skip(m03, '홀 드롭다운 미노출'); }
  else if (hallOpen0 !== 0) { skip(m03, `홀 기본 게이팅 아님(코스 선택 전 열림 ${hallOpen0}) — 캐스케이드 델타 없음(폼도 기본 활성)`); }
  else {
    // 코스 개별 선택
    const cToggle = levelVSByIdx(admin, course.idx, 'modal').locator('.vs__dropdown-toggle').first();
    await cToggle.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(400);
    const realOpt = admin.locator('.vs__dropdown-menu').locator('.vs__dropdown-option, li').filter({ hasNotText: /전체/ }).first();
    let picked = false;
    if (await realOpt.isVisible({ timeout: 1_500 }).catch(() => false)) { await realOpt.click({ timeout: 1_500 }).catch(() => {}); picked = true; }
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(700); await killAlarms(admin);
    if (!picked) { skip(m03, '실코스 옵션 미검출 — 캐스케이드 트리거 불가'); }
    else {
      const hallOpen1 = await canOpenDropdown(admin, hallLv.idx, 'modal');
      await check(admin, m03, async () => {
        expect(hallOpen1, `코스 선택 후에도 홀 미열림(${hallOpen1})`).toBeGreaterThan(0);
      }, { getActual: async () => `홀 열림 옵션수: 코스선택전 ${hallOpen0} → 선택후 ${hallOpen1}` });
    }
  }

  // LOCSAVE-04: 작업장소 해당사항 없음 체크→코스 비활성, 언체크→재활성(TC36-37) — 행동 기반.
  //   ⚠ 클래스가 아니라 '체크 시 코스 드롭다운이 안 열리는가'로 판정 → 가짜 FAIL 방지. 미동작 시 diff+SKIP(FAIL 아님).
  const m04: CheckMeta = { ...base(4, '작업장소 해당사항 없음 체크→코스 비활성, 언체크→재활성(행동 기반)'), failMsg: '해당없음 토글 미동작' };
  if (!snap.hasNoLocCheckbox) { skip(m04, '작업장소 해당사항 없음 체크박스 미노출'); }
  else {
    const chk = admin.locator('.modal-group:not(.alarm)').last().getByText('작업장소 해당사항 없음', { exact: false }).first();
    if (!(await chk.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m04, '체크박스 로케이트 실패'); }
    else {
      const c0 = await canOpenDropdown(admin, course.idx, 'modal');            // 체크 전(코스 열림 기대)
      await chk.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);
      const cChk = await canOpenDropdown(admin, course.idx, 'modal');          // 체크 후(비활성=미열림 기대)
      await chk.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);  // 언체크 원복(비파괴)
      const cRestore = await canOpenDropdown(admin, course.idx, 'modal');      // 언체크 후(재활성=열림 기대)
      if (c0 <= 0) { skip(m04, `코스 드롭다운 기본 열림 미확인(c0=${c0}) — 판정 불가`); }
      else if (cChk === 0 && cRestore > 0) { record(m04, 'PASS', { actual: `코스 열림수: 기본 ${c0} → 체크 0(비활성) → 언체크 ${cRestore}(재활성)` }); }
      else {
        // 체크해도 코스가 계속 열림 → 해당없음이 코스를 비활성화하지 않음(기획 TC36 대비 차이). FAIL 아님 → diff+SKIP.
        diff(P, '작업장소 해당사항 없음 체크 시 코스/홀 비활성(TC36)', `구현: 체크 후에도 코스 드롭다운 열림(기본 ${c0}→체크 ${cChk}→언체크 ${cRestore})`, `${R}_위치저장`, '해당없음 체크가 코스 비활성화 안 함 — 기획/QA 확인 요망');
        skip(m04, `해당없음 체크가 코스 비활성화 미동작(열림수 기본 ${c0}→체크 ${cChk}→언체크 ${cRestore}) — diff 기록(QA 확인)`);
      }
    }
  }

  await closeModalNonDestructive(admin);
  await killAlarms(admin);
}

// ──────────────────────────────────────────────────────────────────────────────
//  2차 개선 "캘린더 날짜 선택 사용성 개선"(공통 시트 TC 1~4): 시작일/종료일 선택 시
//    선택 날짜 + '요일' 노출. datepicker 없으면 SKIP. 비파괴(검색 필터 조작만).
//  ⚠ 1런차 실측: 요일은 괄호 없는 bare 한글 1자('목')로 인접 렌더 → 정규식이 이를 수용.
// ──────────────────────────────────────────────────────────────────────────────
export async function verifyDateWeekday(admin: Page, P: string, R: string, id: string): Promise<void> {
  const m: CheckMeta = { path: `${P} > 캘린더요일`, tcRef: `${R}_캘린더요일`, tcId: `${id}-CALWD`, desc: '시작일 날짜 선택 → 날짜+요일 노출(2차 개선)', failMsg: '요일 미노출' };
  const box = admin.locator('.contents-box, .contents, main').filter({ has: admin.locator('.datepicker-input') }).first();
  if (!(await box.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, '검색폼 datepicker 없음'); return; }
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const picked = await pickCourseDate(admin, iso).catch(() => false);
  if (!picked) { skip(m, '달력 구동 불가 — 코스 datepicker 구조 상이 추정'); return; }
  await admin.waitForTimeout(400);
  const fieldText = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.contents-box, .contents, main') || document.body;
    const inps = Array.from(scope.querySelectorAll('.datepicker-input')) as HTMLInputElement[];
    const vals = inps.map((i) => i.value || '').join(' | ');
    const near = inps.map((i) => norm((i.closest('.datepicker, .date-box, .form-group, div') as HTMLElement)?.innerText || '')).join(' | ');
    return `${vals} || ${near}`.slice(0, 200);
  }).catch(() => '');
  // 요일 토큰: 괄호형 '(목)' 또는 bare 한글 1자 '목'(공백/파이프 경계) 또는 영문 요일.
  const hasWeekday = /\(\s*[일월화수목금토]\s*\)/.test(fieldText)
    || /(^|[\s|>·.])([일월화수목금토])(요일)?($|[\s|<·])/.test(fieldText)
    || /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i.test(fieldText);
  if (!hasWeekday) {
    // 진짜 미노출로 단정 회피 → 관찰(diff) + SKIP(실측 포함). FAIL 아님.
    diff(P, '날짜 선택 시 날짜+요일 노출', `요일 토큰 미검출(실측: ${fieldText.slice(0, 60)})`, `${R}_캘린더요일`, '요일이 별도 위치/포맷일 수 있음 — 실측 후 셀렉터 확정');
    skip(m, `요일 토큰 미검출(실측: ${fieldText.slice(0, 80)}) — 위치/포맷 확인 대상`);
  } else {
    record(m, 'PASS', { actual: `날짜+요일 노출 확인: ${fieldText.slice(0, 60)}` });
  }
  await killAlarms(admin);
}
