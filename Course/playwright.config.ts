import { defineConfig } from '@playwright/test';
import path from 'path';
import { config as dotenv } from 'dotenv';

// ──────────────────────────────────────────────────────────────
//  코스관리(Course Management) 전용 설정 — 기존 경기관제 설정과 분리.
//  - 대상: https://course-mng-td.smartscore.kr (킹즈락, td 테스트 환경)
//  - 세션: auth/.auth/course.json (course:auth 로 생성/갱신)
//  - 실행:
//      npm run course:auth    # 헤디드 수동 로그인 → 세션 저장
//      npm run course:smoke   # IA 순회 스모크(비파괴)
//    또는: npx playwright test --config=Course/playwright.config.ts --project=course
// ──────────────────────────────────────────────────────────────

dotenv();
const ROOT = path.join(__dirname, '..');
const COURSE_STORAGE = path.join(ROOT, 'auth', '.auth', 'course.json');

export default defineConfig({
  testDir: ROOT,                    // course-setup(auth/)·course(Course/) 를 모두 포함
  timeout: 120_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,                       // 공유 QA 계정 — 직렬 필수(동시 로그인 강제 로그아웃)
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(__dirname, 'playwright-report') }],
    // ✨monocart-reporter: 리치 HTML 리포트(케이스 트리·트렌드·트레이스·필터). 단일 자립 HTML.
    ['monocart-reporter', {
      name: '코스관리(Course) 테스트 리포트',
      outputFile: path.join(__dirname, 'monocart-report', 'index.html'),
    }],
  ],
  outputDir: path.join(__dirname, 'test-results'),

  use: {
    baseURL: 'https://course-mng-td.smartscore.kr',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: null,
    launchOptions: { args: ['--start-maximized'] },
  },

  projects: [
    // 1) 인증 세션 생성 (headed 수동 로그인) — storageState 미사용(신규 로그인)
    {
      name: 'course-setup',
      testMatch: /auth[\\/]course\.setup\.ts/,
      use: { headless: false },
    },
    // 2) 코스관리 테스트 — 저장된 세션 재사용
    {
      name: 'course',
      testMatch: /Course[\\/].*\.spec\.ts/,
      use: { storageState: COURSE_STORAGE },
    },
  ],
});
