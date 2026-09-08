import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyCostByCategory } from '../lib/course/costExportVerify';
import { renderReport } from '../lib/course/exportVerifyCommon';

// 분류별 비용 [내보내기] xlsx ↔ 화면(1분류 롤업) 집계 대조: 화면 1분류 = Σ xlsx 리프(비파괴).
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-cost-category-verify.spec.ts --no-deps

test('분류별 비용 xlsx ↔ 화면 정합성(1분류 = Σ리프, 비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyCostByCategory(admin);
  renderReport('course-cost-category-verify', '분류별 비용 — [내보내기] xlsx ↔ 화면 정합성',
    `비용 관리 > 분류별 비용 · 1분류 롤업 = Σ리프 · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '화면은 1분류 롤업, xlsx는 리프(1/2/3분류) → <b>화면 1분류 = Σ xlsx 리프(1분류별)</b>로 합계+5유형 집계 대조. xlsx는 비용집계와 동일 파일. 참고(➖)=판정 제외.',
    checks);
});
