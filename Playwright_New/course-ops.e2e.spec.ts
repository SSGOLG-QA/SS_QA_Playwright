import { test, expect, Page } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { PinPositionPage, PinHistoryPage, GreenSpeedPage, ClubNewsPage, CourseBasePage } from './course-ops.pom';
import { SCREEN } from './course-ops.data';

// 코스 운영 관리 E2E (현재 구현 AS-IS, POM 8항목). ⚠ 비파괴(전체적용/등록/삭제 확인 안 함, 노출/취소까지).
// 실행: npx playwright test --config=Playwright_New/playwright.config.ts course-ops.e2e.spec.ts
let admin: Page;
test.beforeEach(async ({ page, context }) => { admin = await openAdmin(page, context); });

// 1. 기능 진입 — 핀 포지션 관리 URL+로드
test('항목1: 기능 진입 — 핀 포지션 관리 URL 접속 및 로드', async () => {
  const p = new PinPositionPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.pin.urlPart);
  await expect(p.infoBox, '안내 문구 로드').toContainText(SCREEN.pin.guide);
  await expect(p.table, '리스트 테이블 로드').toBeVisible();
});

// 2. 텍스트 검증 — 미가공 코드/오타 미노출 (핀 포지션 관리 + 골프장 소식)
test('항목2: 텍스트 검증 — raw code/미가공 코드 미노출', async () => {
  for (const Cls of [PinPositionPage, ClubNewsPage]) {
    const p = new Cls(admin);
    await p.open();
    expect(await p.scanRawCode(), '미가공 코드 노출').toEqual([]);
  }
});

// 3. 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지
test('항목3: 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지', async () => {
  const pin = new PinPositionPage(admin);
  await pin.open();
  await pin.expectLoaded(SCREEN.pin.urlPart);
  const news = new ClubNewsPage(admin);
  await news.open();
  await news.expectLoaded(SCREEN.news.urlPart);
  await news.expectSessionAlive();
});

// 4. 데이터 정합성 — 골프장 소식 총건수 vs 렌더 행
test('항목4: 데이터 정합성 — 골프장 소식 총 건수 vs 렌더 행', async () => {
  const p = new ClubNewsPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.news.urlPart);
  for (const c of SCREEN.news.columns) await expect(p.column(c), `컬럼 '${c}'`).toBeVisible();
  const rows = await p.renderedRowCount();
  const total = await p.listTotalCount();
  expect(rows, '렌더 행 ≥ 0').toBeGreaterThanOrEqual(0);
  if (total !== null) expect(rows, '행 ≤ 총건수').toBeLessThanOrEqual(total);
  else test.info().annotations.push({ type: '주의', description: '총 건수 표기 없음 → 행 수만 검증' });
});

// 5. 페이지네이션 — 핀 포지션 변경이력(best-effort)
test('항목5: 페이지네이션 — 핀 포지션 변경이력', async () => {
  const p = new PinHistoryPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.pinHistory.urlPart);
  const page2 = admin.getByRole('button', { name: '2', exact: true });
  if (await page2.count().catch(() => 0)) {
    await p.gotoPageNumber(2);
    const onP2 = p.currentPageParam() === 2 || (await admin.locator('.pagination .active, button.active', { hasText: '2' }).count()) > 0;
    expect(onP2, '2페이지 이동').toBeTruthy();
  } else {
    test.info().annotations.push({ type: '주의', description: '페이지 2 없음(1페이지 이내 데이터) → 이동 검증 생략' });
    await expect(p.table, '테이블 노출').toBeVisible();
  }
});

// 6. 달력/검색 — 핀 포지션 변경이력 조회기간 컨트롤 (datepicker 달력전용 → 컨트롤 검증)
test('항목6: 달력/검색 — 핀 포지션 변경이력 조회기간 컨트롤', async () => {
  const p = new PinHistoryPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.pinHistory.urlPart);
  expect(await p.datepickers.count(), '조회기간 datepicker ≥2').toBeGreaterThanOrEqual(2);
  await expect(admin.getByRole('button', { name: '조회' }), '[조회] 버튼').toBeVisible();
  test.info().annotations.push({ type: '한계', description: '데이트피커 달력 전용 → 1년 경계 자동 트리거는 베스트에포트 제외(컨트롤 노출만 검증)' });
});

// 7. 입력 필드 — 그린스피드 입력/수정 노출 (비파괴: 저장 안 함)
test('항목7: 입력 필드 — 그린스피드 입력/수정 노출(비파괴)', async () => {
  const p = new GreenSpeedPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.green.urlPart);
  await expect(p.infoBox, '안내 문구').toContainText(SCREEN.green.guide);
  await expect(p.speedInput().first(), '그린스피드 입력 필드(예 2.6) 노출').toBeVisible();
  await expect(admin.getByRole('button', { name: SCREEN.green.editBtn }).first(), '[수정] 버튼 노출(클릭 안 함)').toBeVisible();
});

// 8. 팝업/모달 — 골프장 소식 [삭제] confirm 취소(닫기, 비파괴)
test('항목8: 팝업/모달 — 골프장 소식 삭제 confirm 취소(닫기)', async () => {
  const p = new ClubNewsPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.news.urlPart);
  const del = p.rowDeleteBtn();
  if (!(await del.count().catch(() => 0)) || (await p.renderedRowCount()) === 0) {
    test.info().annotations.push({ type: '주의', description: '소식 데이터 없음 → 삭제 모달 검증 생략' });
    await expect(p.table).toBeVisible();
    return;
  }
  await del.first().click();
  await expect(p.confirmModal(), 'confirm 모달 노출').toBeVisible({ timeout: 8_000 });
  await expect(p.modalCancelBtn(), '취소 버튼').toBeVisible();
  await p.modalCancelBtn().click();                                 // 취소(닫기) — 비파괴
  await expect(p.confirmModal(), '취소 후 모달 닫힘').toBeHidden({ timeout: 8_000 });
});
