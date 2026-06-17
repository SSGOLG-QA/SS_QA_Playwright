import { test } from '../lib/fixtures';
import { runCaddieList, runCaddieRegister, runCaddiePerformance } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 캐디 관리 3종 (캐디리스트/캐디 등록 관리/캐디 실적) - 구조 기반 (드라이브 상세 TC 미작성)
//   ⚠ 관제적용/적용/저장/입력란 추가/삭제/행 액션은 비파괴(노출만). 안내문구 부분 일치
// 실행: npx playwright test --project=admin-chromium Admin/caddie.spec.ts --no-deps
test('캐디 관리 3종 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff();
  const M = '캐디 관리';
  if (await gotoMenu(admin, M, '캐디 리스트', { path: '캐디 관리 > 캐디리스트', tcRef: '캐디 관리_캐디리스트', tcId: '진입', desc: '캐디리스트 진입', failMsg: '메뉴 진입 불가' }))
    await runCaddieList(admin);
  if (await gotoMenu(admin, M, '캐디 등록 관리', { path: '캐디 관리 > 캐디 등록 관리', tcRef: '캐디 관리_캐디 등록 관리', tcId: '진입', desc: '캐디 등록 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runCaddieRegister(admin);
  if (await gotoMenu(admin, M, '캐디 실적', { path: '캐디 관리 > 캐디 실적', tcRef: '캐디 관리_캐디 실적', tcId: '진입', desc: '캐디 실적 진입', failMsg: '메뉴 진입 불가' }))
    await runCaddiePerformance(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('caddie'); });
