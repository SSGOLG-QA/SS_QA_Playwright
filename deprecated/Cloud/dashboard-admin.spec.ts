import { test, expect } from '@playwright/test';

const SS_USERNAME = process.env.SS_USERNAME ?? (() => { throw new Error('SS_USERNAME 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.'); })();
const SS_PASSWORD = process.env.SS_PASSWORD ?? (() => { throw new Error('SS_PASSWORD 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.'); })();

// ──────────────────────────────────────────────────────────────
//  TC-CLOUD-002: 대시보드 > 경기관제 어드민 가기
//  대상: https://sv1td4.smartscore.kr/ko/dashboard
//
//  시나리오:
//    로그인 → 대시보드 → 경기관제 카드 [어드민 가기] 클릭
//    → 어드민 새 탭 오픈
//    → [로그인 알림] 팝업 노출 시 [예] 클릭 (중복 세션 시 간헐적)
//    → [SMART CLUB ADMIN NOTICE] 공지 팝업 노출 시 [×] 클릭
//    → 어드민 홈 화면 유지 확인
//
//  [진단 결론]
//    window.close()는 호출되지 않음.
//    이전 close 이벤트는 test 종료 시 context 자동 정리로 인한 것(정상).
//    [어드민 가기]는 단일 탭으로 어드민에 직접 진입.
// ──────────────────────────────────────────────────────────────

test('TC-CLOUD-002: 대시보드 > 경기관제 [어드민 가기] → 어드민 홈 진입', async ({ page, context }) => {

  // ──────────────────────────────────────────
  // STEP 1. 로그인 페이지 접속
  // ──────────────────────────────────────────
  await page.goto('https://sv1td4.smartscore.kr/ko/login');
  await expect(page).toHaveTitle('클라우드');

  // ──────────────────────────────────────────
  // STEP 2. 클럽 검색 및 선택 ('킹즈락')
  // ──────────────────────────────────────────
  const clubSearchInput = page.getByRole('searchbox');
  await clubSearchInput.click();
  await clubSearchInput.pressSequentially('킹즈락', { delay: 50 });

  const clubOption = page.locator('.select-group-dropdown li', { hasText: '킹즈락' });
  await expect(clubOption).toBeVisible({ timeout: 5000 });
  await clubOption.click();

  // ──────────────────────────────────────────
  // STEP 3. 아이디 / 비밀번호 입력
  // ──────────────────────────────────────────
  await page.getByPlaceholder('아이디를 입력해주세요').fill(SS_USERNAME);
  await page.getByPlaceholder('비밀번호를 입력해주세요').fill(SS_PASSWORD);

  // ──────────────────────────────────────────
  // STEP 4. 중복 로그인 팝업 핸들러 등록 (cloud 로그인 화면)
  // ──────────────────────────────────────────
  await page.addLocatorHandler(
    page.locator('.modal-group').filter({ hasText: '로그인을 진행하시겠습니까?' }),
    async () => {
      await page.locator('.modal-group')
        .getByRole('button', { name: '확인' })
        .click();
    },
    { noWaitAfter: true, times: 3 },
  );

  // ──────────────────────────────────────────
  // STEP 5. 로그인 버튼 클릭 & 대시보드 진입 확인
  // ──────────────────────────────────────────
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

  // ──────────────────────────────────────────
  // STEP 6. 대시보드 로드 확인
  // ──────────────────────────────────────────
  await expect(page.getByRole('heading', { name: /님 안녕하세요/ })).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.smart-admin-service-con')).toBeVisible();

  // ──────────────────────────────────────────
  // STEP 7. 경기관제 서비스 카드 확인
  // ──────────────────────────────────────────
  const golfControlCard = page.locator('.smart-admin-service').filter({ hasText: '경기관제' });
  await expect(golfControlCard).toBeVisible();

  // ──────────────────────────────────────────
  // STEP 8. [어드민 가기] 클릭 → 어드민 새 탭 오픈
  // ──────────────────────────────────────────
  // target="_blank" 방식이므로 click() 직전에 리스너 등록
  const adminPagePromise = context.waitForEvent('page');
  await golfControlCard.getByRole('button', { name: '어드민 가기' }).click();
  const adminPage = await adminPagePromise;

  // ──────────────────────────────────────────
  // STEP 9. [로그인 알림] 팝업 핸들러 등록
  // ──────────────────────────────────────────
  // 어드민 시스템에 이미 2개의 세션이 존재할 때 간헐적으로 노출
  // ⚠️  waitForLoadState() 이전에 등록해야 로드 중 팝업도 감지
  await adminPage.addLocatorHandler(
    adminPage.getByText('로그인을 진행하시겠습니까?'),
    async () => {
      await adminPage.getByRole('button', { name: '예' }).click();
    },
    { noWaitAfter: true, times: 3 },
  );

  // ──────────────────────────────────────────
  // STEP 10. [SMART CLUB ADMIN NOTICE] 공지 팝업 핸들러 등록
  // ──────────────────────────────────────────
  // 어드민 진입 시 공지가 1건 이상 있으면 자동 노출
  // 공지가 복수([1/3] 등)인 경우 × 클릭마다 다음 공지가 노출되므로 times 충분히 설정
  //
  // ▸ 닫기 버튼 실제 DOM (HOME 분석 결과):
  //     우상단 × : <button class="btn-top-close btn-top">
  //     하단 닫기 : <button class="btn-close"> (텍스트 '닫기')
  //   → class 기반 .btn-top-close 가 가장 안정적
  await adminPage.addLocatorHandler(
    adminPage.getByText('SMART CLUB ADMIN NOTICE'),
    async () => {
      await adminPage.locator('.btn-top-close').click();
    },
    { noWaitAfter: true, times: 10 },
  );

  // ──────────────────────────────────────────
  // STEP 11. 어드민 탭 로드 완료 대기
  // ──────────────────────────────────────────
  await adminPage.waitForLoadState('domcontentloaded', { timeout: 15000 });

  // ──────────────────────────────────────────
  // STEP 12. 어드민 홈 진입 확인
  // ──────────────────────────────────────────
  expect(adminPage.isClosed()).toBe(false);
  await adminPage.bringToFront();

  // 헤더에 서비스명(경기관제)·클럽명(킹즈락) 노출
  await expect(adminPage.getByText('경기관제')).toBeVisible({ timeout: 10000 });
  await expect(adminPage.getByText('킹즈락')).toBeVisible();

  // 공지 팝업이 닫혔는지 확인
  await expect(adminPage.getByText('SMART CLUB ADMIN NOTICE')).not.toBeVisible();

  // 원본 대시보드 탭도 그대로 유지
  await expect(page).toHaveURL(/\/dashboard/);

  // ──────────────────────────────────────────
  // ✅ 테스트 종료
  //    page      : 대시보드 탭 유지
  //    adminPage : 공지 팝업 닫힘 후 어드민 홈 유지
  // ──────────────────────────────────────────
});
