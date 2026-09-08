import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyBudgetSummary, renderBudgetReport } from '../lib/course/budgetExportVerify';

// ──────────────────────────────────────────────────────────────
//  예산 총괄 [내보내기] xlsx ↔ 화면(월간 중분류×1~12월 / 연간 중분류×2024·2025·2026) 정합성(비파괴).
//   자동 다운로드 통합형(각 탭에서 [내보내기] 직접 클릭 → 캡처 → 같은 런·화면과 셀 단위 대조).
//   로직은 lib/course/budgetExportVerify.ts(verifyBudgetSummary) — 통합 스펙과 단일 소스.
//   실행: npm run course:auth 후
//   npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-export-verify.spec.ts --no-deps
//   env: BUD_MONTHLY_XLSX / BUD_ANNUAL_XLSX 폴백 경로.
// ──────────────────────────────────────────────────────────────

test('예산 총괄 내보내기 xlsx ↔ 화면 데이터 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyBudgetSummary(admin);
  renderBudgetReport(
    'course-budget-export-verify',
    '예산 총괄 — [내보내기] xlsx ↔ 화면 데이터 정합성',
    `예산 관리 > 예산 총괄 · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '각 탭에서 <b>[내보내기]를 스크립트가 직접 눌러 다운로드</b>(자동 다운로드 통합형) → 화면(월간: 중분류×1~12월 / 연간: 중분류×2024·2025·2026)과 <b>셀 단위 대조</b>. 자동 실패 시 폴백(수동)=🔎. 참고(➖)=판정 제외.',
    checks,
  );
});
