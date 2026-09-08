import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyBudgetAnalysisMonthly, renderBudgetReport } from '../lib/course/budgetExportVerify';

// ──────────────────────────────────────────────────────────────
//  예산 분석 > 월간(그래프/테이블) [내보내기] '예산_월간_분석' xlsx 정합성(비파괴).
//   월간 xlsx = 12개월 × 8지표. 화면은 당월 1개월만 표시 → ①내부 불변식 ②연간 xlsx 교차 ③화면 당월 슬라이스.
//   ⚠ 연간 교차용 파일도 같은 런에서 신선 자동 다운로드(폴백 stale 오탐 방지).
//   로직 = lib/course/budgetExportVerify.ts(verifyBudgetAnalysisMonthly).
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-monthly-export-verify.spec.ts --no-deps
//   env: BUD_MONTHLY_ANAL_XLSX / BUD_ANAL_XLSX 폴백 경로.
// ──────────────────────────────────────────────────────────────

test('예산 월간 분석 xlsx 정합성(내부 불변식 + 연간 교차 + 화면 당월, 비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyBudgetAnalysisMonthly(admin);
  renderBudgetReport(
    'course-budget-monthly-export-verify',
    '예산 월간 분석 — [내보내기] xlsx 정합성',
    `예산 관리 > 예산 분석 > 월간(그래프/테이블) · 12월×8지표 · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '월간 테이블 탭에서 <b>[내보내기] 직접 다운로드</b>. 화면은 당월 1개월만 표시 → <b>①내부 불변식</b>(당월절감=사용−예산·누적=Σ당월·사용률) <b>②연간 xlsx 교차</b>(연간예산=월간누적예산[12]·연간누적사용=월간누적사용[12], 신선 자동 다운로드) <b>③화면 당월 슬라이스</b>(자동 월감지). 참고(➖)=판정 제외.',
    checks,
  );
});
