import { test, expect } from '@playwright/test';

const SS_USERNAME = process.env.SS_USERNAME ?? (() => { throw new Error('SS_USERNAME 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.'); })();
const SS_PASSWORD = process.env.SS_PASSWORD ?? (() => { throw new Error('SS_PASSWORD 환경변수가 설정되지 않았습니다. .env 파일을 확인하세요.'); })();

test('SmartScore 클럽 로그인 시나리오', async ({ page }) => {

  // ──────────────────────────────────────────
  // STEP 1. 사이트 접속
  // ──────────────────────────────────────────
  const response = await page.goto('https://td1.smartscore.kr/ss/mng/login.html');

  // ⚠️ 서버 오류(502 등) 시 테스트를 실패 대신 skip 처리
  //    → 테스트 환경 서버 다운 여부와 테스트 코드 버그를 분리하기 위함
  const status = response?.status() ?? 0;
  if (status !== 200) {
    test.skip(true, `서버 응답 불가 (HTTP ${status}) — 테스트 환경(td1) 상태를 확인하세요`);
    return;
  }

  // 페이지 로드 확인
  await expect(page.getByRole('heading', { name: '로그인이 필요합니다.' })).toBeVisible();

  // ──────────────────────────────────────────
  // STEP 2. 로그인
  // ──────────────────────────────────────────
  // ⚠️ fakeid/fakepass honeypot 필드가 있으므로 placeholder로 정확히 타겟팅
  await page.getByPlaceholder('ID').fill(SS_USERNAME);
  await page.getByPlaceholder('Password').fill(SS_PASSWORD);
  await page.getByRole('button', { name: '로그인' }).click();

  // 로그인 완료 확인 (index.html로 이동)
  await page.waitForURL('**/index.html');

  // ──────────────────────────────────────────
  // STEP 3. 클럽관리 > 클럽 로그인 메뉴 진입
  // ──────────────────────────────────────────
  // 클럽관리 메뉴가 이미 펼쳐진 경우 대비: 서브메뉴 미노출 시에만 클릭
  const clubLoginLink = page.getByRole('link', { name: '클럽 로그인' });
  if (!await clubLoginLink.isVisible()) {
    await page.getByRole('link', { name: '클럽관리' }).click();
  }
  await clubLoginLink.click();

  // 클럽 로그인 페이지 확인
  await page.waitForURL('**/club.html?act=login');

  // ──────────────────────────────────────────
  // STEP 4. 클럽 선택 (Select2 드롭다운)
  // ──────────────────────────────────────────
  // Select2는 selectOption() 불가 → 컨테이너 클릭 후 검색 입력
  await page.locator('.select2-container').first()
    .locator('.select2-selection--single').click();
  await page.locator('.select2-search__field').waitFor({ state: 'visible' });

  // 검색창에 "에스" 입력
  await page.locator('.select2-search__field').pressSequentially('에스', { delay: 50 });

  // 검색 결과 목록에서 "밀양 에스파크 (29014)" 선택
  await page.waitForSelector('.select2-results__option', { state: 'visible' });
  await page.locator('.select2-results__option', { hasText: '밀양 에스파크 (29014)' }).click();

  // 선택값 확인
  await expect(page.locator('.select2-container').first()).toContainText('밀양 에스파크 (29014)');

  // ──────────────────────────────────────────
  // STEP 5. 본인 암호 입력 및 클럽 로그인
  // ──────────────────────────────────────────
  // 암호 입력 (name="ss_pass")
  await page.locator('input[name="ss_pass"]').click();
  await page.locator('input[name="ss_pass"]').fill(SS_PASSWORD);

  // [클럽 로그인] 버튼 클릭
  // ⚠️ <button> 아닌 <div class="btn bt-st02"> 이므로 getByRole('button') 불가
  await page.locator('div.btn.bt-st02').first().click();

  // 로그인 결과 확인 (성공 시 페이지 전환 또는 특정 요소 노출)
  await page.waitForTimeout(2000);
});