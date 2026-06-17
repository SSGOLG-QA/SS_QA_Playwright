import { test } from '../lib/fixtures';
import { runHome } from '../lib/suites';
import { writeReport, resetResults } from '../lib/reporter';

// 홈(Home) - 드라이브 TC #1~10 예상결과 전수 검증
// 실행: npx playwright test --project=admin-chromium Admin/home.spec.ts --no-deps
test('홈(Home) 검증 (TC 예상결과 전수)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults();
  await runHome(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('home'); });
