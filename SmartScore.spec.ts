import { test, expect, type Page } from '@playwright/test';

// ============================================================
//  공통 헬퍼
// ============================================================

/**
 * 로그인 알림 팝업 핸들러 등록 (page.addLocatorHandler)
 *
 * ▸ 기존 방식(waitFor + catch)의 문제:
 *     특정 호출 시점에만 체크 → waitForURL 대기 중 팝업이 뜨면 감지 불가
 *
 * ▸ 새 방식(addLocatorHandler):
 *     테스트 실행 전체 구간에서 팝업을 감시
 *     → 어느 시점에 발생해도 즉시 [예] 클릭 후 테스트 재개
 *
 * 팝업 DOM 구조 (Urban.js 동적 생성):
 *   #__urban_dialog_layer__
 *     └── #Notice-popup
 *           ├── .dlg-tit       "로그인 알림"
 *           └── .popupbtn
 *                 ├── a.dlg-ok-btn   [예]   ← 클릭 대상
 *                 └── a.dlg-no-btn   [아니요]
 */
async function registerLoginAlertHandler(page: Page): Promise<void> {
  await page.addLocatorHandler(
    // 감지 트리거: 팝업 타이틀 "로그인 알림" 노출 시
    page.locator('.dlg-tit').filter({ hasText: '로그인 알림' }),
    async () => {
      // [예] 버튼 클릭 — a.dlg-ok-btn (Urban.js 구조)
      await page.locator('.dlg-ok-btn').click();
    },
    { noWaitAfter: true, times: 5 },  // 최대 5회까지 자동 처리
  );
}

/**
 * MNG 도메인 로그인
 * ⚠️ honeypot 필드(fakeid/fakepass) 존재 → placeholder 기반 타겟팅
 */
async function loginToMng(page: Page): Promise<void> {
  // 팝업 핸들러를 로그인 전에 등록 (어느 시점이든 감지)
  await registerLoginAlertHandler(page);

  const response = await page.goto('https://td1.smartscore.kr/ss/mng/login.html');

  // ⚠️ 서버 오류(502 등) 시 test.skip — 테스트 코드 버그와 환경 장애를 분리
  const status = response?.status() ?? 0;
  if (status !== 200) {
    test.skip(true, `서버 응답 불가 (HTTP ${status}) — 테스트 환경(td1) 상태를 확인하세요`);
    return;
  }

  await expect(page.getByRole('heading', { name: '로그인이 필요합니다.' })).toBeVisible();

  await page.getByPlaceholder('ID').fill('shin02160');
  await page.getByPlaceholder('Password').fill('Jys0918S!');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL('**/index.html');
}

/**
 * Admin 도메인 로그인
 * 클라우드 전환 공지 모달이 간헐 노출되므로 사전 dismiss 처리
 */
async function loginToAdmin(page: Page): Promise<void> {
  // 팝업 핸들러를 로그인 전에 등록 (어느 시점이든 감지)
  await registerLoginAlertHandler(page);

  const response = await page.goto('https://td1.smartscore.kr/ss/admin/login.html');

  // ⚠️ 서버 오류(502 등) 시 test.skip — 테스트 코드 버그와 환경 장애를 분리
  const status = response?.status() ?? 0;
  if (status !== 200) {
    test.skip(true, `서버 응답 불가 (HTTP ${status}) — 테스트 환경(td1) 상태를 확인하세요`);
    return;
  }

  const cloudModal = page.locator('.ss-close-btn');
  if (await cloudModal.isVisible({ timeout: 3000 }).catch(() => false)) {
    await cloudModal.click();
  }

  await page.getByPlaceholder('ID').fill('shin02160');
  await page.getByPlaceholder('Password').fill('Jys0918S!');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL('**/admin/**');
  await expect(page.getByRole('heading', { name: '밀양 에스파크' })).toBeVisible();
}

// ============================================================
//  시나리오 1: SmartScore 클럽 로그인 (MNG)
// ============================================================

test.describe('시나리오 1: SmartScore 클럽 로그인', () => {

  // 서버 세션 정리: 반복 실행 시 세션 누적 방지
  test.afterEach(async ({ page }) => {
    await page.goto('https://td1.smartscore.kr/ss/mng/login.html?act=logout')
      .catch(() => {});
  });

  test('TC-MNG-001: 사이트 접속 > 로그인 > 클럽 선택 > 클럽 로그인', async ({ page }) => {

    // ── STEP 1. 사이트 접속 + 로그인 ─────────────────────────
    await loginToMng(page);

    // ── STEP 2. 클럽관리 > 클럽 로그인 메뉴 진입 ──────────────
    const clubLoginLink = page.getByRole('link', { name: '클럽 로그인' });
    if (!await clubLoginLink.isVisible()) {
      await page.getByRole('link', { name: '클럽관리' }).click();
    }
    await clubLoginLink.click();
    await page.waitForURL('**/club.html?act=login');

    // ── STEP 3. 클럽 선택 (Select2 드롭다운) ─────────────────
    await page.locator('.select2-container').first()
      .locator('.select2-selection--single').click();
    await page.locator('.select2-search__field').waitFor({ state: 'visible' });
    await page.locator('.select2-search__field').pressSequentially('에스', { delay: 50 });
    await page.waitForSelector('.select2-results__option', { state: 'visible' });
    await page.locator('.select2-results__option', { hasText: '밀양 에스파크 (29014)' }).click();
    await expect(page.locator('.select2-container').first()).toContainText('밀양 에스파크 (29014)');

    // ── STEP 4. 본인 암호 입력 및 클럽 로그인 ────────────────
    await page.locator('input[name="ss_pass"]').click();
    await page.locator('input[name="ss_pass"]').fill('Jys0918S!');
    // ⚠️ <div class="btn bt-st02"> — <button> 아님 → getByRole('button') 불가
    await page.locator('div.btn.bt-st02').first().click();
    await page.waitForTimeout(2000);
  });
});

// ============================================================
//  시나리오 2: Admin 메뉴 탐색 (TC-ADM-001)
// ============================================================

test.describe('TC-ADM-001: 전체 사용자 계정 진입 > HOME 전환', () => {

  test.beforeEach(async ({ page }) => {
    await loginToAdmin(page);
  });

  // 서버 세션 정리: 반복 실행 시 세션 누적 방지
  test.afterEach(async ({ page }) => {
    await page.goto('https://td1.smartscore.kr/ss/admin/login.html?act=logout')
      .catch(() => {});
  });

  // ── STEP 1-2 ────────────────────────────────────────────────

  test('STEP 1-2: 계정 권한 관리 > 전체 사용자 계정 진입', async ({ page }) => {
    await page.getByRole('link', { name: '계정 권한 관리' }).click();
    await expect(page.getByRole('link', { name: '전체 사용자 계정' })).toBeVisible();
    await expect(page.getByRole('link', { name: '전체 권한 그룹' })).toBeVisible();

    await page.getByRole('link', { name: '전체 사용자 계정' }).click();
    await page.waitForURL('**/account.html');

    await expect(page).toHaveURL(/\/ss\/admin\/account\.html$/);
    await expect(page.getByRole('heading', { name: '전체사용자계정' })).toBeVisible();
    await expect(page.locator('nav li.left_menu.active')).toContainText('전체 사용자 계정');
  });

  // ── STEP 3 ──────────────────────────────────────────────────

  test('STEP 3: 사용자 계정 페이지 콘텐츠 검증', async ({ page }) => {
    await page.goto('https://td1.smartscore.kr/ss/admin/account.html');
    await expect(page.getByRole('heading', { name: '전체사용자계정' })).toBeVisible();

    const statusSelect = page.locator('#SEL_pending');
    await expect(statusSelect).toBeVisible();
    await expect(statusSelect).toHaveValue('LIVE');

    const groupSelect = page.locator('#SEL_grp_idx');
    await expect(groupSelect).toBeVisible();
    await expect(groupSelect).toHaveValue('ALL');
    await expect(groupSelect.locator('option')).toHaveCount(9);

    await expect(page.locator('#INPUT_searchKey')).toBeVisible();
    await expect(page.locator('a.bt01')).toContainText('검색');
    await expect(page.getByRole('link', { name: '권한변경' })).toBeVisible();

    const table = page.locator('table').first();
    await expect(table).toBeVisible();

    const expectedHeaders = [
      'No.', '계정 상태', '부서', '이름', 'ID',
      '연락처', '계정상태변경', '권한', '패스워드변경', '로그아웃',
    ];
    for (const header of expectedHeaders) {
      await expect(table.getByText(header, { exact: true })).toBeVisible();
    }
    await expect(table.locator('tbody tr')).not.toHaveCount(0);
  });

  // ── STEP 4 ──────────────────────────────────────────────────

  test('STEP 4: HOME 메뉴 클릭 → 대시보드 전환', async ({ page }) => {
    await page.goto('https://td1.smartscore.kr/ss/admin/account.html');
    await expect(page.getByRole('heading', { name: '전체사용자계정' })).toBeVisible();

    await page.getByRole('link', { name: 'HOME' }).click();
    await page.waitForURL('**/index.html');

    await expect(page).toHaveURL(/\/ss\/admin\/index\.html$/);
    await expect(page.getByRole('heading', { name: '밀양 에스파크' })).toBeVisible();
    await expect(page.getByText('스마트스코어 서비스가 제공중입니다')).toBeVisible();
    await expect(page.locator('.tab01 a.active')).toContainText('내장현황');

    const dashboardTable = page.locator('table.table01');
    await expect(dashboardTable).toBeVisible();
    await expect(dashboardTable.getByText('날짜')).toBeVisible();
    await expect(dashboardTable.getByText('SS회원 비율')).toBeVisible();
    await expect(page.locator('nav li.left_menu.active')).toHaveCount(0);
  });

  // ── FULL FLOW ────────────────────────────────────────────────

  test('FULL FLOW: 전체 시나리오 통합 검증', async ({ page }) => {
    await page.getByRole('link', { name: '계정 권한 관리' }).click();
    await expect(page.getByRole('link', { name: '전체 사용자 계정' })).toBeVisible();

    await page.getByRole('link', { name: '전체 사용자 계정' }).click();
    await page.waitForURL('**/account.html');
    await expect(page.getByRole('heading', { name: '전체사용자계정' })).toBeVisible();
    await expect(page.locator('nav li.left_menu.active')).toContainText('전체 사용자 계정');

    await expect(page.locator('#SEL_pending')).toHaveValue('LIVE');
    await expect(page.locator('#SEL_grp_idx')).toHaveValue('ALL');
    await expect(page.locator('table').first()).toBeVisible();

    await page.getByRole('link', { name: 'HOME' }).click();
    await page.waitForURL('**/index.html');
    await expect(page.locator('.tab01 a.active')).toContainText('내장현황');
    await expect(page.locator('table.table01')).toBeVisible();
    await expect(page.locator('nav li.left_menu.active')).toHaveCount(0);
  });
});
