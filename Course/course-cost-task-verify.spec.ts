import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyCostByTask } from '../lib/course/costExportVerify';
import { renderReport } from '../lib/course/exportVerifyCommon';

// 작업별 비용 [내보내기] xlsx ↔ 화면(작업번호 키·페이지네이션) 직접 대조: 총비용+5유형(비파괴).
//   실행: npx playwright test --config=Course/playwright.config.ts --project=course Course/course-cost-task-verify.spec.ts --no-deps

test('작업별 비용 xlsx ↔ 화면 정합성(작업번호 키, 비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks = await verifyCostByTask(admin);
  renderReport('course-cost-task-verify', '작업별 비용 — [내보내기] xlsx ↔ 화면 정합성',
    `비용 관리 > 작업별 비용 · 작업번호 키 · 킹즈락 · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · 비파괴`,
    '화면(작업번호별 행, 페이지네이션 전수)을 <b>[내보내기] 직접 다운로드</b> xlsx와 작업번호로 매칭 → 총비용+5유형 대조(소수→반올림, ±1.5). 참고(➖)=판정 제외.',
    checks);
});
