import { test } from '../lib/fixtures';
import { runBetoRecord } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 배토 관리 > 배토 기록 조회 - 구조 기반 (드라이브 상세 TC 미작성). ⚠ 초기화/적용/보기는 비파괴
// 실행: npx playwright test --project=admin-chromium Admin/beto-record.spec.ts --no-deps
test('배토 관리 > 배토 기록 조회 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '배토 관리', '배토 기록 조회', { path: '배토 관리 > 배토 기록 조회', tcRef: '배토 관리_배토 기록 조회', tcId: '진입', desc: '배토 기록 조회 진입', failMsg: '메뉴 진입 불가' }))
    await runBetoRecord(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('beto-record'); });
