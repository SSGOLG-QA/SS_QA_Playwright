import { test, expect, Page } from '@playwright/test';

// ──────────────────────────────────────────────────────────────
//  어드민 진입 연속 플로우 (로그인 + 진입을 한 창에서 끊김없이)
//
//  ⚠️ 실행: npx playwright test --project=flow --headed
//
//  STEP:
//    0) 클라우드 대시보드 진입 → 브라우저에서 직접 로그인 (수동)
//    1) 대시보드 도달 확인 (인사말 헤딩)
//    2) 스마트스코어 제공 서비스 > 서브도메인 'td17' 입력 + Enter
//    3) 경기관제 카드 > [어드민 가기] 클릭
//    4) 어드민 진입 후 화면 유지
//
//  ▸ setup/storageState 분리 없이 단일 테스트로 진행 → 로그인 후 창이
//    닫히지 않고 그대로 이어짐
// ──────────────────────────────────────────────────────────────

const DASHBOARD_URL = 'https://sv1td4.smartscore.kr/ko/dashboard';
const SUBDOMAIN = 'td17';

async function closeNoticeIfPresent(p: Page) {
  const close = p.locator('.btn-top-close');
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
  }
}

test('로그인(수동) → 대시보드 → td17 → 경기관제 [어드민 가기] → 어드민 유지', async ({ page, context }) => {
  // 수동 로그인 대기를 위한 타임아웃 연장
  test.setTimeout(300_000);

  // ──────────────────────────────────────────
  // STEP 0. 대시보드 진입 + 수동 로그인 대기
  // ──────────────────────────────────────────
  await page.goto(DASHBOARD_URL);
  console.log('\n[flow] 브라우저에서 로그인을 완료해 주세요. (최대 3분 대기)\n');

  // ──────────────────────────────────────────
  // STEP 1. 대시보드 도달 확인 (로그인 성공 지표)
  // ──────────────────────────────────────────
  await expect(page.getByRole('heading', { name: /님 안녕하세요/ }))
    .toBeVisible({ timeout: 180_000 });
  await closeNoticeIfPresent(page);

  // ──────────────────────────────────────────
  // STEP 2. 서브도메인 'td17' 입력 + Enter
  // ──────────────────────────────────────────
  const subdomainInput = page.getByPlaceholder('서브도메인 입력');
  await expect(subdomainInput).toBeVisible();
  await subdomainInput.fill(SUBDOMAIN);
  await subdomainInput.press('Enter');

  const golfCard = page.locator('.smart-admin-service').filter({ hasText: '경기관제' });
  await expect(golfCard).toBeVisible({ timeout: 10_000 });

  // ──────────────────────────────────────────
  // STEP 3. 경기관제 > [어드민 가기]
  // ──────────────────────────────────────────
  const newPagePromise = context.waitForEvent('page', { timeout: 10_000 }).catch(() => null);
  await golfCard.getByRole('button', { name: '어드민 가기' }).click();
  const newPage = await newPagePromise;
  const adminPage: Page = newPage ?? page;

  // ──────────────────────────────────────────
  // STEP 4. 어드민 진입 + 팝업 처리 + 화면 유지
  // ──────────────────────────────────────────
  // 중복 로그인 알림 → [예]
  await adminPage.addLocatorHandler(
    adminPage.getByText('로그인을 진행하시겠습니까?'),
    async () => { await adminPage.getByRole('button', { name: '예' }).click(); },
    { noWaitAfter: true, times: 3 },
  );
  // 공지 팝업 → [×]
  await adminPage.addLocatorHandler(
    adminPage.getByText('SMART CLUB ADMIN NOTICE'),
    async () => { await adminPage.locator('.btn-top-close').click(); },
    { noWaitAfter: true, times: 5 },
  );

  await adminPage.waitForLoadState('domcontentloaded', { timeout: 20_000 });

  // 어드민 진입 확인
  await expect(adminPage.locator('h2.club-name')).toBeVisible({ timeout: 20_000 });
  expect(adminPage.isClosed()).toBe(false);
  await adminPage.bringToFront();

  // ──────────────────────────────────────────
  // (선택) 화면을 닫지 않고 유지하며 확인하려면 아래 주석 해제
  //   → Playwright Inspector가 열리며 창이 유지됨
  // await adminPage.pause();
  // ──────────────────────────────────────────
});
