import { test } from '../lib/fixtures';
import { runSalesReconcile } from '../lib/flows/salesReconcile';
import { runVisitStatsReconcile } from '../lib/flows/visitStatsReconcile';
import { gotoMenu, writeReport, resetResults, resetNoTC, resetDiff } from '../lib/reporter';

// ────────────────────────────────────────────────────────────────
//  L4 Scenario 검증 — 화면 내 집계 ↔ 명세 교차정합(PageObject 엮음)
//   ① 매출: 주문 내역 요약카드 ↔ 캐디 랭킹표
//   ② 내장 통계: 요약카드 ↔ 통계표
//  실행: npx playwright test --project=admin-chromium Admin/l4-reconcile.spec.ts --no-deps
// ────────────────────────────────────────────────────────────────
test('L4 교차정합 — 매출(주문 내역) + 내장 통계', async ({ admin }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff();

  if (await gotoMenu(admin, '식음 관리', '주문 내역 관리', { path: '식음 관리 > 주문 내역 관리 > 교차정합', tcRef: '식음 관리_주문 내역_RECON', tcId: '진입', desc: '주문 내역 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runSalesReconcile(admin);

  if (await gotoMenu(admin, '라운드 관리', '내장 통계', { path: '라운드관리 > 내장 통계 > 교차정합', tcRef: '라운드 관리_내장 통계_RECON', tcId: '진입', desc: '내장 통계 진입', failMsg: '메뉴 진입 불가' }))
    await runVisitStatsReconcile(admin);

  await writeReport('l4-reconcile');
});
