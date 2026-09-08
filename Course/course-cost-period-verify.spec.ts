import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyCostByPeriod } from '../lib/course/costExportVerify';
import { renderReport } from '../lib/course/exportVerifyCommon';

// 기간별 비용 [내보내기] xlsx ↔ 화면(1분류 롤업, 3개년 YoY) 집계 대조(비파괴).
//   ⚠ 과거 400 결함 이력 — 다운로드 실패 시 결함으로 검출.
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-cost-period-verify.spec.ts --no-deps

test('기간별 비용 xlsx ↔ 화면 정합성(1분류 = Σ리프·3개년, 비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyCostByPeriod(admin);
  renderReport('course-cost-period-verify', '기간별 비용 — [내보내기] xlsx ↔ 화면 정합성',
    `비용 관리 > 기간별 비용 · 1분류 롤업 = Σ리프 · 2024·2025·2026 · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '화면은 1분류 롤업(전체+분류), xlsx는 리프 → <b>화면 1분류 = Σ xlsx 리프</b>로 3개년(2024·2025·2026, YoY 제거) 집계 대조 + 전체=Σ전분류. ⚠ 과거 내보내기 400 결함 이력 — 다운로드 실패 시 결함 검출. 참고(➖)=판정 제외.',
    checks);
});
