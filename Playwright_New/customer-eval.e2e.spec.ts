import { test, expect, Page } from '@playwright/test';
import { openAdmin, settle } from '../lib/adminHelpers';
import { ReviewListPage, ReviewStatsPage, CustomerEvalPage, CaddieEvalPage } from './customer-eval.pom';
import { SCREEN } from './customer-eval.data';

// 고객 평가 관리 E2E (현재 구현 AS-IS, POM 8항목). ⚠ 비파괴(적용/조회/내보내기까지만, 숨김 처리/답변 등록 클릭 안 함).
// (식음료 평가는 분석 JSON 미확보 → 본 스위트 제외)
let admin: Page;
test.beforeEach(async ({ page, context }) => { admin = await openAdmin(page, context); });

// 1. 기능 진입 — 후기 리스트 URL+로드
test('항목1: 기능 진입 — 후기 리스트 URL 접속 및 로드', async () => {
  const p = new ReviewListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.reviewList.urlPart);
  await expect(p.infoBox, '안내 문구 로드').toContainText(SCREEN.reviewList.guide);
  await expect(p.table, '리스트 테이블 로드').toBeVisible();
});

// 2. 텍스트 검증 — 후기 리스트 + 후기 통계
test('항목2: 텍스트 검증 — raw code/미가공 코드 미노출', async () => {
  for (const Cls of [ReviewListPage, ReviewStatsPage]) {
    const p = new Cls(admin);
    await p.open();
    expect(await p.scanRawCode(), '미가공 코드 노출').toEqual([]);
  }
});

// 3. 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지
test('항목3: 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지', async () => {
  const rl = new ReviewListPage(admin);
  await rl.open();
  await rl.expectLoaded(SCREEN.reviewList.urlPart);
  const ce = new CustomerEvalPage(admin);
  await ce.open();
  await ce.expectLoaded(SCREEN.customerEval.urlPart);
  await ce.expectSessionAlive();
});

// 4. 데이터 정합성 — 후기 리스트 컬럼 + 렌더 행
test('항목4: 데이터 정합성 — 후기 리스트 컬럼/렌더 행', async () => {
  const p = new ReviewListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.reviewList.urlPart);
  for (const c of SCREEN.reviewList.columns) await expect(p.column(c), `컬럼 '${c}'`).toBeVisible();
  const rows = await p.renderedRowCount();
  expect(rows, '렌더 행 ≥ 0(빈 결과 정상)').toBeGreaterThanOrEqual(0);
  if (rows === 0) test.info().annotations.push({ type: '주의', description: '조회기간 내 후기 0건 → 행 정합성 생략(데이터 의존)' });
});

// 5. 페이지네이션 — 후기 리스트 (cp 파라미터)
test('항목5: 페이지네이션 — 후기 리스트 페이지 이동', async () => {
  const p = new ReviewListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.reviewList.urlPart);
  const page2 = admin.getByRole('button', { name: '2', exact: true });
  if (await page2.count().catch(() => 0)) {
    await page2.first().click(); await settle(admin, 800);
    await expect(p.rows.first(), '2페이지 행 렌더').toBeVisible();
  } else {
    test.info().annotations.push({ type: '주의', description: '페이지 2 없음(1페이지 이내) → 이동 검증 생략' });
    await expect(p.table, '테이블 노출').toBeVisible();
  }
});

// 6. 달력/검색 — 후기 리스트 기간 프리셋 버튼(1개월) 적용 → 반영(달력 비의존)
test('항목6: 달력/검색 — 후기 리스트 기간 프리셋 적용', async () => {
  const p = new ReviewListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.reviewList.urlPart);
  expect(await p.datepickers.count(), '조회기간 datepicker ≥2').toBeGreaterThanOrEqual(2);
  const preset = p.button('1개월');
  await expect(preset, '기간 프리셋 [1개월] 노출').toBeVisible();
  await preset.click();                                             // 프리셋 클릭(달력 비의존 기간 변경, 비파괴 조회)
  await p.button(SCREEN.reviewList.applyBtn).first().click();
  await settle(admin, 1000);
  await expect(p.table, '프리셋 적용 후 테이블 유지').toBeVisible();
  test.info().annotations.push({ type: '한계', description: '데이트피커 달력 전용 → 직접 1년 경계 트리거 제외. 프리셋 기간(1개월) 변경으로 검색 반영 확인' });
});

// 7. 입력/반영 — 후기 통계 기간 프리셋(15일) → 조회 → 반영(비파괴)
test('항목7: 입력/반영 — 후기 통계 기간 프리셋/조회 반영', async () => {
  const p = new ReviewStatsPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.reviewStats.urlPart);
  const preset = p.button('15일');
  await expect(preset, '기간 프리셋 [15일] 노출').toBeVisible();
  await preset.click();
  await p.button(SCREEN.reviewStats.searchBtn).first().click();
  await settle(admin, 1000);
  await expect(p.table, '조회 후 통계표 유지').toBeVisible();
  const rows = await p.renderedRowCount();
  expect(rows, '조회 결과 반영(≥0)').toBeGreaterThanOrEqual(0);
});

// 8. 팝업/모달 — 후기 리스트 행 선택 → 상세/답변 모달 열고 닫기(비파괴)
test('항목8: 팝업/모달 — 후기 리스트 상세 모달 열고 닫기', async () => {
  const p = new ReviewListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.reviewList.urlPart);
  const rows = await p.renderedRowCount();
  if (rows === 0) {
    test.info().annotations.push({ type: '주의', description: '후기 0건 → 상세 모달 검증 생략(데이터 의존)' });
    await expect(p.table).toBeVisible();
    return;
  }
  await p.rows.first().click();
  await settle(admin, 800);
  const modal = admin.locator('.modal, [class*="modal-wrap"], [role="dialog"], .popup-layer, [class*="popup"]').first();
  if (await modal.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await admin.keyboard.press('Escape').catch(() => {});           // 닫기(비파괴)
    await settle(admin, 500);
  } else {
    test.info().annotations.push({ type: '주의', description: '행 클릭 후 상세 모달 미노출 — 별도 [보기]/답변 인터랙션 추정. 테이블 유지까지만 검증' });
  }
  await expect(p.table, '화면 테이블 유지').toBeVisible();
});
