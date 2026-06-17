import { test } from '../lib/fixtures';
import { runRoundMgmt } from '../lib/suites';
import { writeReport, resetResults, resetNoTC } from '../lib/reporter';

// 라운드 관리 - 드라이브 TC 예상결과 전수 검증 + SNB有/TC無 이슈
// 실행: npx playwright test --project=admin-chromium Admin/round-mgmt-all.spec.ts --no-deps
test('라운드 관리 검증 (TC 예상결과 전수)', async ({ admin }) => {
  test.setTimeout(360_000);
  resetResults(); resetNoTC();
  await runRoundMgmt(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('round-mgmt-all'); });
