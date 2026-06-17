import { test } from '../lib/fixtures';
import { runVisitStatusCalc } from '../lib/suites';
import { gotoMenu, writeReport, resetResults, resetNoTC, resetDiff } from '../lib/reporter';

// ────────────────────────────────────────────────────────────────
//  파일럿 A — 계산 정합성(Data-Driven / Oracle) · 대상: 라운드관리 > 내장 현황
//  "컬럼이 보이는가" → "파생값(총=남+여·SS회원 비율·출력률)이 원시값과 정합한가"로 전환.
//   · 검증 로직은 lib/suites.runVisitStatusCalc (all-suite/round-mgmt와 공유·DRY)
//  실행: npx playwright test --project=admin-chromium Admin/visit-status-calc.spec.ts --no-deps
// ────────────────────────────────────────────────────────────────
test('내장 현황 — 계산 정합성(Data-Driven)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '라운드 관리', '내장 현황', { path: '라운드관리 > 내장 현황 > 정합성', tcRef: '라운드 관리_CALC', tcId: '진입', desc: '내장 현황 진입', failMsg: '메뉴 진입 불가' }))
    await runVisitStatusCalc(admin);
  await writeReport('visit-status-calc');
});
