import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyBudgetPerf, renderBudgetReport } from '../lib/course/budgetExportVerify';

// ──────────────────────────────────────────────────────────────
//  실적 관리 > 전체 탭 [내보내기] xlsx ↔ 화면 그리드 정합성(소분류, 비파괴).
//   ⚠ [내보내기]는 전체 탭에서만 노출. 자동 다운로드 통합형.
//   로직 = lib/course/budgetExportVerify.ts(verifyBudgetPerf).
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-perf-export-verify.spec.ts --no-deps
//   env: BUD_PERF_XLSX 폴백 경로.
// ──────────────────────────────────────────────────────────────

test('실적 관리 전체 탭 xlsx ↔ 화면 그리드 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyBudgetPerf(admin);
  renderBudgetReport(
    'course-budget-perf-export-verify',
    '실적 관리 — [내보내기] xlsx ↔ 화면 그리드 정합성',
    `예산 관리 > 실적 관리 > 전체 탭 · 소분류 레벨(1~12월) · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '전체 탭에서 <b>[내보내기] 직접 다운로드</b>(⚠ 내보내기·업로드는 전체 탭에서만) → 화면 그리드(대/중/소분류·1~12월, 소계행은 화면 렌더만 → 상세행만 추출)와 대조. xlsx는 ClassificationType 있는 상세행만. 자동 실패 시 폴백=🔎. 참고(➖)=판정 제외.',
    checks,
  );
});
