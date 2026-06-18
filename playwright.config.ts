import { defineConfig } from '@playwright/test';

// ──────────────────────────────────────────────────────────────
//  Playwright 설정
//  - setup 프로젝트가 로그인 세션(storageState)을 1회 생성
//  - 본 테스트 프로젝트는 저장된 세션을 재사용 (매 테스트 재로그인 X)
// ──────────────────────────────────────────────────────────────

export const STORAGE_STATE = 'auth/.auth/admin.json';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // 진입 레이스(SPA 네비) 플레이크 흡수 — CI는 2회, 로컬은 1회 재시도. (이전: retries 미설정=0이라 trace:on-first-retry가 무용지물이었음)
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'https://td17.smartscore.kr',
    actionTimeout: 15_000,
    // 첫 실패에도 트레이스 확보(재시도 전제인 on-first-retry보다 견고)
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 브라우저 창 최대화 (headed 시 전체 화면)
    launchOptions: {
      args: ['--start-maximized'],
    },
  },

  projects: [
    // 1) 로그인 세션 생성 (auth.setup.ts)
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // 2) 연속 플로우 — 수동 로그인 + 진입까지 한 창에서 진행 (storageState/세션 분리 없음)
    {
      name: 'flow',
      testMatch: /Flow[\\/].*\.spec\.ts/,
      use: {
        // device 스프레드 제거: viewport:null 과 deviceScaleFactor 충돌 방지
        viewport: null,   // 고정 뷰포트 해제 → 최대화된 창 전체 사용
      },
    },

    // 3) 어드민 페이지 테스트 — setup 완료 후 storageState 재사용
    {
      name: 'admin-chromium',
      testMatch: /Admin[\\/].*\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        // device 스프레드 제거: viewport:null 과 deviceScaleFactor 충돌 방지
        viewport: null,   // 고정 뷰포트 해제 → 최대화된 창 전체 사용
        storageState: STORAGE_STATE,
      },
    },
  ],
});
