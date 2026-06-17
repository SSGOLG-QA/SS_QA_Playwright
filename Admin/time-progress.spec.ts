import { test } from '../lib/fixtures';
import { runTimeStandard, runTimeRealtime, runTimeSearch, runTimeStats } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 경기 진행 관리 4종 (진행시간 표준 설정/실시간/조회/통계) - 구조 기반 (드라이브 상세 TC 미작성)
//   ⚠ 저장/권장값 적용/통계자료 작성/내보내기/검색은 비파괴(노출만). 안내문구 부분 일치
// 실행: npx playwright test --project=admin-chromium Admin/time-progress.spec.ts --no-deps
test('경기 진행 관리 4종 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff();
  const M = '경기 진행 관리';
  if (await gotoMenu(admin, M, '진행시간 표준 설정', { path: '경기 진행 관리 > 진행시간 표준 설정', tcRef: '경기 진행 관리_진행시간 표준 설정', tcId: '진입', desc: '진행시간 표준 설정 진입', failMsg: '메뉴 진입 불가' }))
    await runTimeStandard(admin);
  if (await gotoMenu(admin, M, '진행시간 실시간', { path: '경기 진행 관리 > 진행시간 실시간', tcRef: '경기 진행 관리_진행시간 실시간', tcId: '진입', desc: '진행시간 실시간 진입', failMsg: '메뉴 진입 불가' }))
    await runTimeRealtime(admin);
  if (await gotoMenu(admin, M, '진행시간 조회', { path: '경기 진행 관리 > 진행시간 조회', tcRef: '경기 진행 관리_진행시간 조회', tcId: '진입', desc: '진행시간 조회 진입', failMsg: '메뉴 진입 불가' }))
    await runTimeSearch(admin);
  if (await gotoMenu(admin, M, '진행시간 통계', { path: '경기 진행 관리 > 진행시간 통계', tcRef: '경기 진행 관리_진행시간 통계', tcId: '진입', desc: '진행시간 통계 진입', failMsg: '메뉴 진입 불가' }))
    await runTimeStats(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('time-progress'); });
