/**
 * P2-D: 계산 불변식 검증 — 5개 메뉴 통합 스펙
 *
 * 목적: "요소가 보이는가" → "파생값이 원시값과 정합한가"로 전환.
 *       각 메뉴가 화면에 표시하는 파생 수치(합계·비율·평균)를
 *       같은 행의 원시값으로 독립 재계산해 대조.
 *
 * 대상 메뉴(5개):
 *   - 라운드관리 > 내장 현황   : 총=남+여, SS비율, 출력률 (기존 파일럿 A 재사용)
 *   - 라운드관리 > 내장 통계   : 전체=남+여, 연령합≤전체 (P2-D 신규)
 *   - 코스 운영 관리 > 코스 분석: 안착률·적중률 ∈[0,100], 퍼트수·스코어≥0 (P2-D 독립화)
 *   - 고객 평가 관리 > 후기 통계: 건수·평점≥0, '전체'평점=평균추론 (P2-D 독립화)
 *   - 식음 관리 > 주문 내역 관리: 주문금액=공급가+부가세, 평균=round(금액/건수) (P2-D 독립화)
 *
 * 실행:
 *   npx playwright test --project=admin-chromium Admin/calc-invariants.spec.ts --no-deps --headed
 *
 * 산출물:
 *   reports/calc-invariants_report_<timestamp>.xlsx
 */

import { test } from '../lib/fixtures';
import { gotoMenu, writeReport, resetResults, resetNoTC, resetDiff } from '../lib/reporter';
import {
  runVisitStatusCalc,
  runRoundStatsCalc,
  runCourseAnalysisCalc,
  runReviewStatsCalc,
  runFnbOrderHistoryCalc,
} from '../lib/suites';

test('계산 불변식 — 5개 메뉴 정합성', async ({ admin }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff();

  // ── (1) 라운드관리 > 내장 현황 ──────────────────────────────────
  if (await gotoMenu(admin, '라운드 관리', '내장 현황', {
    path: '라운드관리 > 내장 현황 > 정합성',
    tcRef: '라운드 관리_CALC', tcId: '진입', desc: '내장 현황 진입', failMsg: '메뉴 진입 불가',
  })) await runVisitStatusCalc(admin);

  // ── (2) 라운드관리 > 내장 통계 ──────────────────────────────────
  if (await gotoMenu(admin, '라운드 관리', '내장 통계', {
    path: '라운드관리 > 내장 통계 > 정합성',
    tcRef: '내장통계_CALC', tcId: '진입', desc: '내장 통계 진입', failMsg: '메뉴 진입 불가',
  })) await runRoundStatsCalc(admin);

  // ── (3) 코스 운영 관리 > 코스 분석 ──────────────────────────────
  if (await gotoMenu(admin, '코스 운영 관리', '코스 분석', {
    path: '코스 운영 관리 > 코스 분석 > 정합성',
    tcRef: '코스_CALC', tcId: '진입', desc: '코스 분석 진입', failMsg: '메뉴 진입 불가',
  })) await runCourseAnalysisCalc(admin);

  // ── (4) 고객 평가 관리 > 후기 통계 ──────────────────────────────
  if (await gotoMenu(admin, '고객 평가 관리', '후기 통계', {
    path: '고객 평가 관리 > 후기 통계 > 정합성',
    tcRef: '후기통계_CALC', tcId: '진입', desc: '후기 통계 진입', failMsg: '메뉴 진입 불가',
  })) await runReviewStatsCalc(admin);

  // ── (5) 식음 관리 > 주문 내역 관리 ─────────────────────────────
  if (await gotoMenu(admin, '식음 관리', '주문 내역 관리', {
    path: '식음 관리 > 주문 내역 관리 > 정합성',
    tcRef: '식음_CALC', tcId: '진입', desc: '주문 내역 관리 진입', failMsg: '메뉴 진입 불가',
  })) await runFnbOrderHistoryCalc(admin);

  await writeReport('calc-invariants');
});
