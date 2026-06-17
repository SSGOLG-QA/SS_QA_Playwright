import { test } from '../lib/fixtures';
import { runCustomerEval, runCaddieEval, runReviewList, runReviewStats } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 고객 평가 관리 4종 (고객 평가/캐디 평가/후기 리스트/후기 통계) - 구조 기반
//   ⚠ 적용/초기화/내보내기/조회/숨김 처리는 비파괴(노출만). 안내문구 부분 일치
// 실행: npx playwright test --project=admin-chromium Admin/customer-eval.spec.ts --no-deps
test('고객 평가 관리 4종 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(360_000);
  resetResults(); resetNoTC(); resetDiff();
  const M = '고객 평가 관리';
  if (await gotoMenu(admin, M, '고객 평가', { path: '고객 평가 관리 > 고객 평가', tcRef: '고객 평가 관리_고객 평가', tcId: '진입', desc: '고객 평가 진입', failMsg: '메뉴 진입 불가' }))
    await runCustomerEval(admin);
  if (await gotoMenu(admin, M, '캐디 평가', { path: '고객 평가 관리 > 캐디 평가', tcRef: '고객 평가 관리_캐디 평가', tcId: '진입', desc: '캐디 평가 진입', failMsg: '메뉴 진입 불가' }))
    await runCaddieEval(admin);
  if (await gotoMenu(admin, M, '후기 리스트', { path: '고객 평가 관리 > 후기 리스트', tcRef: '고객 평가 관리_후기 리스트', tcId: '진입', desc: '후기 리스트 진입', failMsg: '메뉴 진입 불가' }))
    await runReviewList(admin);
  if (await gotoMenu(admin, M, '후기 통계', { path: '고객 평가 관리 > 후기 통계', tcRef: '고객 평가 관리_후기 통계', tcId: '진입', desc: '후기 통계 진입', failMsg: '메뉴 진입 불가' }))
    await runReviewStats(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('customer-eval'); });
