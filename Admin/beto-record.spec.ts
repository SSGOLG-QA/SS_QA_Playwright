import { test } from '../lib/fixtures';
import { runBetoRecord } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 배토 관리 > 배토 기록 조회 - TC No.1~25 전수 적용 (드라이브 배토기록조회_1~4 기준, 2026-06-18)
// ⚠ 비파괴. skip: No.6(1년초과·알럿충돌) / No.12(캐디선택·데이터의존) / No.14(빈결과·데이터의존) / No.18~23(팝업·QA-14962) / No.25(페이지이동·데이터의존)
// 실행: npx playwright test --project=admin-chromium Admin/beto-record.spec.ts --no-deps
test('배토 관리 > 배토 기록 조회 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '배토 관리', '배토 기록 조회', { path: '배토 관리 > 배토 기록 조회', tcRef: '배토 관리_배토 기록 조회', tcId: '진입', desc: '배토 기록 조회 진입', failMsg: '메뉴 진입 불가' }))
    await runBetoRecord(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('beto-record'); });
