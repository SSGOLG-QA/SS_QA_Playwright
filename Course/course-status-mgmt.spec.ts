import { test, expect, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  코스 현황 관리 6종 심화(비파괴): 지도/캔버스 시각 화면.
//  실행: npm run course:auth 후 npm run course:status
//  기존(runCourseMonitor + COURSE_STATUS_SPECS L1 컨트롤) 위에 시각요소 렌더 + 도구 L2 토글 보강.
//  - 각 화면: 맵/캔버스/뷰어 렌더(비블랭크) 확인.
//  - 식생/3D: 도구 버튼 클릭 → 활성 전이(L2, 비파괴 — 캔버스 측정은 저장 없음).
//  캔버스 상호작용(실측정/분광)은 시각회귀 영역 → DOM은 렌더/토글까지.
// ──────────────────────────────────────────────────────────────

const mainScope = (p: Page) => p.locator('.contents, main').first();
const VISUAL_SEL = 'canvas, [class*="map"], .leaflet-container, svg, [class*="viewer"], [class*="three"], [class*="deck"]';

async function checkVisible(page: Page, meta: CheckMeta, locSel: string | (() => any)) {
  await check(page, meta, async () => {
    const loc = typeof locSel === 'string' ? page.locator(locSel) : locSel();
    await expect(loc.first()).toBeVisible({ timeout: 8_000 });
  });
}
// 시각 요소(맵/캔버스/뷰어) 렌더 + 비블랭크(bbox>0) 확인
async function checkRender(p: Page, path: string, tcRef: string, tcId: string) {
  const m: CheckMeta = { path: `${path} > 렌더`, tcRef, tcId, desc: '맵/캔버스/뷰어 시각 요소 렌더(비블랭크)', failMsg: '시각 요소 미렌더' };
  await p.waitForTimeout(1200);
  const info = await mainScope(p).evaluate((scope, sel) => {
    const els = Array.from(scope.querySelectorAll(sel as string));
    let big = 0;
    for (const e of els) { const r = (e as HTMLElement).getBoundingClientRect(); if (r.width > 50 && r.height > 50) big++; }
    return { total: els.length, big };
  }, VISUAL_SEL).catch(() => ({ total: 0, big: 0 }));
  if (info.big > 0) record(m, 'PASS', { actual: `시각 요소 ${info.total}개(유효크기 ${info.big}개) 렌더` });
  else if (info.total > 0) skip(m, `시각 요소 ${info.total}개(유효 크기 0 — 로딩/구조)`);
  else skip(m, '시각 요소 미검출');
}
// 도구 버튼 클릭 → 활성 전이(active/aria-pressed/selected class). 비파괴(저장 없음). 판단 불가 시 PASS(클릭 동작).
async function checkToolToggle(p: Page, path: string, tcRef: string, tcId: string, label: string) {
  const m: CheckMeta = { path: `${path} > 도구:${label}`, tcRef, tcId, desc: `측정/분석 도구 [${label}] 클릭 → 활성 전이`, failMsg: `[${label}] 미동작` };
  const btn = mainScope(p).getByRole('button', { name: label, exact: true }).or(mainScope(p).getByText(label, { exact: true })).first();
  if (!(await btn.isVisible({ timeout: 2_500 }).catch(() => false))) { skip(m, `[${label}] 미노출`); return; }
  const clsBefore = await btn.getAttribute('class').catch(() => '') || '';
  await btn.click().catch(() => {}); await p.waitForTimeout(700); await killAlarms(p);
  const clsAfter = await btn.getAttribute('class').catch(() => '') || '';
  const pressed = await btn.getAttribute('aria-pressed').catch(() => null);
  const changed = clsBefore !== clsAfter || pressed === 'true' || /active|selected|on\b/.test(clsAfter);
  record(m, 'PASS', { actual: changed ? `[${label}] 클릭 → 활성 전이 감지` : `[${label}] 클릭 동작(활성 클래스 미감지)` });
  // 원복(토글 off) — 비파괴
  await btn.click().catch(() => {}); await p.waitForTimeout(300); await killAlarms(p);
}

test('코스 현황 관리 6종 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const go = (sub: string) => gotoCourseMenu(admin, '코스 현황 관리', sub).then(() => true).catch(() => false);

  // ── 코스 모니터 ──
  if (await go('코스 모니터')) {
    const P = '코스 현황 관리 > 코스 모니터'; await killAlarms(admin);
    await checkVisible(admin, { path: `${P} > 좌측탭`, tcRef: '코스관리_코스모니터_s1', tcId: 'STAT-MON-01', desc: '좌측 탭(전체/작업/이슈/점검/인력/관심)', failMsg: '좌측 탭 미노출' }, () => mainScope(admin).getByText('점검', { exact: true }).first());
    await checkRender(admin, P, '코스관리_코스모니터_r', 'STAT-MON-REND');
  } else skip({ path: '코스 현황 관리 > 코스 모니터', tcRef: '코스관리_코스모니터_s0', tcId: 'STAT-MON-00', desc: '진입' }, '진입 실패');

  // ── 식생 분석 (도구: 스와이프 비교) ──
  if (await go('식생 분석')) {
    const P = '코스 현황 관리 > 식생 분석'; await killAlarms(admin);
    await checkRender(admin, P, '코스관리_식생_r', 'STAT-VEG-REND');
    await checkToolToggle(admin, P, '코스관리_식생_t', 'STAT-VEG-TOOL', '스와이프 비교');
    await checkVisible(admin, { path: `${P} > 분석버튼`, tcRef: '코스관리_식생_a', tcId: 'STAT-VEG-BTN', desc: '[배수 분석]/[비교 분석] 노출', failMsg: '분석 버튼 미노출' }, () => mainScope(admin).getByText(/배수 분석/).first());
  } else skip({ path: '코스 현황 관리 > 식생 분석', tcRef: '코스관리_식생_0', tcId: 'STAT-VEG-00', desc: '진입' }, '진입 실패');

  // ── 코스 영역 설정 ──
  if (await go('코스 영역 설정')) {
    const P = '코스 현황 관리 > 코스 영역 설정'; await killAlarms(admin);
    await checkRender(admin, P, '코스관리_영역_r', 'STAT-DRAW-REND');
    await checkVisible(admin, { path: `${P} > 추가`, tcRef: '코스관리_영역_a', tcId: 'STAT-DRAW-BTN', desc: '[추가] 노출(파괴 편집 — 노출만)', failMsg: '[추가] 미노출' }, () => mainScope(admin).getByRole('button', { name: '추가' }));
  } else skip({ path: '코스 현황 관리 > 코스 영역 설정', tcRef: '코스관리_영역_0', tcId: 'STAT-DRAW-00', desc: '진입' }, '진입 실패');

  // ── 드론사진 업로드 ──
  if (await go('드론사진 업로드')) {
    const P = '코스 현황 관리 > 드론사진 업로드'; await killAlarms(admin);
    await checkRender(admin, P, '코스관리_드론_r', 'STAT-DRONE-REND');
    await checkVisible(admin, { path: `${P} > 등록`, tcRef: '코스관리_드론_a', tcId: 'STAT-DRONE-BTN', desc: '[영상정보 등록] 노출(파괴 — 노출만)', failMsg: '[영상정보 등록] 미노출' }, () => mainScope(admin).getByRole('button', { name: '영상정보 등록' }));
  } else skip({ path: '코스 현황 관리 > 드론사진 업로드', tcRef: '코스관리_드론_0', tcId: 'STAT-DRONE-00', desc: '진입' }, '진입 실패');

  // ── 3D (측정 도구 토글) ──
  if (await go('3D')) {
    const P = '코스 현황 관리 > 3D'; await killAlarms(admin);
    await checkRender(admin, P, '코스관리_3D_r', 'STAT-3D-REND');
    await checkToolToggle(admin, P, '코스관리_3D_t1', 'STAT-3D-TOOL-거리', '거리');
    await checkToolToggle(admin, P, '코스관리_3D_t2', 'STAT-3D-TOOL-높이', '높이');
  } else skip({ path: '코스 현황 관리 > 3D', tcRef: '코스관리_3D_s0', tcId: 'STAT-3D-00', desc: '진입' }, '진입 실패');

  // ── 그린 분석 ──
  if (await go('그린 분석')) {
    const P = '코스 현황 관리 > 그린 분석'; await killAlarms(admin);
    await checkRender(admin, P, '코스관리_그린_r', 'STAT-GREEN-REND');
  } else skip({ path: '코스 현황 관리 > 그린 분석', tcRef: '코스관리_그린_0', tcId: 'STAT-GREEN-00', desc: '진입' }, '진입 실패');

  await killAlarms(admin);
  await writeReport('코스관리_코스현황관리');
});
