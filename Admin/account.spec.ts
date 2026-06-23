import { test } from '../lib/fixtures';
import { runAccountList, runAccountPermission, runAccountAdminList } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 계정 관리 3종 (계정 리스트/계정 권한 관리/계정 관리인 리스트) - 구조 기반
//   ⚠ 권한변경/패스워드 변경/로그아웃/권한 그룹 추가·복사/수정/삭제/권한 적용은 비파괴(노출만)
//   ✨2026-06-22: 계정 관리인 리스트 추가 — 현재 SNB 미구현(noTC 추적). TC 작성 진행중(강나연).
// 실행: npx playwright test --project=admin-chromium Admin/account.spec.ts --no-deps
test('계정 관리 3종 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(270_000);
  resetResults(); resetNoTC(); resetDiff();
  const M = '계정 관리';
  if (await gotoMenu(admin, M, '계정 리스트', { path: '계정 관리 > 계정 리스트', tcRef: '계정 관리_계정 리스트', tcId: '진입', desc: '계정 리스트 진입', failMsg: '메뉴 진입 불가' }))
    await runAccountList(admin);
  if (await gotoMenu(admin, M, '계정 권한 관리', { path: '계정 관리 > 계정 권한 관리', tcRef: '계정 관리_계정 권한 관리', tcId: '진입', desc: '계정 권한 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runAccountPermission(admin);
  // 계정 관리인 리스트: SNB 미구현(미노출) — gotoMenu 진입 실패 시 noTC 기록으로 처리
  await gotoMenu(admin, M, '계정 관리인 리스트', { path: '계정 관리 > 계정 관리인 리스트', tcRef: '계정 관리_계정 관리인 리스트', tcId: '진입', desc: '계정 관리인 리스트 진입', failMsg: 'SNB 미구현(미노출)' });
  await runAccountAdminList(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('account'); });
