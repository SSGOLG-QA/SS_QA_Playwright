import { test } from '../lib/fixtures';
import { runHolemapZone, runHolemapCartEntrance, runHolemapTeeshot, runHolemapPreview } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 홀맵 관리 4종 (홀맵 구역 설정/카트패스 진입여부/티샷 유의 거리/홀맵 미리보기) - 구조 기반
//   ⚠ 저장/적용/구역관리/전체 허용·제한/checkbox·input 변경은 비파괴. 미리보기는 시각 도구 제한 검증
// 실행: npx playwright test --project=admin-chromium Admin/holemap.spec.ts --no-deps
test('홀맵 관리 4종 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff();
  const M = '홀맵 관리';
  if (await gotoMenu(admin, M, '홀맵 구역 설정', { path: '홀맵 관리 > 홀맵 구역 설정', tcRef: '홀맵 관리_홀맵 구역 설정', tcId: '진입', desc: '홀맵 구역 설정 진입', failMsg: '메뉴 진입 불가' }))
    await runHolemapZone(admin);
  if (await gotoMenu(admin, M, '카트패스 진입여부 설정', { path: '홀맵 관리 > 카트패스 진입여부 설정', tcRef: '홀맵 관리_카트패스 진입여부 설정', tcId: '진입', desc: '카트패스 진입여부 설정 진입', failMsg: '메뉴 진입 불가' }))
    await runHolemapCartEntrance(admin);
  if (await gotoMenu(admin, M, '티샷 유의 거리 설정', { path: '홀맵 관리 > 티샷 유의 거리 설정', tcRef: '홀맵 관리_티샷 유의 거리 설정', tcId: '진입', desc: '티샷 유의 거리 설정 진입', failMsg: '메뉴 진입 불가' }))
    await runHolemapTeeshot(admin);
  if (await gotoMenu(admin, M, '홀맵 미리보기', { path: '홀맵 관리 > 홀맵 미리보기', tcRef: '홀맵 관리_홀맵 미리보기', tcId: '진입', desc: '홀맵 미리보기 진입', failMsg: '메뉴 진입 불가' }))
    await runHolemapPreview(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('holemap'); });
