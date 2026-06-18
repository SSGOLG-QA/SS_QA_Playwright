import { test } from '../lib/fixtures';
import { runSalesReconcile } from '../lib/flows/salesReconcile';
import { gotoMenu, writeReport, resetResults, resetNoTC, resetDiff } from '../lib/reporter';

// ────────────────────────────────────────────────────────────────
//  L4 Scenario 검증 — 매출 교차정합(주문 내역 ↔ 매출 집계)
//  PageObject를 엮은 시나리오: 요약카드(집계) ↔ 캐디 랭킹(명세) 정합.
//  실행: npx playwright test --project=admin-chromium Admin/l4-reconcile.spec.ts --no-deps
// ────────────────────────────────────────────────────────────────
test('L4 매출 교차정합 — 주문 내역 요약 ↔ 캐디 랭킹', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '식음 관리', '주문 내역 관리', { path: '식음 관리 > 주문 내역 관리 > 교차정합', tcRef: '식음 관리_주문 내역_RECON', tcId: '진입', desc: '주문 내역 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runSalesReconcile(admin);
  await writeReport('l4-reconcile');
});
