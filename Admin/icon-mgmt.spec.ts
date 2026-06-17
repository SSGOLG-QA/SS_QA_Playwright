import { test } from '../lib/fixtures';
import { runIconMgmt } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 관제관리 > 아이콘 관리 - 구조 기반 전수 검증 (드라이브 상세 TC 미작성 → 카트관리와 동일 방식)
//   IA: 아이콘 관리 → 라이브관리와 통합·이동 (범위 포함)
//   ⚠ [관제적용]/[저장]/[변경]/카드[✕]는 비파괴(노출·활성만 검증)
// 실행: npx playwright test --project=admin-chromium Admin/icon-mgmt.spec.ts --no-deps
test('관제관리 > 아이콘 관리 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '관제관리', '아이콘 관리', { path: '관제관리 > 아이콘 관리', tcRef: '아이콘관리', tcId: '진입', desc: '아이콘 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runIconMgmt(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('icon-mgmt'); });
