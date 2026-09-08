import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyBudgetDetail, renderBudgetReport } from '../lib/course/budgetExportVerify';

// ──────────────────────────────────────────────────────────────
//  예산 상세 > 전체 탭 [내보내기] xlsx ↔ 화면 그리드 정합성(소분류/적요, 비파괴).
//   자동 다운로드 통합형. 로직 = lib/course/budgetExportVerify.ts(verifyBudgetDetail).
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-budget-detail-verify.spec.ts --no-deps
//   env: BUD_DETAIL_XLSX 폴백 경로.
// ──────────────────────────────────────────────────────────────

test('예산 상세 전체 탭 xlsx ↔ 화면 그리드 정합성(소분류/적요, 비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyBudgetDetail(admin);
  renderBudgetReport(
    'course-budget-detail-verify',
    '예산 상세 — [내보내기] xlsx ↔ 화면 그리드 정합성',
    `예산 관리 > 예산 상세 > 전체 탭 · 소분류/적요 레벨(합계+12월) · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '전체 탭에서 <b>[내보내기] 직접 다운로드</b> → 화면 그리드(대/중/소분류·합계·1~12월, rowspan+페이지네이션 재구성)와 상세행 대조. 순서 인덱스 매칭 → 라벨 검증 후 값 대조. 자동 실패 시 폴백=🔎. 참고(➖)=판정 제외.',
    checks,
  );
});
