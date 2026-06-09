import { test, expect } from '@playwright/test';

// ──────────────────────────────────────────────────────────────
//  TC-CLOUD-001: SmartScore Cloud 로그인
//  대상: https://sv1td4.smartscore.kr/ko/login
// ──────────────────────────────────────────────────────────────

test('TC-CLOUD-001: 사이트 접속 > 클럽 검색 및 선택 > 로그인', async ({ page }) => {

  // ──────────────────────────────────────────
  // STEP 1. 로그인 페이지 접속
  // ──────────────────────────────────────────
  await page.goto('https://sv1td4.smartscore.kr/ko/login');

  // 페이지 로드 확인 (타이틀 + 로고 + 로그인 폼)
  await expect(page).toHaveTitle('클라우드');
  await expect(page.getByRole('link', { name: 'smartscore cloud' })).toBeVisible();
  await expect(page.getByRole('button', { name: '로그인' })).toBeVisible();

  // ──────────────────────────────────────────
  // STEP 2. 클럽명 검색
  // ──────────────────────────────────────────
  // ⚠️ type="search" 커스텀 드롭다운 — selectOption() 불가
  //    pressSequentially로 키 이벤트를 발생시켜 검색 결과 트리거
  const clubSearchInput = page.getByRole('searchbox');
  await expect(clubSearchInput).toBeVisible();
  await clubSearchInput.click();
  await clubSearchInput.pressSequentially('킹즈락', { delay: 50 });

  // ──────────────────────────────────────────
  // STEP 3. 드롭다운에서 '킹즈락' 선택
  // ──────────────────────────────────────────
  // .select-group__add      = 검색창 좌측 돋보기 아이콘 (24px 고정) ← 클릭 대상 아님
  // .select-group-dropdown  = 검색 결과 드롭다운 컨테이너 (position: absolute)
  // .select-group-dropdown li = 개별 결과 아이템
  const clubOption = page.locator('.select-group-dropdown li', { hasText: '킹즈락' });
  await expect(clubOption).toBeVisible({ timeout: 5000 });
  await clubOption.click();

  // ──────────────────────────────────────────
  // STEP 4. 아이디 입력
  // ──────────────────────────────────────────
  // ⚠️ <label>과 <input>에 for/id 연결 없음 → getByLabel() 불가, placeholder 사용
  const idInput = page.getByPlaceholder('아이디를 입력해주세요');
  await expect(idInput).toBeVisible();
  await idInput.fill('shin02160');

  // ──────────────────────────────────────────
  // STEP 5. 비밀번호 입력
  // ──────────────────────────────────────────
  const passwordInput = page.getByPlaceholder('비밀번호를 입력해주세요');
  await expect(passwordInput).toBeVisible();
  await passwordInput.fill('Jys0918S!');

  // ──────────────────────────────────────────
  // STEP 6. 중복 로그인 안내 팝업 핸들러 등록
  // ──────────────────────────────────────────
  // 팝업 발생 조건: 동일 계정이 이미 2개 세션으로 로그인 중일 때
  //   "중복 로그인은 2개까지만 가능합니다. ... 로그인을 진행하시겠습니까?"
  //
  // ▸ 기존 waitFor 방식의 한계:
  //     특정 시점에만 체크 → waitForURL 대기 중 팝업이 뜨면 감지 불가
  // ▸ addLocatorHandler 방식:
  //     테스트 전체 구간에서 .modal-group 노출을 감시
  //     → 어느 시점에 등장해도 [확인] 클릭 후 테스트 자동 재개
  await page.addLocatorHandler(
    page.locator('.modal-group').filter({ hasText: '로그인을 진행하시겠습니까?' }),
    async () => {
      // .modal-group 내 [확인] 버튼 (button-common primary) 클릭
      await page.locator('.modal-group')
        .getByRole('button', { name: '확인' })
        .click();
    },
    { noWaitAfter: true, times: 3 },  // 최대 3회까지 자동 처리
  );

  // ──────────────────────────────────────────
  // STEP 7. [로그인] 버튼 클릭
  // ──────────────────────────────────────────
  await page.getByRole('button', { name: '로그인' }).click();

  // ──────────────────────────────────────────
  // STEP 8. 로그인 성공 확인
  // ──────────────────────────────────────────
  // 로그인 성공 시 /login 경로에서 벗어남
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
});
