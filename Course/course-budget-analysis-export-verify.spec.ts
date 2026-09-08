import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyBudgetAnalysisAnnual, renderBudgetReport } from '../lib/course/budgetExportVerify';

// ──────────────────────────────────────────────────────────────
//  예산 분석 > 연간 테이블 [내보내기] xlsx ↔ 화면 그리드 정합성(소분류 8지표, 비파괴).
//   ⚠ 예산 분석 탭 4개지만 export 파일 2종 — 연간(그래프=테이블)=예산_연간_분석, 월간=별도 스펙.
//   자동 다운로드 통합형. 로직 = lib/course/budgetExportVerify.ts(verifyBudgetAnalysisAnnual).
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-analysis-export-verify.spec.ts --no-deps
//   env: BUD_ANAL_XLSX 폴백 경로.
// ──────────────────────────────────────────────────────────────

test('예산 분석 연간 테이블 xlsx ↔ 화면 그리드 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyBudgetAnalysisAnnual(admin);
  renderBudgetReport(
    'course-budget-analysis-export-verify',
    '예산 분석 — [내보내기] xlsx ↔ 화면 그리드 정합성(연간)',
    `예산 관리 > 예산 분석 > 연간 테이블 · 소분류 레벨(8지표) · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '연간 테이블 탭에서 <b>[내보내기] 직접 다운로드</b> → 화면 그리드(대/중/소분류 + 8지표: 연간예산·누적사용·잔여예산·전체예산절감초과·<b>예산사용률(%)</b>·누적예산·<b>누적예산대비누적사용(%)</b>·누적예산절감초과)와 대조(정수 6열 완전일치·소수%2열 ±0.01). 월간(그래프=테이블)은 별도 스펙. 자동 실패 시 폴백=🔎. 참고(➖)=판정 제외.',
    checks,
  );
});
