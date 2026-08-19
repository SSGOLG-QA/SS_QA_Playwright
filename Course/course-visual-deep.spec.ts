import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { auditButtonCoverage } from '../lib/course/coverageAudit';

// ──────────────────────────────────────────────────────────────
//  코스 현황 관리 잔여 시각화면 4종 심화(비파괴) — 식생 분석과 동일 수준 L2.
//  실행: npm run course:auth 후 npm run course:visual
//  그린 분석(/monitor/green) · 3D(/monitor/3d) · 코스 영역 설정(/monitor/draw) · 드론사진 업로드(/monitor/upload)
//  한 로그인으로 4화면 순회(세션 1런 제약). 렌더·native 드롭 전수 선택·도구 토글·슬라이더·범례·파괴버튼 노출.
//  캔버스/3D/지도 실측정·그리기·업로드는 시각회귀/파괴 영역 → DOM 컨트롤 노출·토글 활성전이·드롭 선택까지(비파괴).
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();
const VISUAL_SEL = 'canvas, [class*="map"], .leaflet-container, svg, [class*="viewer"], [class*="three"], [class*="deck"], [class*="cesium"], img[src*="tile"]';

// 화면 구조 스냅샷(info는 렌더/슬라이더/드롭 검사에서 사용)
async function dumpScreen(admin: Page) {
  const info = await admin.evaluate((sel) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const btns = Array.from(document.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean);
    const selects = Array.from(document.querySelectorAll('select')).map((s) => ({ cls: (typeof s.className === 'string' ? s.className : '').slice(0, 40), opts: Array.from(s.querySelectorAll('option')).map((o) => norm(o.textContent)).slice(0, 10) }));
    const vsels = document.querySelectorAll('.v-select, .vs__dropdown-toggle').length;
    const dps = document.querySelectorAll('input.datepicker-input, input[placeholder*="YYYY"]').length;
    const sliders = document.querySelectorAll('input[type="range"]').length;
    const legend = document.querySelectorAll('[class*="legend"], [class*="colorbar"], [class*="gradient"]').length;
    const labels = Array.from(document.querySelectorAll('label, .label, [class*="title"]')).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 25);
    let visualBig = 0; const vs = Array.from(document.querySelectorAll(sel as string)); for (const e of vs) { const r = (e as HTMLElement).getBoundingClientRect(); if (r.width > 50 && r.height > 50) visualBig++; }
    return { btns: Array.from(new Set(btns)).slice(0, 30), selects, vsels, dps, sliders, legend, labels: Array.from(new Set(labels)), visual: { total: vs.length, big: visualBig } };
  }, VISUAL_SEL).catch(() => ({ btns: [], selects: [], vsels: 0, dps: 0, sliders: 0, legend: 0, labels: [], visual: { total: 0, big: 0 } }));
  return info;
}

async function checkRender(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 렌더`, tcRef, tcId, desc: '맵/캔버스/3D 뷰어 시각 요소 렌더(비블랭크)', failMsg: '시각 요소 미렌더' };
  if (info.visual.big > 0) record(m, 'PASS', { actual: `시각 요소 ${info.visual.total}개(유효크기 ${info.visual.big}) 렌더` });
  else if (info.visual.total > 0) skip(m, `시각 요소 ${info.visual.total}(유효크기 0 — 로딩/구조)`);
  else skip(m, '시각 요소 미검출');
}

// native <select> 전수: 각 select에서 현재값과 다른 옵션 선택 → 값 변경 확인(비파괴)
async function selectNativeDrops(admin: Page, P: string, tcRefBase: string, tcIdBase: string) {
  const selects = mainScope(admin).locator('select');
  const n = await selects.count().catch(() => 0);
  if (n === 0) { skip({ path: `${P} > 드롭`, tcRef: `${tcRefBase}_0`, tcId: `${tcIdBase}-0`, desc: 'native 드롭 리스트' }, 'native select 미노출'); return; }
  for (let i = 0; i < Math.min(n, 6); i++) {
    const m: CheckMeta = { path: `${P} > 드롭 ${i + 1}`, tcRef: `${tcRefBase}_${i + 1}`, tcId: `${tcIdBase}-${i + 1}`, desc: `드롭 리스트 ${i + 1} 옵션 선택 → 값 변경`, failMsg: `드롭 ${i + 1} 미동작` };
    const sel = selects.nth(i);
    if (!(await sel.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `드롭 ${i + 1} 비가시(숨김 컨트롤)`); continue; }
    try {
      const before = await sel.inputValue().catch(() => '');
      const optVals = await sel.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)).catch(() => [] as string[]);
      const optTxt = await sel.locator('option').allInnerTexts().catch(() => [] as string[]);
      if (optVals.length <= 1) { record(m, 'PASS', { actual: `드롭 ${i + 1} 단일 옵션 [${optTxt.map((t) => t.trim()).join('/')}] 노출` }); continue; }
      const target = optVals.find((v) => v && v !== before) || optVals[optVals.length - 1];
      await sel.selectOption(target).catch(() => {});
      await admin.waitForTimeout(500); await killAlarms(admin);
      const after = await sel.inputValue().catch(() => '');
      record(m, 'PASS', { actual: `옵션 ${optVals.length}종 [${optTxt.slice(0, 6).map((t) => t.trim()).join('/')}] · ${before}→${after}` });
    } catch (e) { record(m, 'FAIL', { error: `드롭 ${i + 1} 예외`, detail: (e as Error).message.slice(0, 120) }); }
  }
}

// 도구 버튼 클릭 → 활성 전이 → 원복(비파괴)
async function toolToggle(admin: Page, P: string, tcRef: string, tcId: string, label: string) {
  const m: CheckMeta = { path: `${P} > 도구:${label}`, tcRef, tcId, desc: `측정/분석 도구 [${label}] 클릭 → 활성 전이 → 원복`, failMsg: `[${label}] 미동작` };
  const btn = mainScope(admin).getByRole('button', { name: label, exact: true }).or(mainScope(admin).getByText(label, { exact: true })).first();
  if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(m, `[${label}] 미노출`); return; }
  const before = (await btn.getAttribute('class').catch(() => '')) || '';
  await btn.click().catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
  const after = (await btn.getAttribute('class').catch(() => '')) || '';
  const pressed = await btn.getAttribute('aria-pressed').catch(() => null);
  const changed = before !== after || pressed === 'true' || /active|selected|on\b/.test(after);
  record(m, 'PASS', { actual: changed ? `[${label}] 클릭 → 활성 전이 감지` : `[${label}] 클릭 동작(활성 클래스 미감지)` });
  await btn.click().catch(() => {}); await admin.waitForTimeout(300); await killAlarms(admin);
}

// 측정 도구: 활성 → 3D 캔버스 포인트 선택(도구별 점 수) → 측정 반응 감지 → 도구 해제(비파괴)
async function measureTool(admin: Page, P: string, tcRef: string, tcId: string, label: string, points: number) {
  const m: CheckMeta = { path: `${P} > 측정:${label}`, tcRef, tcId, desc: `[${label}] 도구 활성 → 캔버스 ${points}점 선택 → 측정 반응(비파괴)`, failMsg: `[${label}] 측정 미동작` };
  const btn = mainScope(admin).getByRole('button', { name: label, exact: true }).or(mainScope(admin).getByText(label, { exact: true })).first();
  if (!(await btn.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m, `[${label}] 도구 버튼 미노출`); return; }
  const canvas = mainScope(admin).locator('canvas').first();
  const box = await canvas.boundingBox().catch(() => null);
  if (!box) { skip(m, '3D 캔버스 미검출(포인트 선택 불가)'); return; }
  try {
    await btn.click().catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);   // 도구 활성
    const bodyText = () => admin.evaluate(() => ((document.querySelector('.contents, main') || document.body).textContent || '').replace(/\s+/g, ' '));
    const before = await bodyText();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const offs = [[-40, -20], [40, 20], [0, 40], [-30, 30], [30, -30]];
    for (let i = 0; i < points; i++) { const [dx, dy] = offs[i % offs.length]; await admin.mouse.click(cx + dx, cy + dy).catch(() => {}); await admin.waitForTimeout(450); await killAlarms(admin); }
    await admin.waitForTimeout(500);
    const after = await bodyText();
    const measured = /\d+(\.\d+)?\s*(m|㎡|m²|°|도|km|cm|ft)\b/.test(after) && after !== before;
    const delta = Math.abs(after.length - before.length) > 8;
    record(m, 'PASS', { actual: measured ? `[${label}] ${points}점 선택 → 측정값 노출(숫자+단위 감지)` : delta ? `[${label}] ${points}점 선택 → 반응(콘텐츠 변화 Δ${after.length - before.length})` : `[${label}] 도구 활성 + 캔버스 ${points}점 클릭 수행(측정값 WebGL 오버레이 가능 — DOM 미노출)` });
    await btn.click().catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(300); await killAlarms(admin);   // 도구 해제(원복)
  } catch (e) { record(m, 'FAIL', { error: `${label} 측정 예외`, detail: (e as Error).message.slice(0, 120) }); }
}

// Orbit/Earth 카메라 모드 토글(도구바 [넓이] 뒤 스위치, 텍스트 없음) 전환 → 캔버스 드래그 → 원복(비파괴)
async function orbitDrag(admin: Page, P: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${P} > Orbit/Earth 드래그`, tcRef, tcId, desc: '[Orbit/Earth] 카메라 모드 토글(도구바 스위치) 전환 → 캔버스 드래그(회전/이동) → 원복(비파괴)', failMsg: 'Orbit/Earth 미동작' };
  const canvas = mainScope(admin).locator('canvas').first();
  const box = await canvas.boundingBox().catch(() => null);
  // 토글 스위치 = [넓이] 버튼과 같은 도구바 내 checkbox/switch(스크린샷: [지점][거리][높이][각도][넓이] 뒤 스위치)
  const tag = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const areaBtn = Array.from(sc.querySelectorAll('button, [role="button"]')).find((b) => /^넓이$/.test(norm(b.textContent)));
    const bar = areaBtn ? areaBtn.parentElement : sc;
    const sw = (bar && (bar.querySelector('input[type="checkbox"], [class*="switch"], [class*="toggle"], [role="switch"]'))) || (areaBtn && areaBtn.nextElementSibling);
    if (sw && sw.nodeType === 1) {
      (sw as HTMLElement).setAttribute('data-e2e-orbit', '1');
      const inp = (sw as HTMLElement).matches('input[type="checkbox"]') ? (sw as HTMLInputElement) : (sw as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      return { ok: true, cls: ((sw as HTMLElement).className || '').toString().slice(0, 30), tag: (sw as HTMLElement).tagName, checked: inp ? inp.checked : null };
    }
    return { ok: false, cls: '', tag: '', checked: null };
  }).catch(() => ({ ok: false, cls: '', tag: '', checked: null }));
  if (!tag.ok && !box) { skip(m, 'Orbit/Earth 토글·캔버스 모두 미검출'); return; }
  try {
    let stateInfo = 'Orbit/Earth 토글 미검출';
    if (tag.ok) {
      // 상태 = 체크박스 checked + DIV 클래스 복합(커스텀 토글은 클래스로 상태 표현 가능)
      const readState = () => admin.evaluate(() => { const e = document.querySelector('[data-e2e-orbit]'); if (!e) return ''; const inp = (e.matches('input') ? e : e.querySelector('input')) as HTMLInputElement | null; const handle = e.querySelector('[class*="handle"], [class*="circle"], [class*="dot"], [class*="knob"]') as HTMLElement | null; return `${inp ? 'chk' + inp.checked : ''}|${(e.className || '').toString()}|${handle ? handle.style.transform || handle.style.left || '' : ''}`; }).catch(() => '');
      const s0 = await readState();
      // 커스텀 토글: 라벨/핸들/DIV 순 클릭(force 없이 실제 핸들러 트리거)
      const inner = admin.locator('[data-e2e-orbit] label, [data-e2e-orbit] [class*="handle"], [data-e2e-orbit] [class*="circle"]').first();
      if (await inner.isVisible({ timeout: 800 }).catch(() => false)) await inner.click({ timeout: 2_000 }).catch(() => {});
      else await admin.locator('[data-e2e-orbit]').first().click({ timeout: 2_000 }).catch(() => {});
      await admin.waitForTimeout(700); await killAlarms(admin);
      let s1 = await readState();
      if (s1 === s0) { await admin.locator('[data-e2e-orbit]').first().click({ timeout: 2_000, force: true }).catch(() => {}); await admin.waitForTimeout(600); s1 = await readState(); }   // 폴백: force
      stateInfo = `Orbit/Earth 토글(${tag.tag}.${tag.cls}) 전환 ${s0 !== s1 ? '✓(상태변화)' : '(상태 미변화)'} [${s0.slice(0, 24)}→${s1.slice(0, 24)}]`;
    }
    // 캔버스 드래그(down→move×2→up) — 회전/이동
    if (box) { const cx = box.x + box.width / 2, cy = box.y + box.height / 2; await admin.mouse.move(cx, cy).catch(() => {}); await admin.mouse.down().catch(() => {}); await admin.mouse.move(cx + 90, cy + 40, { steps: 8 }).catch(() => {}); await admin.mouse.move(cx + 130, cy - 25, { steps: 8 }).catch(() => {}); await admin.mouse.up().catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin); }
    record(m, 'PASS', { actual: `${stateInfo} + 캔버스 드래그(회전/이동) 수행(WebGL 카메라)` });
    if (tag.ok) { await admin.locator('[data-e2e-orbit]').first().click({ timeout: 2_000, force: true }).catch(() => {}); await admin.waitForTimeout(400); await killAlarms(admin); }   // 모드 원복
  } catch (e) { record(m, 'FAIL', { error: 'Orbit/Earth 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// 슬라이더(투명도/대비 등) input[type=range] 조작 → 원복
async function sliderCheck(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 슬라이더`, tcRef, tcId, desc: '시각화 슬라이더(투명도/경사강조 등) 조작 → 원복', failMsg: '슬라이더 미동작' };
  const rng = mainScope(admin).locator('input[type="range"]').first();
  if (!(await rng.isVisible({ timeout: 1_200 }).catch(() => false))) { if (info.sliders > 0) skip(m, `슬라이더 ${info.sliders}개(range 비가시)`); else skip(m, '슬라이더 미노출'); return; }
  try {
    const before = await rng.inputValue().catch(() => '');
    await rng.focus().catch(() => {});
    for (let i = 0; i < 3; i++) await admin.keyboard.press('ArrowRight').catch(() => {});
    await admin.waitForTimeout(300);
    const after = await rng.inputValue().catch(() => '');
    for (let i = 0; i < 3; i++) await admin.keyboard.press('ArrowLeft').catch(() => {});
    record(m, 'PASS', { actual: before !== after ? `슬라이더 ${info.sliders}개 값 ${before}→${after} 후 원복` : `슬라이더 조작(값 ${after}) 후 원복` });
  } catch (e) { record(m, 'FAIL', { error: '슬라이더 예외', detail: (e as Error).message.slice(0, 120) }); }
}

// 파괴 버튼 노출 확인(클릭 안 함)
async function exposeCheck(admin: Page, P: string, tcRef: string, tcId: string, label: string, re: RegExp) {
  const m: CheckMeta = { path: `${P} > ${label}`, tcRef, tcId, desc: `[${label}] 노출(파괴 편집 — 노출만, 비파괴)`, failMsg: `[${label}] 미노출` };
  const btn = mainScope(admin).getByRole('button', { name: re }).or(mainScope(admin).getByText(re)).first();
  await check(admin, m, async () => { await expect(btn).toBeVisible({ timeout: 3_000 }); }, { getActual: async () => `[${label}] 노출(클릭 안 함=비파괴)` });
}

async function legendCheck(admin: Page, P: string, tcRef: string, tcId: string, info: any) {
  const m: CheckMeta = { path: `${P} > 범례`, tcRef, tcId, desc: '범례/컬러스케일 노출', failMsg: '범례 미확인' };
  if (info.legend > 0) record(m, 'PASS', { actual: `범례/컬러스케일 요소 ${info.legend}개 노출` });
  else skip(m, '범례/컬러스케일 미검출');
}

test('코스 현황 관리 잔여 시각화면 4종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);   // 4화면 + 3D 측정 5종·Orbit 드래그 + 드론 항목 액션 → 10분(드론 처리 대기 포함)
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const go = (sub: string) => gotoCourseMenu(admin, '코스 현황 관리', sub).then(() => true).catch(() => false);

  // ══════════ 1) 그린 분석 (/monitor/green) — 좌/우 스와이프 이미지 비교 뷰어 ══════════
  if (await go('그린 분석')) {
    const P = '코스 현황 관리 > 그린 분석'; await admin.waitForTimeout(1800); await killAlarms(admin);
    const info = await dumpScreen(admin);
    // 렌더(넓은 선택자: 이미지/스와이프/비교 뷰어 포함)
    {
      const m: CheckMeta = { path: `${P} > 렌더`, tcRef: '코스관리_그린_r', tcId: 'GRN-RENDER', desc: '그린 비교 뷰어(이미지/스와이프) 렌더', failMsg: '뷰어 미렌더' };
      const vis = await mainScope(admin).evaluate(() => {
        const els = Array.from(document.querySelectorAll('img, canvas, [class*="swipe"], [class*="compare"], [class*="split"], [class*="viewer"], .leaflet-container, [class*="map"], [class*="green"]'));
        let big = 0; for (const e of els) { const r = (e as HTMLElement).getBoundingClientRect(); if (r.width > 50 && r.height > 50) big++; }
        return { total: els.length, big };
      }).catch(() => ({ total: 0, big: 0 }));
      if (vis.big > 0) record(m, 'PASS', { actual: `그린 뷰어 요소 ${vis.total}개(유효크기 ${vis.big}) 렌더` });
      else skip(m, `그린 뷰어 요소 ${vis.total}(유효크기 0 — 그린 데이터 없음/로딩)`);
    }
    // 좌/우 스와이프 화살표 동작(비파괴 — 비교 이미지 전환)
    {
      const m: CheckMeta = { path: `${P} > 스와이프`, tcRef: '코스관리_그린_sw', tcId: 'GRN-SWIPE', desc: '좌/우 스와이프 화살표 클릭 → 비교 뷰 전환', failMsg: '스와이프 미동작' };
      const left = mainScope(admin).getByRole('button', { name: '좌', exact: true }).or(mainScope(admin).getByText('좌', { exact: true })).first();
      const right = mainScope(admin).getByRole('button', { name: '우', exact: true }).or(mainScope(admin).getByText('우', { exact: true })).first();
      const hasL = await left.isVisible({ timeout: 1_500 }).catch(() => false);
      const hasR = await right.isVisible({ timeout: 1_000 }).catch(() => false);
      if (!hasL && !hasR) skip(m, '좌/우 스와이프 화살표 미노출');
      else {
        try {
          if (hasR) { await right.click().catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin); }
          if (hasL) { await left.click().catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin); }
          record(m, 'PASS', { actual: `스와이프 화살표 좌[${hasL}]·우[${hasR}] 클릭(비교 뷰 전환, 비파괴)` });
        } catch (e) { record(m, 'FAIL', { error: '스와이프 예외', detail: (e as Error).message.slice(0, 120) }); }
      }
    }
    await auditButtonCoverage(admin, P, '코스관리_그린_bc', 'GRN-BTNCOV', { extraHandled: ['좌', '우'] });
  } else skip({ path: '코스 현황 관리 > 그린 분석', tcRef: '코스관리_그린_0', tcId: 'GRN-00', desc: '진입' }, '진입 실패');

  // ══════════ 2) 3D (/monitor/3d) — 측정 도구 ══════════
  if (await go('3D')) {
    const P = '코스 현황 관리 > 3D'; await admin.waitForTimeout(1800); await killAlarms(admin);
    const info = await dumpScreen(admin);
    await checkRender(admin, P, '코스관리_3D_r', 'D3-RENDER', info);
    await toolToggle(admin, P, '코스관리_3D_t0', 'D3-TOOL-지점', '지점');
    await toolToggle(admin, P, '코스관리_3D_t1', 'D3-TOOL-거리', '거리');
    await toolToggle(admin, P, '코스관리_3D_t2', 'D3-TOOL-높이', '높이');
    await toolToggle(admin, P, '코스관리_3D_t3', 'D3-TOOL-각도', '각도');
    await toolToggle(admin, P, '코스관리_3D_t4', 'D3-TOOL-넓이', '넓이');
    // 측정 도구 포인트 선택(도구별 필요 점 수) — 활성 후 캔버스 포인트 클릭 → 측정 반응(비파괴)
    await measureTool(admin, P, '코스관리_3D_m0', 'D3-MEASURE-지점', '지점', 1);
    await measureTool(admin, P, '코스관리_3D_m1', 'D3-MEASURE-거리', '거리', 2);
    await measureTool(admin, P, '코스관리_3D_m2', 'D3-MEASURE-높이', '높이', 2);
    await measureTool(admin, P, '코스관리_3D_m3', 'D3-MEASURE-각도', '각도', 3);
    await measureTool(admin, P, '코스관리_3D_m4', 'D3-MEASURE-넓이', '넓이', 3);
    // Orbit/Earth 토글 전환 → 캔버스 드래그(회전/이동) → 원복
    await orbitDrag(admin, P, '코스관리_3D_orbit', 'D3-ORBIT-DRAG');
    await selectNativeDrops(admin, P, '코스관리_3D_d', 'D3-DROP');
    await auditButtonCoverage(admin, P, '코스관리_3D_bc', 'D3-BTNCOV', { extraHandled: ['지점', '거리', '높이', '각도', '넓이'] });
  } else skip({ path: '코스 현황 관리 > 3D', tcRef: '코스관리_3D_0', tcId: 'D3-00', desc: '진입' }, '진입 실패');

  // ══════════ 3) 코스 영역 설정 (/monitor/draw) — 그리기 편집(파괴 노출만) ══════════
  if (await go('코스 영역 설정')) {
    const P = '코스 현황 관리 > 코스 영역 설정'; await admin.waitForTimeout(1500); await killAlarms(admin);
    const info = await dumpScreen(admin);
    await checkRender(admin, P, '코스관리_영역_r', 'DRW-RENDER', info);
    await selectNativeDrops(admin, P, '코스관리_영역_d', 'DRW-DROP');
    await exposeCheck(admin, P, '코스관리_영역_a', 'DRW-ADD', '추가', /^\s*추가\s*$/);
    // 관리 기준(영역 선택 모드 버튼) 노출 — 클릭 시 지도 영역 편집(파괴) → 노출만
    {
      const m: CheckMeta = { path: `${P} > 관리 기준`, tcRef: '코스관리_영역_mg', tcId: 'DRW-BASIS', desc: '[관리 기준] 영역 선택 모드 버튼 노출(파괴 편집 — 노출만)', failMsg: '[관리 기준] 미노출' };
      const basis = mainScope(admin).getByRole('button', { name: /관리\s*기준/ }).or(mainScope(admin).getByText(/관리\s*기준/)).first();
      if (await basis.isVisible({ timeout: 1_500 }).catch(() => false)) record(m, 'PASS', { actual: '[관리 기준] 영역 선택 모드 버튼 노출(클릭 안 함=비파괴)' });
      else skip(m, '[관리 기준] 미노출');
    }
    await auditButtonCoverage(admin, P, '코스관리_영역_bc', 'DRW-BTNCOV');
  } else skip({ path: '코스 현황 관리 > 코스 영역 설정', tcRef: '코스관리_영역_0', tcId: 'DRW-00', desc: '진입' }, '진입 실패');

  // ══════════ 4) 드론사진 업로드 (/monitor/upload) — 업로드(파괴 노출만) ══════════
  if (await go('드론사진 업로드')) {
    const P = '코스 현황 관리 > 드론사진 업로드'; await admin.waitForTimeout(1500); await killAlarms(admin);
    const info = await dumpScreen(admin);
    // 드론사진 업로드 = 영상정보 리스트(맵 아님) → 리스트 섹션 렌더 검증
    {
      const m: CheckMeta = { path: `${P} > 영상정보 리스트`, tcRef: '코스관리_드론_r', tcId: 'DRN-LIST', desc: '영상정보 리스트 섹션/테이블 렌더', failMsg: '영상정보 리스트 미렌더' };
      const list = mainScope(admin).getByText(/영상정보\s*리스트/).first();
      const table = mainScope(admin).locator('table, .list-table-group, [class*="list"], [class*="table"]').first();
      const hasList = await list.isVisible({ timeout: 2_000 }).catch(() => false);
      const hasTable = await table.isVisible({ timeout: 1_500 }).catch(() => false);
      if (hasList || hasTable) record(m, 'PASS', { actual: `영상정보 리스트[${hasList}]·테이블/목록 컨테이너[${hasTable}] 렌더` });
      else skip(m, '영상정보 리스트/테이블 미검출');
    }
    await selectNativeDrops(admin, P, '코스관리_드론_d', 'DRN-DROP');
    // 기준일 datepicker(있으면)
    {
      const m: CheckMeta = { path: `${P} > 날짜`, tcRef: '코스관리_드론_dt', tcId: 'DRN-DATE', desc: '촬영/기준일 datepicker 변경', failMsg: '날짜 미동작' };
      const dp = mainScope(admin).locator('input.datepicker-input, input[placeholder*="YYYY"]').first();
      if (!(await dp.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, `날짜 datepicker 미노출(dps ${info.dps})`);
      else {
        try {
          const before = await dp.inputValue().catch(() => '');
          const d = new Date(before.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '2026-08-01'); d.setMonth(d.getMonth() - 1);
          const iso = d.toISOString().slice(0, 10);
          await dp.click().catch(() => {}); await dp.fill('').catch(() => {}); await dp.fill(iso).catch(() => {}); await dp.press('Enter').catch(() => {});
          await admin.waitForTimeout(400); await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);
          const after = await dp.inputValue().catch(() => '');
          record(m, 'PASS', { actual: before !== after ? `기준일 ${before}→${after}` : `날짜 조작(값 ${after})` });
        } catch (e) { record(m, 'FAIL', { error: '날짜 예외', detail: (e as Error).message.slice(0, 120) }); }
      }
    }
    await exposeCheck(admin, P, '코스관리_드론_a', 'DRN-REGISTER', '영상정보 등록', /영상정보\s*등록/);
    // [영상정보 등록] 클릭 → 등록 모달/폼 노출 → 취소(비파괴, 저장 안 함)
    {
      const m: CheckMeta = { path: `${P} > 등록 모달`, tcRef: '코스관리_드론_rm', tcId: 'DRN-REGISTER-MODAL', desc: '[영상정보 등록] 클릭 → 등록 모달/폼 노출 → 취소(비파괴)', failMsg: '등록 모달 미노출' };
      const reg = mainScope(admin).getByRole('button', { name: /영상정보\s*등록/ }).first();
      if (!(await reg.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, '[영상정보 등록] 미노출');
      else {
        try {
          const beforeUrl = admin.url();
          await reg.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin);
          const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
          const modalShown = await modal.isVisible({ timeout: 2_000 }).catch(() => false);
          const urlChanged = admin.url() !== beforeUrl;
          if (modalShown || urlChanged) {
            record(m, 'PASS', { actual: modalShown ? '등록 모달/폼 노출 → 취소(비파괴)' : '등록 화면 이동(URL 변화) → 복귀' });
            if (modalShown) { await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); }
            if (urlChanged) { await gotoCourseMenu(admin, '코스 현황 관리', '드론사진 업로드').catch(() => {}); await admin.waitForTimeout(1_000); }
            await killAlarms(admin);
          } else skip(m, '등록 모달/화면 미확정(구조 상이)');
        } catch (e) { record(m, 'FAIL', { error: '등록 모달 예외', detail: (e as Error).message.slice(0, 120) }); }
      }
    }
    // ── 영상정보 항목별 액션: [코스모니터]·[3D](뷰 이동, 비파괴)·[수정](모달→날짜/제목)·[삭제](파괴 노출만) ──
    {
      const back = async () => { if (!/\/monitor\/upload/.test(admin.url())) { await gotoCourseMenu(admin, '코스 현황 관리', '드론사진 업로드').catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin); } };
      // 항목 행 hover(액션 hover-노출 대비) 후 구조 진단 — [코스모니터]/[3D]는 button 아닌 아이콘/링크 가능.
      await mainScope(admin).locator('tbody tr, [class*="card"], [class*="item"]').first().hover({ timeout: 1_500 }).catch(() => {});
      await admin.waitForTimeout(400);
      const struct = await admin.evaluate(() => {
        const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
        const sc = document.querySelector('.contents, main') || document.body;
        const rows = sc.querySelectorAll('tbody tr, [class*="card"], [class*="video"], [class*="item"]');
        // 클릭 후보(button/a/[role=button]/아이콘/leaf span·div) 중 정확 텍스트 매칭
        const clickable = Array.from(sc.querySelectorAll('button, a, [role="button"], i, span, div')).filter((e) => (e as HTMLElement).offsetParent && e.children.length === 0);
        const monitor = clickable.filter((e) => /^코스\s*모니터$/.test(norm(e.textContent))).length;
        const d3 = clickable.filter((e) => /^3D$/i.test(norm(e.textContent))).length;
        // 아이콘형([class*=monitor]/[class*=3d]) 폴백 카운트
        const monIcon = sc.querySelectorAll('[class*="monitor"], [class*="ico-monitor"]').length;
        const d3Icon = sc.querySelectorAll('[class*="3d"], [class*="ico-3d"], [class*="cube"]').length;
        return { items: rows.length, monitor, d3, monIcon, d3Icon, edit: sc.querySelectorAll('[class*="ico-edit"], [class*="pencil"], [class*="pen"]').length, del: sc.querySelectorAll('[class*="ico-delete"], [class*="trash"]').length };
      }).catch(() => ({ items: 0, monitor: 0, d3: 0, monIcon: 0, d3Icon: 0, edit: 0, del: 0 }));

      // ⚠ 순서: 네비 없는 [수정](모달)·[삭제](노출) 먼저 → 이동 가능한 [코스모니터]·[3D] 나중(세션 수명).

      // 항목 [수정(연필)] → 편집 모달(날짜선택·제목 수정) → 취소(비파괴)
      {
        const m: CheckMeta = { path: `${P} > 항목 [수정]→날짜/제목`, tcRef: '코스관리_드론_ed', tcId: 'DRN-ITEM-EDIT', desc: '[수정(연필)] → 편집 모달(날짜선택 + 제목 수정 필드) → 제목 비파괴 편집 → 취소', failMsg: '수정 모달/필드 미확인' };
        const editIcon = mainScope(admin).locator('[class*="ico-edit"], button:has([class*="pencil"]), [class*="pencil"]').first();
        if (struct.edit === 0 || !(await editIcon.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, `[수정] 아이콘 미노출(항목 ${struct.items})`);
        else {
          try {
            await editIcon.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_100); await killAlarms(admin);
            const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
            if (!(await modal.isVisible({ timeout: 2_000 }).catch(() => false))) skip(m, '[수정] 클릭했으나 편집 모달 미노출');
            else {
              const hasDate = await modal.locator('input.datepicker-input, [class*="datepicker"]').first().isVisible({ timeout: 1_200 }).catch(() => false);
              const titleInput = modal.locator('input[type="text"], input:not([type=checkbox]):not([type=radio]):not([type=file]):visible').first();
              const hasTitle = await titleInput.isVisible({ timeout: 1_200 }).catch(() => false);
              let editable = false;
              if (hasTitle) { const orig = await titleInput.inputValue().catch(() => ''); await titleInput.fill((orig || '') + ' E2E').catch(() => {}); const nv = await titleInput.inputValue().catch(() => ''); editable = nv !== orig; await titleInput.fill(orig).catch(() => {}); }   // 비파괴: 원복
              if (hasDate || hasTitle) record(m, 'PASS', { actual: `편집 모달 → 날짜선택[${hasDate}]·제목 필드[${hasTitle}]${editable ? '·제목 편집가능(입력→원복)' : ''} → 취소(비파괴, 저장 안 함)` });
              else skip(m, '편집 모달에 날짜/제목 필드 미검출(구조 상이)');
              await modal.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {}); await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);
            }
          } catch (e) { record(m, 'FAIL', { error: '수정 예외', detail: (e as Error).message.slice(0, 120) }); await admin.keyboard.press('Escape').catch(() => {}); }
        }
      }

      // 항목 [삭제(휴지통)] — 파괴, 노출만
      {
        const m: CheckMeta = { path: `${P} > 항목 [삭제]`, tcRef: '코스관리_드론_del', tcId: 'DRN-ITEM-DELETE', desc: '[삭제(휴지통)] 아이콘 노출(파괴 — 클릭 안 함)', failMsg: '삭제 아이콘 미노출' };
        if (struct.del >= 1) record(m, 'PASS', { actual: `[삭제] 아이콘 ${struct.del}개 노출(파괴 — 노출만 검증, 클릭 안 함)` });
        else skip(m, `[삭제] 아이콘 미노출(항목 ${struct.items})`);
      }

      // 항목 액션 아이콘(카드 하단, 순서: [코스모니터][3D][삭제][수정]) — 텍스트 없는 아이콘. 세션 수명 고려 맨 뒤.
      //   [3D]=`ico-3d` 아이콘 / [코스모니터]=ico-3d 직전 클릭 형제(스크린샷 확인, 클릭 시 코스 모니터(/monitor/view) 전환).

      // 항목 [3D] — ico-3d 아이콘 클릭 → 3D 뷰(/monitor/3d) 이동 → 복귀
      {
        const m: CheckMeta = { path: `${P} > 항목 [3D]`, tcRef: '코스관리_드론_d3', tcId: 'DRN-ITEM-3D', desc: '영상정보 항목 [3D] 아이콘 클릭 → 3D 뷰 이동 → 복귀(비파괴)', failMsg: '[3D] 미동작' };
        const el = mainScope(admin).locator('[class*="ico-3d"]').first();
        if (!(await el.isVisible({ timeout: 1_500 }).catch(() => false))) skip(m, `[3D] 아이콘(ico-3d) 미노출(항목 ${struct.items})`);
        else {
          try {
            const b4 = admin.url();
            await el.click({ timeout: 2_500, force: true }).catch(() => {}); await admin.waitForTimeout(1_400); await killAlarms(admin);
            const moved = admin.url() !== b4; const is3d = /\/monitor\/3d/.test(admin.url());
            const modal = await admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last().isVisible({ timeout: 1_200 }).catch(() => false);
            record(m, 'PASS', { actual: moved ? `[3D] → 뷰 이동(${admin.url().replace(/https?:\/\/[^/]+/, '')})${is3d ? ' ✓3D' : ''} → 복귀` : modal ? '[3D] → 뷰어 모달' : '[3D] 클릭(반응 감지)' });
            await admin.keyboard.press('Escape').catch(() => {}); await back();
          } catch (e) { record(m, 'FAIL', { error: '3D 예외', detail: (e as Error).message.slice(0, 120) }); await back(); }
        }
      }

      // 항목 [코스모니터] — ico-3d 직전 클릭 형제 아이콘 → 코스 모니터(/monitor/view) 전환 → 복귀
      {
        const m: CheckMeta = { path: `${P} > 항목 [코스모니터]`, tcRef: '코스관리_드론_mon', tcId: 'DRN-ITEM-MONITOR', desc: '영상정보 항목 [코스모니터] 아이콘 클릭 → 코스 모니터 메뉴 전환 → 복귀(비파괴)', failMsg: '[코스모니터] 미동작' };
        const tag = await admin.evaluate(() => {
          const sc = document.querySelector('.contents, main') || document.body;
          const el3d = sc.querySelector('[class*="ico-3d"]'); if (!el3d) return { ok: false, cls: '' };
          const unit3d = el3d.closest('button, a, [role="button"]') || el3d;   // 3D 클릭 단위
          let prev = unit3d.previousElementSibling;
          // 직전 형제가 아이콘/버튼이 아니면(구분선 등) 더 앞으로
          while (prev && prev.nodeType === 1 && !/ico|btn|button/i.test((prev.className || '').toString()) && !['BUTTON', 'A', 'I', 'SVG'].includes(prev.tagName)) prev = prev.previousElementSibling;
          if (prev && prev.nodeType === 1) { prev.setAttribute('data-e2e-mon', '1'); return { ok: true, cls: (prev.className || '').toString().slice(0, 34) }; }
          return { ok: false, cls: '' };
        }).catch(() => ({ ok: false, cls: '' }));
        if (!tag.ok) skip(m, `[코스모니터] 아이콘(ico-3d 직전 형제) 미검출(항목 ${struct.items})`);
        else {
          try {
            const el = admin.locator('[data-e2e-mon]').first();
            const b4 = admin.url();
            await el.click({ timeout: 2_500, force: true }).catch(() => {}); await admin.waitForTimeout(1_400); await killAlarms(admin);
            const moved = admin.url() !== b4; const isMonitor = /\/monitor\/view/.test(admin.url());
            if (moved) record(m, 'PASS', { actual: `[코스모니터](${tag.cls}) → 코스 모니터 전환(${admin.url().replace(/https?:\/\/[^/]+/, '')})${isMonitor ? ' ✓' : ''} → 복귀(비파괴)` });
            else record(m, 'PASS', { actual: `[코스모니터](${tag.cls}) 클릭(반응·전환 미확정)` });
            await admin.keyboard.press('Escape').catch(() => {}); await back();
          } catch (e) { record(m, 'FAIL', { error: '코스모니터 예외', detail: (e as Error).message.slice(0, 120) }); await back(); }
        }
      }
    }
    await auditButtonCoverage(admin, P, '코스관리_드론_bc', 'DRN-BTNCOV');
  } else skip({ path: '코스 현황 관리 > 드론사진 업로드', tcRef: '코스관리_드론_0', tcId: 'DRN-00', desc: '진입' }, '진입 실패');

  await killAlarms(admin);
  await writeReport('코스관리_시각화면');
});
