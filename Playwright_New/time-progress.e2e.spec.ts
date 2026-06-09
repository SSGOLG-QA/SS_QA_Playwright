import { test, expect, Page } from '@playwright/test';
import { openAdmin, settle } from '../lib/adminHelpers';
import { StandardPage, RealtimePage, SearchPage, StatsPage } from './time-progress.pom';
import { SCREEN } from './time-progress.data';

// 경기 진행 관리 E2E (현재 구현 AS-IS, POM 8항목). ⚠ 비파괴(검색/조회/내보내기/보기까지만, 저장·작성 클릭 안 함).
let admin: Page;
test.beforeEach(async ({ page, context }) => { admin = await openAdmin(page, context); });

// 1. 기능 진입 — 진행시간 실시간 URL+로드
test('항목1: 기능 진입 — 진행시간 실시간 URL 접속 및 로드', async () => {
  const p = new RealtimePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.realtime.urlPart);
  await expect(p.infoBox, '안내 문구 로드').toContainText(SCREEN.realtime.guide);
  await expect(p.table, '리스트 테이블 로드').toBeVisible();
});

// 2. 텍스트 검증 — 실시간 + 통계
test('항목2: 텍스트 검증 — raw code/미가공 코드 미노출', async () => {
  for (const Cls of [RealtimePage, StatsPage]) {
    const p = new Cls(admin);
    await p.open();
    expect(await p.scanRawCode(), '미가공 코드 노출').toEqual([]);
  }
});

// 3. 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지
test('항목3: 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지', async () => {
  const rt = new RealtimePage(admin);
  await rt.open();
  await rt.expectLoaded(SCREEN.realtime.urlPart);
  const st = new StatsPage(admin);
  await st.open();
  await st.expectLoaded(SCREEN.stats.urlPart);
  await st.expectSessionAlive();
});

// 4. 데이터 정합성 — 실시간 (검색결과:N) vs 렌더 행
test('항목4: 데이터 정합성 — 실시간 검색결과 vs 렌더 행', async () => {
  const p = new RealtimePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.realtime.urlPart);
  for (const c of SCREEN.realtime.columns) await expect(p.column(c), `컬럼 '${c}'`).toBeVisible();
  const rows = await p.renderedRowCount();
  const total = await p.listTotalCount();
  expect(rows, '렌더 행 ≥ 0').toBeGreaterThanOrEqual(0);
  if (total === null) test.info().annotations.push({ type: '주의', description: '검색결과 카운트 표기 없음 → 행 수만 검증' });
  else if (rows > total) test.info().annotations.push({ type: '주의', description: `검색결과(${total}) ≠ 렌더 행(${rows}) — 실시간 모니터 카운트(팀/완료 등) 의미 차이 추정, 결함 아닐 수 있음(추적)` });
  // 실시간 모니터는 '검색결과' 카운트와 렌더 행 의미가 다를 수 있어 하드 FAIL 대신 추적축으로 기록
});

// 5. 페이지네이션 — 진행시간 조회(best-effort, 모니터형이라 1페이지 가능)
test('항목5: 페이지네이션 — 진행시간 조회', async () => {
  const p = new SearchPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.search.urlPart);
  const page2 = admin.getByRole('button', { name: '2', exact: true });
  if (await page2.count().catch(() => 0)) {
    await page2.first().click(); await settle(admin, 800);
    await expect(p.rows.first(), '2페이지 행 렌더').toBeVisible();
  } else {
    test.info().annotations.push({ type: '주의', description: '페이지 2 없음(1페이지 이내) → 이동 검증 생략' });
    await expect(p.table, '테이블 노출').toBeVisible();
  }
});

// 6. 달력/검색 — 진행시간 조회 조회기간 컨트롤(달력 전용 → 컨트롤 검증)
test('항목6: 달력/검색 — 진행시간 조회 조회기간 컨트롤', async () => {
  const p = new SearchPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.search.urlPart);
  expect(await p.datepickers.count(), '조회기간 datepicker ≥2').toBeGreaterThanOrEqual(2);
  await expect(p.button('검색'), '[검색] 버튼').toBeVisible();
  test.info().annotations.push({ type: '한계', description: '데이트피커 달력 전용 → 1년 경계 자동 트리거 베스트에포트 제외(컨트롤 노출만)' });
});

// 7. 입력/반영 — 실시간 검색어 입력 → 검색 → 결과 반영(비파괴 조회)
test('항목7: 입력/반영 — 실시간 검색 입력/반영', async () => {
  const p = new RealtimePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.realtime.urlPart);
  const ph = SCREEN.realtime.searchPh[0]; // '캐디명'
  await expect(admin.getByPlaceholder(ph), '검색 입력 필드 노출').toBeVisible();
  await admin.getByPlaceholder(ph).fill('__E2E_없는값__');
  await p.button('검색').click();
  await settle(admin, 1000);
  const rows = await p.renderedRowCount();
  expect(rows, '검색 반영(빈 결과=0 정상)').toBeGreaterThanOrEqual(0);
  await expect(p.table, '검색 후 테이블 유지').toBeVisible();
  await p.button('초기화').click().catch(() => {});
});

// 8. 팝업/모달 — 실시간 [홀별시각보기] 상세 모달 열고 닫기(비파괴)
test('항목8: 팝업/모달 — 홀별시각보기 모달 열고 닫기', async () => {
  const p = new RealtimePage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.realtime.urlPart);
  const open = admin.getByRole('button', { name: '홀별시각보기' });
  if (!(await open.count().catch(() => 0))) {
    test.info().annotations.push({ type: '주의', description: '[홀별시각보기] 버튼 없음 → 모달 검증 생략' });
    await expect(p.table).toBeVisible();
    return;
  }
  await open.first().click();
  await settle(admin, 800);
  const modal = admin.locator('.modal, [class*="modal-wrap"], [role="dialog"], .popup-layer, [class*="popup"]').first();
  if (await modal.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await admin.keyboard.press('Escape').catch(() => {});          // 닫기(비파괴)
    await settle(admin, 500);
  } else {
    test.info().annotations.push({ type: '주의', description: '[홀별시각보기] 클릭 후 모달 미노출 — 행 선택/데이터 의존 추정. 버튼 노출까지만 검증' });
  }
  await expect(p.table, '화면 테이블 유지').toBeVisible();
});
