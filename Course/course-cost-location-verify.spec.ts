import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyCostByLocation } from '../lib/course/costExportVerify';
import { renderReport } from '../lib/course/exportVerifyCommon';

// 위치별 비용 [내보내기] xlsx ↔ 화면(코스 롤업) 집계 대조: 화면 코스 = Σ xlsx(코스별 홀 합산)(비파괴).
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-cost-location-verify.spec.ts --no-deps

test('위치별 비용 xlsx ↔ 화면 정합성(코스 = Σ홀, 비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyCostByLocation(admin);
  renderReport('course-cost-location-verify', '위치별 비용 — [내보내기] xlsx ↔ 화면 정합성',
    `비용 관리 > 위치별 비용 · 코스 롤업 = Σ홀 · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '화면은 코스 롤업(South/East/West/전체골프장), xlsx는 코스×홀 리프 → <b>화면 코스 = Σ xlsx(코스별 홀 합산)</b>로 총비용+13분류+5유형(19열) 집계 대조. 참고(➖)=판정 제외.',
    checks);
});
