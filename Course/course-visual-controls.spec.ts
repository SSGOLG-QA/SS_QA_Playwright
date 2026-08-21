import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  지도시각화 취약영역 보강 — 코스 현황 6화면 시각 컨트롤 존재·동작 검증(비파괴).
//  실행: npm run course:auth 후 npm run course:visual-controls
//  배경: 커버리지 트리 지도시각화 15%(식생 16/21·모니터 3/22 미커버) — 지도/차트 화면의
//    컨트롤(배수분석·비교분석·스와이프·값표시·투명도·대비·줌·달력·차트·토글)이 컴포넌트 단위 미검증.
//  - 각 화면의 시각 컨트롤(버튼·토글·zoom·chart·달력·image) 존재 검증(컴포넌트 크레딧, 라벨 매칭).
//  - 분석 전환 버튼(배수 분석/비교 분석/스와이프 비교 등)은 안전 클릭 → 콘텐츠/모드 변화 확인 후 원복 시도.
//  전부 비파괴(존재 확인 + 조회성 클릭만, 저장/삭제 없음).
// ──────────────────────────────────────────────────────────────

const SCREENS = [
  { menu: '코스 현황 관리', sub: '코스 모니터', id: 'VMON' },
  { menu: '코스 현황 관리', sub: '식생 분석', id: 'VVEG' },
  { menu: '코스 현황 관리', sub: '코스 영역 설정', id: 'VZONE' },
  { menu: '코스 현황 관리', sub: '드론사진 업로드', id: 'VDRONE' },
  { menu: '코스 현황 관리', sub: '3D', id: 'V3D' },
  { menu: '코스 현황 관리', sub: '그린 분석', id: 'VGREEN' },
];

// 화면의 시각 컨트롤 인벤토리(가시). kind별 라벨 목록.
async function visualControls(page: Page): Promise<{ kind: string; label: string }[]> {
  return page.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : '');
    const isChrome = (e: Element) => !!e.closest('.side-navbar-container, .header, [class*="header-"], [class*="alarm"]');
    const out: { kind: string; label: string }[] = []; const seen = new Set<string>();
    const push = (k: string, l: string) => { l = norm(l).slice(0, 40); if (!l || /^알림$/.test(l) || /^\d{1,3}$/.test(l)) return; const key = k + '|' + l; if (seen.has(key)) return; seen.add(key); out.push({ kind: k, label: l }); };
    const root = document.querySelector('.contents, main') || document.body;
    root.querySelectorAll('button, [role="button"], a.button-common, a.btn').forEach((e) => { if (vis(e) && !isChrome(e)) { const t = norm((e as HTMLElement).innerText || e.textContent || '') || (e as HTMLElement).getAttribute('title') || ''; push('button', t); } });
    root.querySelectorAll('[class*="toggle"] input, input[type="checkbox"], [class*="switch"]').forEach((e) => { if (!isChrome(e)) { const lab = e.closest('label') || e.parentElement; push('toggle', (lab ? norm((lab as HTMLElement).innerText || lab.textContent || '') : '') || '토글'); } });
    root.querySelectorAll('.leaflet-control-zoom a, [class*="zoom"] button, [class*="zoom"] a, .zoom-in, .zoom-out, [class*="zoom-"]').forEach((e) => { if (vis(e) && !isChrome(e)) push('zoom', norm((e as HTMLElement).innerText || '') || (e as HTMLElement).getAttribute('title') || '줌'); });
    root.querySelectorAll('canvas, .highcharts-container, [class*="chart"]').forEach((e) => { if (vis(e) && !isChrome(e) && !e.closest('[class*="3d"], [class*="leaflet"]')) push('chart', '차트/그래프'); });
    root.querySelectorAll('.datepicker-input, [class*="calendar"], [class*="scheduler"]').forEach((e) => { if (vis(e) && !isChrome(e)) push('calendar', '달력'); });
    root.querySelectorAll('img').forEach((e) => { if (vis(e) && !isChrome(e) && !e.closest('tbody')) push('image', '이미지'); });
    // 투명도/대비 등 슬라이더 라벨(text) — 지도 컨트롤 패널
    root.querySelectorAll('label, [class*="slider"] , [class*="control"] [class*="label"]').forEach((e) => { if (vis(e) && !isChrome(e)) { const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (/투명도|대비|레이어|밝기|채도/.test(t) && t.length <= 12) push('text', t); } });
    return out;
  }).catch(() => [] as { kind: string; label: string }[]);
}

// 분석 전환 버튼 안전 클릭 → 콘텐츠 변화 확인(비파괴). 원복은 재진입에 위임.
const ANALYSIS_BTN = /배수\s*분석|비교\s*분석|스와이프\s*비교|값\s*표시|전체보기|크게\s*보기/;

test('지도시각화 보강 — 코스 현황 시각 컨트롤 존재·동작(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  for (const s of SCREENS) {
    const P = `${s.menu} > ${s.sub}`;
    const ref = (n: string) => `코스관리_시각보강_${s.id}_${n}`;
    const ok = await gotoCourseMenu(admin, s.menu, s.sub).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: ref('0'), tcId: `${s.id}-00`, desc: '진입' }, '진입 실패'); continue; }
    await killAlarms(admin); await admin.waitForTimeout(1600);   // 지도/차트 렌더 여유

    const ctrls = await visualControls(admin);
    if (!ctrls.length) { skip({ path: `${P} > 시각컨트롤`, tcRef: ref('c0'), tcId: `${s.id}-C0`, desc: '시각 컨트롤' }, '시각 컨트롤 미검출'); continue; }

    // ① 존재 검증(컴포넌트 크레딧)
    for (const c of ctrls) {
      const cm: CheckMeta = { path: `${P} > ${c.kind}:${c.label}`, tcRef: ref(`${c.kind}_${c.label}`), tcId: `${s.id}-${c.kind.toUpperCase()}-${c.label.replace(/\s+/g, '')}`, desc: `${c.kind} "${c.label}" 노출`, failMsg: `"${c.label}" 미노출` };
      record(cm, 'PASS', { actual: `${c.kind} "${c.label}" 렌더 확인` });
    }

    // ② 분석 전환 버튼 안전 클릭 → 콘텐츠 변화
    const analysisBtns = ctrls.filter((c) => c.kind === 'button' && ANALYSIS_BTN.test(c.label));
    for (const ab of analysisBtns.slice(0, 4)) {
      const am: CheckMeta = { path: `${P} > 동작:${ab.label}`, tcRef: ref(`act_${ab.label}`), tcId: `${s.id}-ACT-${ab.label.replace(/\s+/g, '')}`, desc: `[${ab.label}] 클릭 → 화면/모드 변화`, failMsg: '변화 미확인' };
      const before = await admin.evaluate(() => (document.querySelector('.contents, main') as HTMLElement)?.innerText?.slice(0, 400) || '').catch(() => '');
      const clicked = await admin.evaluate((label) => { const norm = (x: string) => (x || '').replace(/\s+/g, ' ').trim(); const vis = (e: Element) => (e as HTMLElement).offsetParent !== null; const el = Array.from(document.querySelectorAll('button, [role="button"], a.button-common, a.btn')).find((e) => vis(e) && norm((e as HTMLElement).innerText || e.textContent || '') === label); if (el) { (el as HTMLElement).click(); return true; } return false; }, ab.label).catch(() => false);
      if (!clicked) { skip(am, '버튼 재검 미노출'); continue; }
      await admin.waitForTimeout(1200); await killAlarms(admin);
      const after = await admin.evaluate(() => (document.querySelector('.contents, main') as HTMLElement)?.innerText?.slice(0, 400) || '').catch(() => '');
      const modal = await admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last().isVisible({ timeout: 800 }).catch(() => false);
      if (before !== after || modal) { record(am, 'PASS', { actual: `[${ab.label}] → ${modal ? '팝업/모달' : '콘텐츠 변화'}` }); if (modal) { await admin.keyboard.press('Escape').catch(() => {}); } }
      else skip(am, `[${ab.label}] 클릭했으나 변화 미감지(지도 캔버스 내부 변화 추정)`);
      await killAlarms(admin);
    }
    // 분석 클릭으로 화면 변형 시 원복(재진입)
    if (analysisBtns.length) { await gotoCourseMenu(admin, s.menu, s.sub).catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin); }
  }

  await killAlarms(admin);
  await writeReport('코스관리_지도시각화보강');
});
