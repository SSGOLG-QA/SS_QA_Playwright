import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { runIA } from '../lib/suites';
import { writeIAReport, resetIA } from '../lib/reporter';

// IA 메뉴 구현 여부 (존재·진입) — 별도 시트
// 실행: npx playwright test --project=admin-chromium Admin/ia-coverage.spec.ts --no-deps
test('IA 메뉴 구현 여부 검증', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetIA();
  const admin = await openAdmin(page, context);
  await runIA(admin);
});

test.afterAll(async () => { await writeIAReport('ia-coverage'); });
