import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyCostAggregate } from '../lib/course/costExportVerify';
import { renderReport } from '../lib/course/exportVerifyCommon';

// 비용 집계 [내보내기] xlsx ↔ 화면 요약(작업지시/실발생/차액 × 합계+5유형) 직접 대조 + 내부 불변식(비파괴).
//   로직 = lib/course/costExportVerify.ts(verifyCostAggregate). ⚠ 비용집계·분류별은 동일 xlsx.
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-cost-aggregate-verify.spec.ts --no-deps

test('비용 집계 xlsx ↔ 화면 요약 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyCostAggregate(admin);
  renderReport('course-cost-aggregate-verify', '비용 집계 — [내보내기] xlsx ↔ 화면 요약 정합성',
    `비용 관리 > 비용 집계 · 요약(작업지시/실발생/차액) · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '요약 3행(작업지시 비용/실제 발생 비용/차액) × [합계+5유형]을 <b>[내보내기] 직접 다운로드</b> xlsx와 대조 + 내부 불변식(합계=Σ유형·차액=실발생−작업지시). 참고(➖)=판정 제외.',
    checks);
});
