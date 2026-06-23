import { test, expect } from '@playwright/test';

const SS_USERNAME = process.env.SS_USERNAME ?? (() => { throw new Error('SS_USERNAME 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.'); })();
const SS_PASSWORD = process.env.SS_PASSWORD ?? (() => { throw new Error('SS_PASSWORD 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.'); })();

test.describe('TC-ADM-001: 전체 사용자 계정 진입 > HOME 전환', () => {

  test.beforeEach(async ({ page }) => {
    // 사전 조건: 로그인 완료 상태 진입
    await page.goto('https://td1.smartscore.kr/ss/admin/login.html');

    // 클라우드 전환 공지 모달 닫기 (간헐 노출)
    const cloudModal = page.locator('.ss-close-btn');
    if (await cloudModal.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cloudModal.click();
    }

    await page.getByPlaceholder('ID').fill(SS_USERNAME);
    await page.getByPlaceholder('Password').fill(SS_PASSWORD);
    await page.getByRole('button', { name: '로그인' }).click();
    await page.waitForURL('**/admin/**');

    // 헤더 클럽명으로 로그인 완료 확인
    await expect(page.getByRole('heading', { name: '밀양 에스파크' })).toBeVisible();
  });

  test('STEP 1-2: 계정 권한 관리 > 전체 사용자 계정 진입', async ({ page }) => {
    // ── STEP 1. GNB 1depth 클릭 → 서브메뉴 펼침 ──────────────────
    const parentMenu = page.getByRole('link', { name: '계정 권한 관리' });
    await parentMenu.click();

    // 서브메뉴 2개 링크 노출 확인
    await expect(page.getByRole('link', { name: '전체 사용자 계정' })).toBeVisible();
    await expect(page.getByRole('link', { name: '전체 권한 그룹' })).toBeVisible();

    // ── STEP 2. 서브메뉴 클릭 → 페이지 이동 ─────────────────────
    await page.getByRole('link', { name: '전체 사용자 계정' }).click();
    await page.waitForURL('**/account.html');

    // URL 검증
    await expect(page).toHaveURL(/\/ss\/admin\/account\.html$/);

    // 페이지 헤딩 확인
    await expect(page.getByRole('heading', { name: '전체사용자계정' })).toBeVisible();

    // GNB active 상태 확인 — li.left_menu.active
    const activeNavItem = page.locator('nav li.left_menu.active');
    await expect(activeNavItem).toContainText('전체 사용자 계정');
  });

  test('STEP 3: 사용자 계정 페이지 콘텐츠 검증', async ({ page }) => {
    await page.goto('https://td1.smartscore.kr/ss/admin/account.html');
    await expect(page.getByRole('heading', { name: '전체사용자계정' })).toBeVisible();

    // ── 검색 폼 영역 ─────────────────────────────────────────────
    // 계정 상태 셀렉트 (기본값: 기본/LIVE)
    const statusSelect = page.locator('#SEL_pending');
    await expect(statusSelect).toBeVisible();
    await expect(statusSelect).toHaveValue('LIVE');

    // 권한 그룹 셀렉트 (기본값: 전체/ALL)
    const groupSelect = page.locator('#SEL_grp_idx');
    await expect(groupSelect).toBeVisible();
    await expect(groupSelect).toHaveValue('ALL');

    // 그룹 옵션 수 확인 (전체 포함 9개)
    await expect(groupSelect.locator('option')).toHaveCount(9);

    // 검색어 입력창
    await expect(page.locator('#INPUT_searchKey')).toBeVisible();

    // 검색 / 권한변경 버튼
    await expect(page.locator('a.bt01')).toContainText('검색');
    await expect(page.getByRole('link', { name: '권한변경' })).toBeVisible();

    // ── 테이블 헤더 검증 ──────────────────────────────────────────
    const table = page.locator('table').first();
    await expect(table).toBeVisible();

    const expectedHeaders = ['No.', '계정 상태', '부서', '이름', 'ID', '연락처', '계정상태변경', '권한', '패스워드변경', '로그아웃'];
    for (const header of expectedHeaders) {
      await expect(table.getByText(header, { exact: true })).toBeVisible();
    }

    // 1건 이상 데이터 존재 확인
    const dataRows = table.locator('tbody tr, tr:not(:first-child)');
    await expect(dataRows).not.toHaveCount(0);
  });

  test('STEP 4: HOME 메뉴 클릭 → 대시보드 전환', async ({ page }) => {
    // 전체 사용자 계정 페이지에서 시작
    await page.goto('https://td1.smartscore.kr/ss/admin/account.html');
    await expect(page.getByRole('heading', { name: '전체사용자계정' })).toBeVisible();

    // ── STEP 4. HOME 클릭 ─────────────────────────────────────────
    await page.getByRole('link', { name: 'HOME' }).click();
    await page.waitForURL('**/index.html');

    // URL 검증
    await expect(page).toHaveURL(/\/ss\/admin\/index\.html$/);

    // 헤더 클럽명 유지 확인
    await expect(page.getByRole('heading', { name: '밀양 에스파크' })).toBeVisible();

    // 대시보드 콘텐츠: 서비스 상태 문구
    await expect(page.getByText('스마트스코어 서비스가 제공중입니다')).toBeVisible();

    // 내장현황 탭 활성 상태
    await expect(page.locator('.tab01 a.active')).toContainText('내장현황');

    // SS 회원 현황 테이블 노출
    const dashboardTable = page.locator('table.table01');
    await expect(dashboardTable).toBeVisible();
    await expect(dashboardTable.getByText('날짜')).toBeVisible();
    await expect(dashboardTable.getByText('SS회원 비율')).toBeVisible();

    // HOME 메뉴 li에 active 클래스 없음 확인 (별도 active 없음)
    // 전체 사용자 계정 active 해제 확인
    await expect(page.locator('nav li.left_menu.active')).toHaveCount(0);
  });

  test('FULL FLOW: 전체 시나리오 통합 검증', async ({ page }) => {
    // STEP 1: 계정 권한 관리 클릭
    await page.getByRole('link', { name: '계정 권한 관리' }).click();
    await expect(page.getByRole('link', { name: '전체 사용자 계정' })).toBeVisible();

    // STEP 2: 전체 사용자 계정 클릭
    await page.getByRole('link', { name: '전체 사용자 계정' }).click();
    await page.waitForURL('**/account.html');
    await expect(page.getByRole('heading', { name: '전체사용자계정' })).toBeVisible();
    await expect(page.locator('nav li.left_menu.active')).toContainText('전체 사용자 계정');

    // STEP 3: 콘텐츠 확인
    await expect(page.locator('#SEL_pending')).toHaveValue('LIVE');
    await expect(page.locator('#SEL_grp_idx')).toHaveValue('ALL');
    await expect(page.locator('table').first()).toBeVisible();

    // STEP 4: HOME 전환
    await page.getByRole('link', { name: 'HOME' }).click();
    await page.waitForURL('**/index.html');
    await expect(page.locator('.tab01 a.active')).toContainText('내장현황');
    await expect(page.locator('table.table01')).toBeVisible();
    await expect(page.locator('nav li.left_menu.active')).toHaveCount(0);
  });
});