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
  // 진입 플레이크 흡수(파괴 테스트는 withFixture teardown이 잔여 정리). CI 1회·로컬 0회 — 파괴 테스트 재실행 보수적 제한.
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(__dirname, 'playwright-report') }],
    ['json', { outputFile: path.join(__dirname, 'test-results', 'results.json') }],
    [path.join(__dirname, 'excel-reporter.ts')],  // json 리포터 onEnd 이후 실행 → 엑셀 자동 생성
  ],
  outputDir: path.join(__dirname, 'test-results'),

  use: {
    baseURL: 'https://td17.smartscore.kr',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: null,
    storageState: path.join(ROOT, 'auth', '.auth', 'admin.json'),
    launchOptions: { args: ['--start-maximized'] },
  },

  projects: [{ name: 'round-e2e' }],
});
