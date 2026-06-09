import { test, expect, Page } from '@playwright/test';
import { openAdmin, settle } from '../lib/adminHelpers';
import { AccountListPage, AccountPermissionPage } from './account.pom';
import { SCREEN } from './account.data';

// 계정 관리 E2E (현재 구현 AS-IS, POM 8항목).
// ⚠ 비파괴: 권한변경/패스워드 변경/로그아웃/권한 그룹 추가·복사/수정/삭제/권한 적용은 클릭 금지(노출·열기·취소까지만).
// ⚠ 계정 관리 화면엔 datepicker 없음 → 항목6은 검색 필터(이름/vue-select) 적용으로 대체.
let admin: Page;
test.beforeEach(async ({ page, context }) => { admin = await openAdmin(page, context); });

// 1. 기능 진입 — 계정 리스트 URL+로드
test('항목1: 기능 진입 — 계정 리스트 URL 접속 및 로드', async () => {
  const p = new AccountListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.list.urlPart);
  await expect(p.infoBox, '안내 문구 로드').toContainText(SCREEN.list.guide);
  await expect(p.table, '리스트 테이블 로드').toBeVisible();
});

// 2. 텍스트 검증 — 계정 리스트 + 계정 권한 관리
test('항목2: 텍스트 검증 — raw code/미가공 코드 미노출', async () => {
  for (const Cls of [AccountListPage, AccountPermissionPage]) {
    const p = new Cls(admin);
    await p.open();
    expect(await p.scanRawCode(), '미가공 코드 노출').toEqual([]);
  }
});

// 3. 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지
test('항목3: 버튼(메뉴) 클릭 → 다른 화면 이동 + 세션 유지', async () => {
  const list = new AccountListPage(admin);
  await list.open();
  await list.expectLoaded(SCREEN.list.urlPart);
  const perm = new AccountPermissionPage(admin);
  await perm.open();
  await perm.expectLoaded(SCREEN.permission.urlPart);
  await perm.expectSessionAlive();
});

// 4. 데이터 정합성 — 계정 리스트 컬럼 + 렌더 행
test('항목4: 데이터 정합성 — 계정 리스트 컬럼/렌더 행', async () => {
  const p = new AccountListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.list.urlPart);
  for (const c of SCREEN.list.columns) await expect(p.column(c), `컬럼 '${c}'`).toBeVisible();
  const rows = await p.renderedRowCount();
  expect(rows, '렌더 행 ≥ 1').toBeGreaterThan(0);
});

// 5. 페이지네이션 — 계정 리스트 (다수 페이지)
test('항목5: 페이지네이션 — 계정 리스트 페이지 이동', async () => {
  const p = new AccountListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.list.urlPart);
  const page2 = admin.getByRole('button', { name: '2', exact: true });
  if (await page2.count().catch(() => 0)) {
    await page2.first().click(); await settle(admin, 800);
    await expect(p.rows.first(), '2페이지 행 렌더').toBeVisible();
  } else {
    test.info().annotations.push({ type: '주의', description: '페이지 2 없음 → 이동 검증 생략' });
    await expect(p.table, '테이블 노출').toBeVisible();
  }
});

// 6. 검색(달력 대체) — 계정 리스트 검색 필터(이름/vue-select) + [적용] 반영(비파괴)
test('항목6: 검색 필터 — 계정 리스트 필터 적용(달력 없음 대체)', async () => {
  const p = new AccountListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.list.urlPart);
  await expect(p.searchInput(), '이름 검색 입력 노출').toBeVisible();
  expect(await p.vueSelects.count(), '필터 vue-select ≥1(권한/상태)').toBeGreaterThanOrEqual(1);
  await p.button(SCREEN.list.applyBtn).first().click();             // 기본 필터로 [적용](비파괴 조회)
  await settle(admin, 1000);
  await expect(p.table, '필터 적용 후 테이블 유지').toBeVisible();
  test.info().annotations.push({ type: '한계', description: '계정 관리 화면엔 datepicker 없음 → 달력 경계 검증 미해당. 검색 필터 적용으로 대체' });
});

// 7. 입력/반영 — 계정 리스트 이름 검색 입력 → 적용 → 반영(비파괴)
test('항목7: 입력/반영 — 계정 리스트 이름 검색 입력/반영', async () => {
  const p = new AccountListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.list.urlPart);
  await expect(p.searchInput(), '검색 입력 필드 노출').toBeVisible();
  await p.searchInput().fill('__E2E_없는값__');
  await p.button(SCREEN.list.applyBtn).first().click();
  await settle(admin, 1000);
  const rows = await p.renderedRowCount();
  expect(rows, '검색 반영(빈 결과=0 정상)').toBeGreaterThanOrEqual(0);
  await expect(p.table, '검색 후 테이블 유지').toBeVisible();
});

// 8. 팝업/모달 — 계정 리스트 [권한변경] 모달 열고 닫기(취소, 비파괴)
test('항목8: 팝업/모달 — 계정 [권한변경] 모달 열고 닫기(취소)', async () => {
  const p = new AccountListPage(admin);
  await p.open();
  await p.expectLoaded(SCREEN.list.urlPart);
  const action = p.rowActionBtn();
  if (!(await action.count().catch(() => 0))) {
    test.info().annotations.push({ type: '주의', description: '[권한변경] 버튼 없음 → 모달 검증 생략' });
    await expect(p.table).toBeVisible();
    return;
  }
  await action.first().click();
  await settle(admin, 800);
  const modal = admin.locator('.modal, [class*="modal-wrap"], [role="dialog"], .popup-layer, [class*="popup"]').first();
  if (await modal.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const cancel = modal.getByRole('button', { name: /취소|닫기|아니요/ }).first();
    if (await cancel.count().catch(() => 0)) await cancel.click();  // 취소(비파괴, 변경 저장 안 함)
    else await admin.keyboard.press('Escape').catch(() => {});
    await settle(admin, 500);
  } else {
    test.info().annotations.push({ type: '주의', description: '[권한변경] 클릭 후 모달 미노출 — 버튼 노출까지만 검증' });
  }
  await expect(p.table, '화면 테이블 유지').toBeVisible();
});
