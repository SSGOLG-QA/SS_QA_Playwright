import { defineConfig } from '@playwright/test';
import path from 'path';

// ──────────────────────────────────────────────────────────────
//  Playwright_New 전용 설정 (기존 프로젝트와 파일/리포트 분리)
//  - 인증 세션은 기존 setup 산출물(auth/.auth/admin.json) 재사용
//  - 실행: npx playwright test --config=Playwright_New/playwright.config.ts
//    (세션 만료 시 루트에서: npx playwright test --project=setup --headed)
// ──────────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, '..');

export default defineConfig({
  testDir: __dirname,
  testMatch: /.*\.e2e\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, 'playwright-report') }]],
  outputDir: path.join(__dirname, 'test-results'),

  use: {
    baseURL: 'https://td17.smartscore.kr',
    actionTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: null,
    storageState: path.join(ROOT, 'auth', '.auth', 'admin.json'),
    launchOptions: { args: ['--start-maximized'] },
  },

  projects: [{ name: 'round-e2e' }],
});
