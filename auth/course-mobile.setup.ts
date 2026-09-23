import { test, expect } from '@playwright/test';
import { COURSE_MOBILE_STORAGE, COURSE_MOBILE_LOGIN_URL } from '../lib/course/courseHelpers';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** 인증 세션 생성 (headed 수동 로그인)
//  - 실행: npm run course:auth-mobile
//  - 모바일은 별도 앱(/mobile/Login 전용 폼: 골프장 검색+아이디+비밀번호) — 클라우드 브리지 없음.
//    데스크톱 course.json 과 세션이 분리되므로 모바일 전용 storageState(auth/.auth/course-mobile.json) 필요.
//  - ⚠ 비밀번호 입력은 자동화하지 않음(정책) → 브라우저에서 직접 로그인. 로그인 성공(=/mobile/Login 이탈) 감지 후 저장.
//  - ⚠ 세션은 재로그인 1회당 1런만 생존 가능(공유 QA 계정) → 필요할 때마다 재실행.
// ──────────────────────────────────────────────────────────────

test('코스관리 모바일 인증 세션 생성 (수동 로그인)', async ({ page, context }) => {
  test.setTimeout(360_000);

  await page.goto(COURSE_MOBILE_LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Phase 1: 로그인 폼(비밀번호 입력창) 렌더 대기 — 이게 없으면 진입 직후 레이스로 '미로그인'을 '성공'으로 오판함.
  //   (이미 로그인 상태면 폼이 안 뜸 → sawForm=false 로 Phase 2 즉시 성공 판정 허용.)
  const pw = page.locator('input[type="password"]').first();
  await pw.waitFor({ state: 'visible', timeout: 45_000 }).catch(() => {});
  const sawForm = await pw.isVisible().catch(() => false);
  console.log(sawForm
    ? '\n[course:auth-mobile] 로그인 폼 확인 — 골프장 선택 + 아이디/비밀번호로 직접 로그인하세요 (최대 5분 대기)...\n'
    : '\n[course:auth-mobile] 로그인 폼 미발견(이미 로그인 상태일 수 있음) — 진입 확인 중...\n');

  // Phase 2: 로그인 성공 감지 — [폼 사라짐 + /Login 이탈]이 **2회 연속(≈4s) 안정**될 때만 성공(전환 순간 오판 방지).
  let stable = 0;
  await expect
    .poll(async () => {
      const url = page.url();
      const onLogin = /\/mobile\/Login/i.test(url);
      const pwVisible = await pw.isVisible().catch(() => false);
      const ok = !onLogin && /\/mobile\//i.test(url) && !pwVisible;
      stable = ok ? stable + 1 : 0;
      return stable >= 2 ? 'ok' : 'wait';
    }, { timeout: 300_000, intervals: [2000, 2000, 2000, 3000] })
    .toBe('ok');

  await page.waitForTimeout(2_500);   // 홈 초기 렌더 여유
  console.log('[course:auth-mobile] 로그인 감지됨. 진입 URL:', page.url());

  await context.storageState({ path: COURSE_MOBILE_STORAGE });
  console.log(`[course:auth-mobile] 모바일 세션 저장 완료 → ${COURSE_MOBILE_STORAGE}`);
});
