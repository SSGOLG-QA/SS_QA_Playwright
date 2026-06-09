import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { runAccountList, runAccountPermission } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 계정 관리 2종 (계정 리스트/계정 권한 관리) - 구조 기반
//   ⚠ 권한변경/패스워드 변경/로그아웃/권한 그룹 추가·복사/수정/삭제/권한 적용은 비파괴(노출만)
// 실행: npx playwright test --project=admin-chromium Admin/account.spec.ts --no-deps
test('계정 관리 2종 검증 (구조 기반)', async ({ page, context }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff();
  const admin = await openAdmin(page, context);
  const M = '계정 관리';
  if (await gotoMenu(admin, M, '계정 리스트', { path: '계정 관리 > 계정 리스트', tcRef: '계정 관리_계정 리스트', tcId: '진입', desc: '계정 리스트 진입', failMsg: '메뉴 진입 불가' }))
    await runAccountList(admin);
  if (await gotoMenu(admin, M, '계정 권한 관리', { path: '계정 관리 > 계정 권한 관리', tcRef: '계정 관리_계정 권한 관리', tcId: '진입', desc: '계정 권한 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runAccountPermission(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('account'); });
