import { test as setup, expect, Page } from '@playwright/test';
import { STORAGE_STATE } from '../playwright.config';
import fs from 'fs';
import path from 'path';

// ──────────────────────────────────────────────────────────────
//  인증 세션(storageState) 생성 — td17 어드민까지 진입 후 저장
//
//  ⚠️ 실행 방법 (최초 1회, 반드시 headed):
//      npx playwright test --project=setup --headed
//
//  흐름:
//    1) 클라우드 대시보드 진입 → 브라우저에서 직접 로그인 (수동)
//    2) 서브도메인 'td17' 입력 + Enter
//    3) 경기관제 [어드민 가기] → td17 어드민 진입
//    4) 어드민 홈 도달 후 세션 저장 (클라우드 + td17 쿠키 모두 포함)
//
//  ▸ 이렇게 저장하면 이후 테스트가 /club/page/* 로 직접 이동 가능
// ──────────────────────────────────────────────────────────────

const DASHBOARD_URL = 'https://sv1td4.smartscore.kr/ko/dashboard';
const SUBDOMAIN = 'td17';

async function closeNoticeIfPresent(p: Page) {
  const close = p.locator('.btn-top-close');
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
}

setup('authenticate', async ({ page, context }) => {
  setup.setTimeout(300_000);

  const dir = path.dirname(STORAGE_STATE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // ── STEP 1. 대시보드 진입 + 수동 로그인 ──────────────
  await page.goto(DASHBOARD_URL);

  // 중복 로그인 처리(이전 세션 종료) — 대시보드 단계에 핸들러 선등록:
  //  ① 로그인 진행 확인 프롬프트("…로그인을 진행하시겠습니까?")가 뜨면 [예] →
  //     앱이 제공하는 방식으로 기존(이전) 세션을 종료하고 우리 세션으로 진행한다.
  //  ② 이미 '강제 로그아웃' 알림이 떠 있으면 [확인]으로 닫아 대시보드를 재로그인 가능 상태로 복구
  //     (아래 헤딩 대기 180초가 수동 재로그인을 그대로 흡수).
  //  ⚠ 서버측 동시 세션 한도(2개)는 클라이언트가 임의 해제 불가 → '진행 확인 수락'으로만 이전 세션 종료 가능.
  await page.addLocatorHandler(
    page.getByText('로그인을 진행하시겠습니까?'),
    async () => { await page.getByRole('button', { name: '예' }).first().click().catch(() => {}); },
    { noWaitAfter: true, times: 5 },
  );
  await page.addLocatorHandler(
    page.getByText(/중복\s*로그인|강제 로그아웃/),
    async () => {
      const ok = page.getByRole('button', { name: '확인', exact: true });
      if (await ok.first().isVisible().catch(() => false)) await ok.first().click().catch(() => {});
      console.log('\n[auth.setup] ⚠ 중복 로그인으로 강제 로그아웃됨 — 알림을 닫았습니다. 열린 브라우저에서 다시 로그인해 주세요. (대기 계속)\n');
    },
    { noWaitAfter: true, times: 5 },
  );

  console.log('\n[auth.setup] 브라우저에서 로그인을 완료해 주세요. (최대 3분 대기)\n');
  await expect(page.getByRole('heading', { name: /님 안녕하세요/ }))
    .toBeVisible({ timeout: 180_000 });
  await closeNoticeIfPresent(page);

  // ── STEP 2. 서브도메인 td17 입력 + Enter ─────────────
  const subdomainInput = page.getByPlaceholder('서브도메인 입력');
  await subdomainInput.fill(SUBDOMAIN);
  await subdomainInput.press('Enter');
  const golfCard = page.locator('.smart-admin-service').filter({ hasText: '경기관제' });
  await expect(golfCard).toBeVisible({ timeout: 10_000 });

  // ── STEP 3. 경기관제 [어드민 가기] → 어드민 진입 ──────
  const newPagePromise = context.waitForEvent('page', { timeout: 15_000 }).catch(() => null);
  await golfCard.getByRole('button', { name: '어드민 가기' }).click();
  const newPage = await newPagePromise;
  const adminPage: Page = newPage ?? page;

  // 어드민 진입 시 팝업 처리
  await adminPage.addLocatorHandler(
    adminPage.getByText('로그인을 진행하시겠습니까?'),
    async () => { await adminPage.getByRole('button', { name: '예' }).click(); },
    { noWaitAfter: true, times: 3 },
  );
  await adminPage.addLocatorHandler(
    adminPage.getByText('SMART CLUB ADMIN NOTICE'),
    async () => { await adminPage.locator('.btn-top-close').click(); },
    { noWaitAfter: true, times: 5 },
  );

  // ── STEP 4. 어드민 홈 도달 확인 후 세션 저장 ──────────
  //   헤더 타이틀 텍스트(td17 리뉴얼로 변동 가능)에 의존하지 않고
  //   "어드민 URL(/club/) + SNB(대메뉴) 노출"을 도달 신호로 사용 (세션 캡처용 게이트)
  await adminPage.waitForLoadState('domcontentloaded', { timeout: 20_000 });
  await expect(adminPage).toHaveURL(/\/club\//, { timeout: 20_000 });
  await expect(adminPage.locator('.depth-1-title').first()).toBeVisible({ timeout: 20_000 });
  const h1Text = await adminPage.locator('h1').first().innerText().catch(() => '(h1 없음)');
  console.log(`\n[auth.setup] 어드민 진입: ${adminPage.url()}  | h1="${h1Text}"\n`);

  await context.storageState({ path: STORAGE_STATE });
  console.log(`\n[auth.setup] 세션 저장 완료 → ${STORAGE_STATE}\n`);
});
