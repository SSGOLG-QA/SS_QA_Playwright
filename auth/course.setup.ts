import { test, expect } from '@playwright/test';
import { COURSE_STORAGE, COURSE_URL, DASHBOARD_URL, killAlarms } from '../lib/course/courseHelpers';

// ──────────────────────────────────────────────────────────────
//  코스관리 인증 세션 생성 (headed 수동 로그인)
//  - 실행: npm run course:auth
//  - 클라우드 대시보드(sv1td4) 수동 로그인 → 코스관리 카드 [바로가기] → course-mng-td 진입
//    → storageState 를 auth/.auth/course.json 으로 저장(공유 `.smartscore.kr` 쿠키 포함).
//  - ⚠ 세션은 재로그인 1회당 1런만 생존(공유 QA 계정) → 필요할 때마다 재실행.
// ──────────────────────────────────────────────────────────────

test('코스관리 인증 세션 생성 (수동 로그인)', async ({ page, context }) => {
  test.setTimeout(360_000);

  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  console.log('\n[course:auth] 브라우저에서 클라우드 대시보드에 수동 로그인하세요 (최대 5분 대기)...\n');

  // 로그인 감지: /dashboard + 인사말 노출 (헤딩 role 이 아닌 텍스트로 견고하게)
  await expect
    .poll(async () =>
      /\/dashboard/.test(page.url()) &&
      (await page.getByText('님 안녕하세요', { exact: false }).first().isVisible().catch(() => false)),
    { timeout: 300_000, intervals: [1500, 2000, 3000] })
    .toBeTruthy();
  console.log('[course:auth] 로그인 감지됨.');

  // 코스관리 카드 → [바로가기] (새 탭)
  const card = page.locator('.smart-admin-service').filter({ hasText: '코스관리' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  let course = page;
  const [np] = await Promise.all([
    context.waitForEvent('page', { timeout: 15_000 }).catch(() => null),
    card.getByRole('button', { name: /바로가기|가기/ }).first().click({ timeout: 15_000 }).catch(() => {}),
  ]);
  if (np) course = np;
  await course.waitForLoadState('domcontentloaded').catch(() => {});
  await course.waitForTimeout(3_000);
  await killAlarms(course);
  console.log('[course:auth] 코스관리 탭 초기 URL:', course.url());

  // 진입 검증(견고화): SSO 핸드오프가 실패해 새 탭이 클라우드 로그인으로 튕기는 경우가 있음
  //   → course-mng 도달 + SNB 노출을 최대 4분 폴링(그 사이 새 탭에서 수동 로그인 완료 허용).
  console.log('[course:auth] 코스관리 탭에서 로그인 페이지가 뜨면 동일 계정으로 로그인하세요 (최대 4분 대기)...');
  await expect
    .poll(async () => {
      await killAlarms(course).catch(() => {});
      const onCourse = /course-mng/.test(course.url());
      const snb = await course.locator('.side-navbar-container .depth-1-title').first()
        .isVisible().catch(() => false);
      return onCourse && snb;
    }, { timeout: 240_000, intervals: [2000, 3000, 4000] })
    .toBeTruthy();
  console.log('[course:auth] 코스관리 진입 확정 URL:', course.url());

  await context.storageState({ path: COURSE_STORAGE });
  console.log(`[course:auth] 세션 저장 완료 → ${COURSE_STORAGE}`);
});
