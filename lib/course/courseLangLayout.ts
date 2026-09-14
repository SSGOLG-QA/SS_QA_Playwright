import { Page } from '@playwright/test';
import { record, skip, review, CheckMeta } from '../reporter';
import { killAlarms, isCourseLoggedOut } from './courseHelpers';
import { settle } from '../adminHelpers';
import { closeForm } from './formE2E';
import {
  CourseLang, switchCourseLang, currentCourseLang,
  ensureCourseKorean, enterCourseMenu, closeCourseOverlays,
} from './courseLangCheck';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어 — **텍스트 번역 외 UI 결함** 검출 (QA-15548)
//   표준 다국어 하네스(course:lang-check)는 화면 DOM '텍스트'의 번역 여부만 본다. QA-15548의 결함은
//   텍스트 대조로 안 잡히는 두 부류:
//     · No.1 내보내기 **다운로드 파일명이 한국어**(외국어 UI인데 파일명 미번역) — 파일명은 화면 밖.
//     · No.2 번역된 **긴 라벨이 입력 박스와 겹침**(레이아웃 파손, 베/태/중/일/인니) — 요소간 rect 교차.
//   (No.3 미세 간격=시각회귀 영역·자동 부적합, No.4 즉시반영=별도 타이밍 프로브 — 본 모듈 범위 밖.)
//
//   공통 원리: 외국어 모드에서 확인해야 하는데 **트리거 버튼 텍스트도 번역**되므로 →
//     KO에서 트리거 '위치(pi=버튼 인덱스)' 식별 → 언어 전환 → 같은 위치 클릭 (scanCourseForms 검증 패턴 재사용).
//   비파괴: 내보내기(다운로드=읽기)·모달 열기/스캔/닫기만. 저장·삭제·업로드 없음. 종료 시 한국어 원복.
// ──────────────────────────────────────────────────────────────

const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

// 세션 만료/로그아웃 감지 — courseHelpers 공용 유틸 재사용(런 중간 로그인 페이지 이탈).
const isLoggedOut = isCourseLoggedOut;

// KO 모드에서 정규식 텍스트에 맞는 첫 가시 트리거의 인덱스(sel 집합 내). 없으면 -1.
//   ownTextOnly=true: 요소의 **직접 텍스트**만 매칭(조상 컨테이너 오매칭 방지 — 넓은 sel에서 필수).
async function koTriggerPi(admin: Page, reSrc: string, sel: string, ownTextOnly = false): Promise<number> {
  return admin.evaluate(({ reSrc, sel, ownTextOnly }) => {
    const n = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1 && !e.closest('.side-navbar-container'); };
    const own = (e: Element) => n(Array.from(e.childNodes).filter((x) => x.nodeType === 3).map((x) => x.nodeValue).join(' '));
    const re = new RegExp(reSrc);
    const all = Array.from(document.querySelectorAll(sel));
    return all.findIndex((b) => vis(b) && re.test(ownTextOnly ? own(b) : n((b as HTMLElement).innerText || b.textContent)));
  }, { reSrc, sel, ownTextOnly }).catch(() => -1);
}

// 트리거 미발견 시 홈 상태 강화 진단 — 언어·URL·콘텐츠 길이 + 짧은 텍스트 버튼(한글필터 없이) 전수.
async function dumpClickables(admin: Page): Promise<string> {
  const url = admin.url();
  const lang = await currentCourseLang(admin).catch(() => '?');
  const dom = await admin.evaluate(() => {
    const n = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.contents, main') || document.body;
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1 && !e.closest('.side-navbar-container'); };
    const own = (e: Element) => n(Array.from(e.childNodes).filter((x) => x.nodeType === 3).map((x) => x.nodeValue).join(' '));
    const clen = n((scope as HTMLElement).innerText || '').length;
    const tabs = Array.from(document.querySelectorAll('.tab-group')).filter(vis).map((g) => Array.from(g.children).filter(vis).map((c) => n((c as HTMLElement).innerText).slice(0, 14)));
    const btns: string[] = [];
    for (const el of Array.from(scope.querySelectorAll('button, [role="button"], a, [class*="btn"], [class*="button"]')) as HTMLElement[]) {
      if (!vis(el)) continue; const t = own(el); if (t && t.length <= 18) btns.push(t);
    }
    return { clen, tabs: JSON.stringify(tabs).slice(0, 120), btns: [...new Set(btns)].slice(0, 20).join(' / ') };
  }).catch(() => ({ clen: -1, tabs: '?', btns: '?' }));
  return `lang=${lang} · url=${url.split('/').slice(-2).join('/')} · contents=${dom.clen}자 · 탭=${dom.tabs} · 버튼=[${dom.btns}]`;
}

// ══════════════════ No.1 — 내보내기 다운로드 파일명 i18n ══════════════════
const EXPORT_SEL = 'button, [role="button"]';
type ExpScreen = { menu: string; sub?: string; label: string };
const FILENAME_SCREENS: ExpScreen[] = [
  { menu: '예산 관리', sub: '실적 관리', label: '예산 관리 > 실적 관리' },   // QA-15548 #1
  { menu: '예산 관리', sub: '예산 총괄', label: '예산 관리 > 예산 총괄' },
  { menu: '비용 관리', sub: '작업별 비용', label: '비용 관리 > 작업별 비용' },
  { menu: '비용 관리', sub: '분류별 비용', label: '비용 관리 > 분류별 비용' },
  { menu: '비용 관리', sub: '위치별 비용', label: '비용 관리 > 위치별 비용' },
  { menu: '비용 관리', sub: '기간별 비용', label: '비용 관리 > 기간별 비용' },
  { menu: '정보 관리', sub: '홀 별 정보', label: '정보 관리 > 홀 별 정보' },
];

// 외국어 모드에서 pi 위치 내보내기 버튼 클릭 → 다운로드 파일명 취득(비파괴). 파일 저장은 임시 경로(내용 무관).
async function foreignExportFilename(admin: Page, pi: number): Promise<{ name: string; err: string }> {
  const btn = admin.locator(EXPORT_SEL).nth(pi);
  const [dl] = await Promise.all([
    admin.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    btn.click({ timeout: 3000 }).catch(() => {}),
  ]);
  await admin.waitForTimeout(800); await killAlarms(admin);
  if (!dl) return { name: '', err: '다운로드 이벤트 미발생(외국어 버튼 위치/무동작)' };
  const name = dl.suggestedFilename();
  await dl.saveAs(`reports/downloads/_langfn_${Date.now()}.bin`).catch(() => {});   // 내용 검증 아님 — 파일명만 검사
  return { name, err: '' };
}

export async function runCourseLangFilename(admin: Page, lang: CourseLang): Promise<void> {
  const seen = new Set<string>();
  let sessionDead = false;   // 런 도중 세션 만료(로그인 페이지) 감지 → 이후 화면 일괄 처리(재시도 낭비 방지)
  for (const s of FILENAME_SCREENS) {
    const tcRef = `코스관리_다국어_파일명_${s.menu}`;
    const base: CheckMeta = { path: `${s.label} > 내보내기 파일명`, tcRef, tcId: `LANGFN-${lang.ko}`, desc: `${lang.ko}(${lang.label}) 내보내기 파일명 i18n(한글 미포함)` };
    if (sessionDead || isLoggedOut(admin)) { sessionDead = true; skip(base, '세션 만료(로그인 페이지) — 공유 QA 계정 1런/로그인 한계, 재인증 필요(course:auth)'); continue; }
    try {
      const sub = s.sub && s.sub !== s.menu ? s.sub : undefined;
      if (!(await enterCourseMenu(admin, s.menu, sub))) {
        const lo = isLoggedOut(admin); if (lo) sessionDead = true;
        review({ lang: lang.ko, screen: s.label, kind: lo ? '세션 만료 진단' : '진입 실패 진단', item: lo ? '메뉴 진입 중 로그인 페이지' : '메뉴 진입 실패(cascade 의심)', value: await dumpClickables(admin) });
        if (!lo) { await closeCourseOverlays(admin).catch(() => {}); await ensureCourseKorean(admin).catch(() => {}); }   // cascade면 복구, 세션이면 무의미
        skip(base, lo ? '세션 만료(로그인 페이지) — 재인증 필요(course:auth)' : '진입 실패(진단 참조 — cascade/외국어SNB 의심)'); continue;
      }
      if (isLoggedOut(admin)) { sessionDead = true; skip(base, '세션 만료(로그인 페이지) — 재인증 필요(course:auth)'); continue; }
      await killAlarms(admin); await settle(admin, 700);
      const pi = await koTriggerPi(admin, '내보내기', EXPORT_SEL);
      if (pi < 0) { skip(base, '내보내기 버튼 없음(데이터 의존/미노출)'); continue; }
      await closeCourseOverlays(admin);   // 직전 화면 다운로드/모달 잔존이 스위처 가림 방지(홀별정보 전환실패 완화)
      if (!(await switchCourseLang(admin, lang.clickLabel))) {
        const lo = isLoggedOut(admin); if (lo) sessionDead = true;
        review({ lang: lang.ko, screen: s.label, kind: lo ? '세션 만료 진단' : '전환 실패 진단', item: lo ? '전환 중 로그인 페이지' : `${lang.clickLabel} 전환 실패(스위처 차단/오버레이 의심)`, value: await dumpClickables(admin) });
        if (!lo) { await closeCourseOverlays(admin).catch(() => {}); await ensureCourseKorean(admin).catch(() => {}); }
        skip(base, lo ? '세션 만료(로그인 페이지) — 재인증 필요(course:auth)' : `${lang.clickLabel} 전환 실패(진단 참조)`); continue;
      }
      await settle(admin, 700);
      const { name, err } = await foreignExportFilename(admin, pi);
      await ensureCourseKorean(admin);
      if (!name) { skip(base, err); continue; }
      const dk = `${s.label}|${name}`;
      if (seen.has(dk)) continue; seen.add(dk);
      const hasHangul = /[가-힣]/.test(name);
      const meta: CheckMeta = { ...base, expected: '외국어 모드 파일명에 한글 미포함(현지화 또는 로마자)' };
      if (hasHangul) {
        record(meta, 'FAIL', { actual: `${lang.label} 모드 파일명: "${name}"`, error: '내보내기 파일명 미번역(한글 포함)', detail: 'QA-15548 #1 계열 — 외국어 UI인데 다운로드 파일명이 한국어' });
      } else {
        record(meta, 'PASS', { actual: `${lang.label} 모드 파일명: "${name}"` });
      }
    } catch (e: any) {
      const msg = (e?.message || String(e)).replace(/\s+/g, ' ').slice(0, 200);
      skip(base, `화면 처리 예외(격리·계속): ${msg}`);
      await ensureCourseKorean(admin).catch(() => {});
      await killAlarms(admin).catch(() => {});
    }
  }
  console.log(`[courseLangFilename] ${lang.ko} — 완료`);
}

// ══════════════════ No.2 — 번역 라벨 ↔ 입력박스 겹침(레이아웃) ══════════════════
type OverlapForm = { menu: string; sub?: string; tab?: string; trigger: string; label: string };
const OVERLAP_FORMS: OverlapForm[] = [
  // QA-15548 #2 — 홈 > 관리 목표 및 현황 > [목표 설정] 모달: 항목명↔입력박스 겹침(베/태/중/일/인니)
  { menu: 'Home', tab: '관리 목표 및 현황', trigger: '목표\\s*설정', label: '홈 > 목표 설정 모달' },
];

// 열린 모달/폼에서 라벨성 텍스트 ↔ 입력 컨트롤의 rect 교차 감지. 반환: 겹침 쌍 + 진단 카운트.
//   판정: 텍스트요소와 컨트롤의 교차면적 / min(텍스트면적, 컨트롤면적) >= ratio → 겹침(라벨이 입력박스를 침범).
async function scanOverlaps(admin: Page, ratio = 0.2): Promise<{ pairs: any[]; labels: number; controls: number; scope: string }> {
  return admin.evaluate((ratio) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('.modal-group, .modal-box') || document.querySelector('.contents, main') || document.body;
    const scope = (root && (root as HTMLElement).className) ? (typeof root.className === 'string' ? root.className : '') : (root as Element).tagName;
    const isVis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity || '1') > 0.05;
    };
    const rectOf = (el: Element) => (el as HTMLElement).getBoundingClientRect();
    const inter = (a: DOMRect, b: DOMRect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const area = (r: DOMRect) => Math.max(0, r.width) * Math.max(0, r.height);

    // 컨트롤(입력 박스). ⚠ .vs__search 제외: vue-select의 **오버레이 검색 input** — 선택값(.vs__selected) 위에
    //   같은 위치로 겹쳐 렌더되는 게 정상 구조라 오탐 유발(1런: 등급값 A/B+↔vs__search 100% 오탐). .v-select 위젯 단위로만 취급.
    const controls = (Array.from(root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not(.vs__search), textarea, select, .v-select, .vs__dropdown-toggle, .datepicker-input')) as HTMLElement[]).filter(isVis);
    // 라벨성 텍스트 요소 — own-text(직접 텍스트) 보유 + 컨트롤/버튼 자신은 제외 + 짧은 라벨(≤40자).
    //   ⚠ vue-select 선택값(.vs__selected)·옵션(.vs__dropdown-option)은 라벨 아님(데이터/선택값) → 제외.
    const CTRL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'OPTION']);
    const labels = (Array.from(root.querySelectorAll('label, dt, th, span, strong, p, div, em')) as HTMLElement[]).filter((el) => {
      if (!isVis(el) || CTRL_TAGS.has(el.tagName) || el.closest('.side-navbar-container')) return false;
      if (el.closest('.vs__selected, .vs__dropdown-menu, .vs__selected-options')) return false;   // vue-select 선택값/옵션 = 라벨 아님
      if (el.querySelector('input, textarea, select, .v-select')) return false;   // 컨트롤을 감싼 컨테이너 제외
      const own = norm(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' '));
      return !!own && own.length <= 40;
    });

    const cls = (el: Element) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || '')).slice(0, 40);
    const pairs: any[] = [];
    const seen = new Set<string>();
    for (const L of labels) {
      const lr = rectOf(L); const la = area(lr); if (la <= 0) continue;
      const lt = norm(Array.from(L.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' '));
      for (const C of controls) {
        if (C.contains(L) || L.contains(C)) continue;   // 포함관계(라벨이 컨트롤 안/밖 래퍼)는 겹침 아님
        // 같은 vue-select 위젯 내부 라벨↔컨트롤은 정상 구조(선택값/검색 오버레이) → 제외
        const vsL = L.closest('.v-select, .vs__dropdown-toggle'); const vsC = C.closest('.v-select, .vs__dropdown-toggle');
        if (vsL && vsL === vsC) continue;
        const cr = rectOf(C); const ov = inter(lr, cr);
        if (ov <= 0) continue;
        const r = ov / Math.min(la, area(cr) || la);
        if (r >= ratio) {
          const key = `${lt}|${cls(C)}`;
          if (seen.has(key)) continue; seen.add(key);
          pairs.push({ label: lt.slice(0, 30), labelCls: cls(L), ctrlTag: C.tagName.toLowerCase(), ctrlCls: cls(C), overlap: Math.round(r * 100), px: Math.round(ov) });
        }
      }
    }
    return { pairs: pairs.slice(0, 20), labels: labels.length, controls: controls.length, scope: scope.slice(0, 40) };
  }, ratio).catch(() => ({ pairs: [], labels: 0, controls: 0, scope: '(evaluate 실패)' }));
}

export async function runCourseLangOverlap(admin: Page, lang: CourseLang): Promise<void> {
  const seen = new Set<string>();
  for (const f of OVERLAP_FORMS) {
    const tcRef = `코스관리_다국어_레이아웃겹침_${f.menu}`;
    const base: CheckMeta = { path: `${f.label} > 레이아웃 겹침`, tcRef, tcId: `LANGOVL-${lang.ko}`, desc: `${lang.ko}(${lang.label}) 번역 라벨↔입력박스 겹침 검출` };
    try {
      // ⚠ 직전 단계(파일명 검증)가 외국어로 끝났을 수 있음 → KO 원복 선행(Home은 영문 route라 진입돼도
      //   콘텐츠가 외국어면 '목표 설정'(한글) 트리거 미발견 = 1런 확인된 근본원인).
      await ensureCourseKorean(admin);
      const sub = f.sub && f.sub !== f.menu ? f.sub : undefined;
      if (!(await enterCourseMenu(admin, f.menu, sub))) { skip(base, '진입 실패'); continue; }
      if (isLoggedOut(admin)) { skip(base, '세션 만료/로그아웃 — 재인증 필요(course:auth)'); continue; }
      await killAlarms(admin); await settle(admin, 700);
      await ensureCourseKorean(admin);   // 진입 후에도 콘텐츠 KO 보장(트리거 한글 매칭 위해)
      // 탭 이동(있으면) — KO 텍스트로 클릭
      if (f.tab) {
        const t = admin.locator('.tab-group').getByText(new RegExp(f.tab), { exact: false }).first();
        if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click().catch(() => {}); await settle(admin, 700); }
      }
      // ★ 전환 먼저 + 마커/좌표로 언어 독립 오픈 — 목표 설정 모달이 헤더 스위처(.select-btn)를 덮어
      //   "모달 먼저→전환" 은 전환 차단(1런 확인). "전환 먼저→넓은 nth" 는 인덱스 드리프트(1런 확인).
      //   해결: KO에서 트리거 요소에 data-attr 마커 + 좌표 기록 → 전환(모달 없어 성공) → 마커 살면 마커, 죽으면 좌표 클릭.
      const inputSel = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, .v-select';
      const trg = admin.locator('.contents, main').getByText(new RegExp(f.trigger), { exact: false }).filter({ visible: true }).first();
      if (!(await trg.isVisible({ timeout: 2500 }).catch(() => false))) {
        review({ lang: lang.ko, screen: f.label, kind: '트리거 미발견 진단', item: `'${f.trigger}' 텍스트 미노출`, value: `클릭요소: ${await dumpClickables(admin)}` });
        skip(base, `트리거('${f.trigger}') 미발견 — 데이터 의존/구조 상이(진단 참조)`); continue;
      }
      const box = await trg.boundingBox().catch(() => null);
      await trg.evaluate((el) => el.setAttribute('data-e2e-goal', '1')).catch(() => {});
      const before = await admin.locator(inputSel).filter({ visible: true }).count().catch(() => 0);
      // 전환(모달 없음 → 성공)
      if (!(await switchCourseLang(admin, lang.clickLabel))) { skip(base, `${lang.clickLabel} 전환 실패`); await ensureCourseKorean(admin); continue; }
      await settle(admin, 700); await killAlarms(admin);
      // 트리거 오픈: 마커 우선(전환이 텍스트만 바꿔 살아있으면), 없으면 좌표(리렌더로 마커 소실 시)
      const mk = admin.locator('[data-e2e-goal="1"]').first();
      let via = '';
      if (await mk.count().catch(() => 0)) { await mk.click({ timeout: 3000 }).catch(() => {}); via = '마커'; }
      let modalOpen = await admin.locator('.modal-group, .modal-box').filter({ visible: true }).count().catch(() => 0);
      let after = await admin.locator(inputSel).filter({ visible: true }).count().catch(() => 0);
      if (!modalOpen && after <= before + 1 && box) { await admin.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {}); via = via ? via + '+좌표' : '좌표'; await settle(admin, 900); }
      await killAlarms(admin);
      modalOpen = await admin.locator('.modal-group, .modal-box').filter({ visible: true }).count().catch(() => 0);
      after = await admin.locator(inputSel).filter({ visible: true }).count().catch(() => 0);
      if (!modalOpen && after <= before + 1) {
        review({ lang: lang.ko, screen: f.label, kind: '모달 미오픈 진단', item: `전환 후 오픈 실패(경유 ${via || '없음'})`, value: `입력요소 ${before}→${after} · 모달 ${modalOpen} · 클릭요소: ${await dumpClickables(admin)}` });
        skip(base, `전환 후 트리거 오픈 실패(${via || '클릭 무동작'}) — 구조 확인 필요(진단 참조)`); await ensureCourseKorean(admin); continue;
      }
      const res = await scanOverlaps(admin);
      review({ lang: lang.ko, screen: f.label, kind: '겹침 스캔 진단', item: `모달 ${modalOpen ? '열림' : '미확인'}(전환후·경유 ${via}) · 스코프 ${res.scope}`, value: `FG 라벨 ${res.labels}/컨트롤 ${res.controls}/겹침 ${res.pairs.length}` });
      await closeForm(admin).catch(() => {});
      await ensureCourseKorean(admin);
      if (!res.controls) { skip(base, `전환 후 모달/입력폼 유실(컨트롤 0) — 전환 시 모달 닫힘 추정(판정 불가)`); continue; }
      const dk = `${f.label}`;
      if (seen.has(dk)) continue; seen.add(dk);
      const meta: CheckMeta = { ...base, expected: '번역 라벨이 입력 박스와 겹치지 않음(레이아웃 정상)' };
      if (res.pairs.length) {
        const desc = res.pairs.map((p) => `"${p.label}"↔${p.ctrlTag}.${(p.ctrlCls || '').split(' ')[0]}(${p.overlap}%)`).join(', ').slice(0, 200);
        record(meta, 'FAIL', { actual: `${lang.label} 모드 겹침 ${res.pairs.length}건: ${desc}`, error: '번역 라벨↔입력박스 겹침(레이아웃 파손)', detail: 'QA-15548 #2 계열 — 긴 번역 텍스트가 입력 박스 침범' });
      } else {
        record(meta, 'PASS', { actual: `${lang.label} 모드 겹침 0(라벨 ${res.labels}/컨트롤 ${res.controls} 스캔)` });
      }
    } catch (e: any) {
      const msg = (e?.message || String(e)).replace(/\s+/g, ' ').slice(0, 200);
      skip(base, `화면 처리 예외(격리·계속): ${msg}`);
      await ensureCourseKorean(admin).catch(() => {});
      await killAlarms(admin).catch(() => {});
    }
  }
  console.log(`[courseLangOverlap] ${lang.ko} — 완료`);
}
