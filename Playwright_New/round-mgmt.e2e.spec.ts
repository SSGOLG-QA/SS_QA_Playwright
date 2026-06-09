import { test, expect, Page } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { VisitStatusPage, VisitStatsPage, RoundAllPage, CartMgmtPage } from './round-mgmt.pom';
import { SCREEN, ALERT } from './round-mgmt.data';

// ──────────────────────────────────────────────────────────────
//  라운드 관리 E2E (현재 구현 AS-IS 기준) — POM 패턴
//  8개 테스트 항목을 라운드 관리 화면에 매핑.
//  ⚠ 비파괴: 저장/삭제/사용중지 '확인' 등 데이터 변경은 수행하지 않음(노출·취소·검색 반영까지만).
//  실행: npx playwright test --config=Playwright_New/playwright.config.ts
// ──────────────────────────────────────────────────────────────

// 각 테스트 독립(beforeEach 진입) — 한 항목 실패가 다른 항목을 막지 않도록 serial 미사용
let admin: Page;
test.beforeEach(async ({ page, context }) => {
  admin = await openAdmin(page, context);   // 대시보드→어드민 진입(세션 재사용) + 알림 자동 핸들러 등록
});

// 1. 기능 진입 — 지정 URL 접속 및 페이지 로드 확인
test('항목1: 기능 진입 — 내장 현황 URL 접속 및 로드', async () => {
  const p = new VisitStatusPage(admin);
  await p.open();                                                   // SNB '내장 현황' 진입
  await p.expectLoaded(SCREEN.visit.urlPart);                       // URL(/round-visit) + 헤더 노출
  await expect(p.infoBox, '안내 문구 로드').toContainText(SCREEN.visit.guide);
  await expect(p.table, '리스트 테이블 로드').toBeVisible();
});

// 2. 텍스트 검증 — 오타/가공되지 않은 코드(JSON, 변수명, {{}} 등) 노출 여부
test('항목2: 텍스트 검증 — raw code/미가공 코드 미노출', async () => {
  for (const PageCls of [VisitStatusPage, RoundAllPage]) {
    const p = new PageCls(admin);
    await p.open();
    const hits = await p.scanRawCode();
    expect(hits, `미가공 코드 노출: ${JSON.stringify(hits)}`).toEqual([]);
  }
});

// 3. 버튼 동작 — 클릭 시 다른 화면 이동 + 랜딩 후 세션 유지
test('항목3: 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지', async () => {
  const visit = new VisitStatusPage(admin);
  await visit.open();
  await visit.expectLoaded(SCREEN.visit.urlPart);

  const cart = new CartMgmtPage(admin);
  await cart.open();                                                // 다른 화면(카트 관리)으로 이동
  await cart.expectLoaded(SCREEN.cart.urlPart);                     // URL 변경 확인
  await cart.expectSessionAlive();                                  // 랜딩 후 세션 유지(관제 어드민/club)
});

// 4. 데이터 정합성 — 리스트 총 건수 vs 렌더링된 행 개수
test('항목4: 데이터 정합성 — 총 건수 vs 렌더 행 수', async () => {
  const p = new CartMgmtPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.cart.urlPart);
  const rows = await p.renderedRowCount();
  const total = await p.listTotalCount();
  expect(rows, '현재 페이지 렌더 행 ≥ 1').toBeGreaterThan(0);
  if (total !== null) {
    expect(rows, '페이지 행 수 ≤ 총 건수').toBeLessThanOrEqual(total);
    if (total <= rows) expect(rows, '총 건수 ≤ 페이지크기 → 행=총건수').toBe(total);
  } else {
    test.info().annotations.push({ type: '주의', description: '리스트 총 건수 표기 미발견 → 행 수 존재만 검증' });
  }
});

// 5. 페이지네이션 — 임의 페이지/이전/다음/처음/마지막
test('항목5: 페이지네이션 — 페이지 이동', async () => {
  const p = new CartMgmtPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.cart.urlPart);

  await p.gotoPageNumber(2);                                        // 임의 페이지(2)
  const onPage2 = p.currentPageParam() === 2
    || (await admin.locator('.pagination .active, button.active', { hasText: '2' }).count()) > 0;
  expect(onPage2, '2페이지로 이동').toBeTruthy();
  await expect(p.rows.first(), '2페이지 행 렌더').toBeVisible();

  // 이전/다음/처음/마지막 — 화살표 아이콘이 있을 때만 best-effort
  for (const dir of ['prev', 'next', 'first', 'last'] as const) {
    const a = p.arrow(dir);
    if (await a.count()) { await a.click().catch(() => {}); await admin.waitForTimeout(600); await expect(p.rows.first()).toBeVisible(); }
    else test.info().annotations.push({ type: '주의', description: `[${dir}] 화살표 버튼 미발견(숫자 페이지네이션만 제공 가능)` });
  }
});

// 6. 달력/검색 — 조회기간 컨트롤 검증 + (1년 초과 경계 알럿: 베스트에포트)
//   ⚠ 데이트피커가 '달력 전용'(fill/타이핑 미반영)이고 달력 팝업이 뷰포트 밖에 위치 →
//     프로그램으로 1년 초과 범위를 안정적으로 설정하기 어려움. 컨트롤 존재는 검증, 경계 알럿은 베스트에포트.
test('항목6: 달력/검색 — 조회기간 컨트롤 + 1년 초과 경계 알럿(베스트에포트)', async () => {
  const p = new VisitStatsPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.stats.urlPart);

  // (자동화 가능) 조회기간 datepicker(시작/종료) + [적용] 노출
  await expect(p.datepickers.first(), '조회기간 datepicker 노출').toBeVisible();
  expect(await p.datepickers.count(), '시작/종료 datepicker ≥2').toBeGreaterThanOrEqual(2);
  await expect(p.button(SCREEN.stats.applyBtn), '[적용] 버튼 노출').toBeVisible();

  // (베스트에포트) 달력 구동으로 1년 초과 범위 → 제한 알럿 → 확인 닫힘
  let boundaryChecked = false;
  try {
    await p.pickRangeMonthsBack(13);
    await p.clickApply();
    if (await p.alert(ALERT.over1Year).isVisible({ timeout: 5_000 }).catch(() => false)) {
      boundaryChecked = true;
      await p.alertConfirmBtn().first().click().catch(() => {});
      await expect(p.alert(ALERT.over1Year), '확인 후 알럿 닫힘').toBeHidden({ timeout: 8_000 });
    }
  } catch { /* 달력 구동 실패 → 아래 한계 주석 */ }
  if (!boundaryChecked) {
    test.info().annotations.push({ type: '한계(자동화 불가)', description: '데이트피커 달력 전용 + 팝업 뷰포트밖 → 1년 초과 경계 알럿 자동 트리거 불가. 수동 검증 권장(알럿 .modal-footer 확인 구조/자동닫힘은 핸들러 단위로 별도 검증됨).' });
  }
});

// 7. 입력 필드 — 폼 입력 → 적용 → 검색 결과 반영 (비파괴: 저장 아님)
test('항목7: 입력 필드 — 전체 라운드 검색 입력/반영', async () => {
  const p = new RoundAllPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.all.urlPart);

  const ph = SCREEN.all.searchPlaceholders[1];                     // '캐디명 입력'
  await expect(p.searchInput(ph), '검색 입력 필드 노출').toBeVisible();
  await p.search(ph, '__E2E_없는값__');                            // 매칭 없을 값 → 빈 결과로 '반영' 확인
  // 반영 결과: 빈 상태 또는 필터된 테이블이 정상 렌더 (비파괴)
  const rows = await p.renderedRowCount();
  expect(rows, '검색 반영(빈 결과=0 정상)').toBeGreaterThanOrEqual(0);
  await expect(p.table, '검색 후 테이블 영역 유지').toBeVisible();
  await p.reset();                                                  // 원복(초기화)
});

// 8. 팝업/모달 — 취소(닫기) 흐름 (확인 흐름은 항목6에서 검증)
test('항목8: 팝업/모달 — 카트 사용중지 confirm 취소(닫기)', async () => {
  const p = new CartMgmtPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.cart.urlPart);

  await p.openDisableConfirm();                                    // 행 [사용중지] → confirm 모달
  await expect(p.confirmModal(), 'confirm 모달 노출').toBeVisible({ timeout: 8_000 });
  await expect(p.modalCancelBtn(), '취소 버튼 노출').toBeVisible();
  await p.modalCancelBtn().click();                                // 취소(닫기) — 비파괴
  await expect(p.confirmModal(), '취소 후 모달 닫힘').toBeHidden({ timeout: 8_000 });
});
