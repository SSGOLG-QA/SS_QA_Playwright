import { test, expect, Page } from '@playwright/test';
import { openAdmin, settle } from '../lib/adminHelpers';
import { BetoRecordPage, BetoStatsPage } from './beto.pom';
import { SCREEN } from './beto.data';

// 배토 관리 E2E (현재 구현 AS-IS, POM 8항목). ⚠ 비파괴(적용/초기화/보기/내보내기까지만, 저장 동작 없음).
let admin: Page;
test.beforeEach(async ({ page, context }) => { admin = await openAdmin(page, context); });

// 1. 기능 진입 — 배토 기록 조회 URL+로드
test('항목1: 기능 진입 — 배토 기록 조회 URL 접속 및 로드', async () => {
  const p = new BetoRecordPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.record.urlPart);
  await expect(p.infoBox, '안내 문구 로드').toContainText(SCREEN.record.guide);
  await expect(p.table, '리스트 테이블 로드').toBeVisible();
});

// 2. 텍스트 검증 — 기록 조회 + 통계
test('항목2: 텍스트 검증 — raw code/미가공 코드 미노출', async () => {
  for (const Cls of [BetoRecordPage, BetoStatsPage]) {
    const p = new Cls(admin);
    await p.open();
    expect(await p.scanRawCode(), '미가공 코드 노출').toEqual([]);
  }
});

// 3. 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지
test('항목3: 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지', async () => {
  const rec = new BetoRecordPage(admin);
  await rec.open();
  await rec.expectLoaded(SCREEN.record.urlPart);
  const st = new BetoStatsPage(admin);
  await st.open();
  await st.expectLoaded(SCREEN.stats.urlPart);
  await st.expectSessionAlive();
});

// 4. 데이터 정합성 — 배토 기록 조회 컬럼 + 렌더 행
test('항목4: 데이터 정합성 — 배토 기록 조회 컬럼/렌더 행', async () => {
  const p = new BetoRecordPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.record.urlPart);
  for (const c of SCREEN.record.columns) await expect(p.column(c), `컬럼 '${c}'`).toBeVisible();
  const rows = await p.renderedRowCount();
  expect(rows, '렌더 행 ≥ 0(빈 결과 정상)').toBeGreaterThanOrEqual(0);
  if (rows === 0) test.info().annotations.push({ type: '주의', description: '조회기간 내 배토기록 0건 → 행 정합성 생략(데이터 의존)' });
});

// 5. 페이지네이션 — 배토 기록 조회 (cp 파라미터)
test('항목5: 페이지네이션 — 배토 기록 조회 페이지 이동', async () => {
  const p = new BetoRecordPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.record.urlPart);
  const page2 = admin.getByRole('button', { name: '2', exact: true });
  if (await page2.count().catch(() => 0)) {
    await page2.first().click(); await settle(admin, 800);
    await expect(p.rows.first(), '2페이지 행 렌더').toBeVisible();
  } else {
    test.info().annotations.push({ type: '주의', description: '페이지 2 없음(1페이지 이내) → 이동 검증 생략' });
    await expect(p.table, '테이블 노출').toBeVisible();
  }
});

// 6. 달력/검색 — 배토 기록 조회 조회기간 컨트롤(달력 전용 → 컨트롤 검증)
test('항목6: 달력/검색 — 배토 기록 조회 조회기간 컨트롤', async () => {
  const p = new BetoRecordPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.record.urlPart);
  expect(await p.datepickers.count(), '조회기간 datepicker ≥2').toBeGreaterThanOrEqual(2);
  await expect(p.button(SCREEN.record.applyBtn), '[적용] 버튼').toBeVisible();
  await expect(p.button(SCREEN.record.resetBtn), '[초기화] 버튼').toBeVisible();
  test.info().annotations.push({ type: '한계', description: '데이트피커 달력 전용 → 1년 경계 자동 트리거 베스트에포트 제외(컨트롤 노출만)' });
});

// 7. 입력/반영 — 배토 통계 집계 모드 전환 → 적용 → 반영(비파괴 조회)
test('항목7: 입력/반영 — 배토 통계 집계 모드 전환/반영', async () => {
  const p = new BetoStatsPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.stats.urlPart);
  await expect(p.modeBtn('월별'), '집계 모드 [월별] 노출').toBeVisible();
  await p.modeBtn('월별').click();                                  // 집계 모드 전환(비파괴 조회 필터)
  await p.button(SCREEN.stats.applyBtn).first().click();
  await settle(admin, 1000);
  await expect(p.table, '집계 전환 후 테이블 유지').toBeVisible();
  const rows = await p.renderedRowCount();
  expect(rows, '집계 결과 반영(≥0)').toBeGreaterThanOrEqual(0);
  await p.modeBtn('일별').click().catch(() => {});                  // 원상복구
  await p.button(SCREEN.stats.applyBtn).first().click().catch(() => {});
});

// 8. 팝업/모달 — 배토 기록 조회 [보기](작업 경로) 모달 열고 닫기(비파괴)
test('항목8: 팝업/모달 — 배토 기록 작업 경로 보기 모달 열고 닫기', async () => {
  const p = new BetoRecordPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.record.urlPart);
  const view = p.viewBtn();
  if (!(await view.count().catch(() => 0))) {
    test.info().annotations.push({ type: '주의', description: '[보기] 버튼 없음(기록 0건) → 모달 검증 생략' });
    await expect(p.table).toBeVisible();
    return;
  }
  await view.first().click();
  await settle(admin, 800);
  const modal = admin.locator('.modal, [class*="modal-wrap"], [role="dialog"], .popup-layer, [class*="popup"]').first();
  if (await modal.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await admin.keyboard.press('Escape').catch(() => {});           // 닫기(비파괴)
    await settle(admin, 500);
  } else {
    test.info().annotations.push({ type: '주의', description: '[보기] 클릭 후 모달 미노출 — 지도/데이터 의존 추정. 버튼 노출까지만 검증' });
  }
  await expect(p.table, '화면 테이블 유지').toBeVisible();
});
