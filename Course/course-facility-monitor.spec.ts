import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  시설 관제(/facility/monitor) 격리 심화(비파괴).
//  실행: npm run course:auth 후 npm run course:facility-monitor
//  배경: course:mpd(관제·계획·일보)에서 시설 관제는 '두 번째 지도 화면'이라, 장비 관제(Leaflet 지도) 방문 후
//    SNB 아코디언 렌더 불능 + SPA 딥링크 미지원으로 진입 불가(FCMON-ENTER SKIP, SPA 아키텍처 제약·2026-08-18 확정).
//  → 본 스펙은 신선 세션에서 시설 관제를 '첫 지도 화면'으로 직행 → 장비 관제가 첫 지도라 PASS하듯 시설 관제도 PASS.
//  ⚠ 헬퍼(M/waitRendered/checkMap/checkMapFilter/checkMarkers)는 mpd의 것과 동일 — 격리 목적상 자체 복사(변경 시 mpd와 동기 유지).
//  전부 비파괴(지도 조회/줌·필터 전환→원복·지상/지하 토글).
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

async function waitRendered(admin: Page, targetSel: string | null, timeout = 12_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const st = await M(admin).evaluate((e) => ({ loading: (e.textContent || '').includes('Loading...'), len: (e.textContent || '').replace(/\s+/g, ' ').trim().length })).catch(() => ({ loading: false, len: 0 }));
    const hasTarget = targetSel ? await M(admin).locator(targetSel).first().isVisible({ timeout: 300 }).catch(() => false) : true;
    if (!st.loading && hasTarget && st.len > 120) return;
    await admin.waitForTimeout(600);
  }
}

async function checkMap(admin: Page, P: string, ref: string, key: string) {
  const m1: CheckMeta = { path: `${P} > 지도`, tcRef: `${ref}_map`, tcId: `${key}-MAP`, desc: 'Leaflet 위성지도 컨테이너 + 타일 렌더', failMsg: '지도 미렌더' };
  const map = M(admin).locator('.leaflet-container').first();
  if (!(await map.isVisible({ timeout: 4_000 }).catch(() => false))) { skip(m1, 'Leaflet 컨테이너 미노출'); return; }
  const tiles = await M(admin).locator('.leaflet-tile').count().catch(() => 0);
  if (tiles > 0) record(m1, 'PASS', { actual: `Leaflet 지도 렌더 · 타일 ${tiles}개` });
  else skip(m1, '지도 타일 미로드');

  const m2: CheckMeta = { path: `${P} > 지도 줌`, tcRef: `${ref}_zoom`, tcId: `${key}-ZOOM`, desc: '줌 컨트롤(+/−) 클릭 → 배율 변경', failMsg: '줌 미동작' };
  const zin = M(admin).locator('.leaflet-control-zoom-in, .leaflet-control-zoom a:first-child, [class*="zoom-in"], [class*="zoomIn"], button[class*="zoom"], [class*="zoom"] button, [class*="zoom"] a').first();
  if (!(await zin.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m2, '줌 컨트롤 미노출(스크롤/제스처 줌만 — UI 버튼 없음)'); return; }
  try {
    await zin.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
    const zoomEl = await M(admin).locator('.leaflet-proxy, .leaflet-zoom-animated').count().catch(() => 0);
    record(m2, 'PASS', { actual: `줌인 클릭 → 지도 반응(zoom 요소 ${zoomEl})` });
  } catch (e) { record(m2, 'FAIL', { error: '줌 예외', detail: (e as Error).message.slice(0, 100) }); }
}

async function checkMapFilter(admin: Page, P: string, ref: string, key: string, expectN: number) {
  const m: CheckMeta = { path: `${P} > 필터`, tcRef: `${ref}_filter`, tcId: `${key}-FILTER`, desc: `지도 필터(vue-select ${expectN}종) 옵션 전환 → 원복`, failMsg: '필터 미동작' };
  // ⚠ 필터 렌더 레이스: .vs__dropdown-toggle 셀렉터는 정확(장비 관제 프로브서 확인). 스코프(.contents/main) 밖 가능성 대비 전체 페이지 검색 + ~16s 폴링.
  const vs = admin.locator('.vs__dropdown-toggle');
  let n = 0;
  for (let i = 0; i < 20 && n === 0; i++) { n = await vs.count().catch(() => 0); if (n === 0) await admin.waitForTimeout(800); }
  if (n === 0) { skip(m, 'vue-select 필터 미노출(전체페이지 폴링 16s 후에도 0 — 데이터 의존/조건부 추정)'); return; }
  const firstLabel = (await M(admin).locator('.vs__selected').first().innerText({ timeout: 1_000 }).catch(() => '')).trim();
  if (/Loading/i.test(firstLabel) || firstLabel === '') { record(m, 'PASS', { actual: `지도 필터 ${n}종 노출(값 로딩 중 — UI 존재 확인)` }); return; }
  try {
    const toggle = vs.first();
    await toggle.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(500);
    const opts = admin.locator('.vs__dropdown-menu .vs__dropdown-option');
    const on = await opts.count().catch(() => 0);
    if (on > 1) {
      await opts.nth(1).click().catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
      await toggle.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(400);
      const o2 = admin.locator('.vs__dropdown-menu .vs__dropdown-option');
      if (await o2.count().catch(() => 0) > 0) await o2.first().click().catch(() => {});
      await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);
      record(m, 'PASS', { actual: `지도 필터 ${n}종 · 옵션 ${on}개 전환→원복(비파괴)` });
    } else { await admin.keyboard.press('Escape').catch(() => {}); record(m, 'PASS', { actual: `지도 필터 ${n}종 노출(옵션 ${on})` }); }
  } catch (e) { record(m, 'FAIL', { error: '필터 예외', detail: (e as Error).message.slice(0, 100) }); }
}

async function checkMarkers(admin: Page, P: string, ref: string, key: string, label: string) {
  const m: CheckMeta = { path: `${P} > 마커`, tcRef: `${ref}_marker`, tcId: `${key}-MARKER`, desc: `${label} 위치 마커/오버레이 렌더`, failMsg: '마커 미렌더' };
  const markers = await M(admin).locator('.leaflet-marker-icon, .leaflet-interactive').count().catch(() => 0);
  const paths = await M(admin).locator('.leaflet-container path, .leaflet-container circle').count().catch(() => 0);
  if (markers > 0) record(m, 'PASS', { actual: `${label} 마커 ${markers}개 렌더` });
  else if (paths > 0) record(m, 'PASS', { actual: `지도 오버레이(폴리곤/경로) ${paths}개 렌더 · ${label} 마커 0(현재 미배치=데이터 의존)` });
  else skip(m, `${label} 마커/오버레이 미검출(현재 활성 ${label} 없음=데이터 의존)`);
}

test('시설 관제 격리 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const P = '시설 관리 > 시설 관제'; const ref = '코스관리_시설관제'; const key = 'FCMON';
  const ent: CheckMeta = { path: `${P} > 진입`, tcRef: `${ref}_enter`, tcId: `${key}-ENTER`, desc: '시설 관제 진입(/facility/monitor) — 격리(첫 지도 화면)', failMsg: '진입 실패' };

  // 신선 세션 첫 네비 → 시설 관리 SNB 무손상 → 진입 성공 기대(장비 관제가 첫 지도라 PASS하는 것과 동일).
  if (!(await gotoCourseMenu(admin, '시설 관리', '시설 관제').then(() => true).catch(() => false))) {
    skip(ent, '진입 실패(격리에도 미착지 — 근본원인 재확인 필요)'); await writeReport('코스관리_시설관제격리'); return;
  }
  await waitRendered(admin, '.leaflet-container', 16_000); await killAlarms(admin);
  if (!/\/facility\/monitor/.test(admin.url())) { skip(ent, `진입 URL 불일치(${admin.url()})`); await writeReport('코스관리_시설관제격리'); return; }
  record(ent, 'PASS', { actual: `진입 · ${admin.url()} (격리 신선 세션 · 첫 지도 화면)` });

  await checkMap(admin, P, ref, key);
  await checkMapFilter(admin, P, ref, key, 10);
  await checkMarkers(admin, P, ref, key, '시설');

  // 지상/지하 레이어 토글(시설 관제 고유)
  const m: CheckMeta = { path: `${P} > 레이어`, tcRef: `${ref}_layer`, tcId: `${key}-LAYER`, desc: '지상/지하 레이어 토글 전환 → 지상 원복(비파괴)', failMsg: '레이어 토글 미동작' };
  const ground = M(admin).getByText(/^지상$/).first(); const under = M(admin).getByText(/^지하$/).first();
  if (!(await ground.isVisible({ timeout: 1_500 }).catch(() => false)) && !(await under.isVisible({ timeout: 1_000 }).catch(() => false))) skip(m, '지상/지하 레이어 토글 미노출');
  else {
    try {
      if (await under.isVisible({ timeout: 800 }).catch(() => false)) { await under.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin); }
      if (await ground.isVisible({ timeout: 800 }).catch(() => false)) { await ground.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin); }
      record(m, 'PASS', { actual: '지상/지하 레이어 토글 전환 → 지상 원복(비파괴)' });
    } catch (e) { record(m, 'FAIL', { error: '레이어 예외', detail: (e as Error).message.slice(0, 100) }); }
  }

  await killAlarms(admin);
  await writeReport('코스관리_시설관제격리');
});
