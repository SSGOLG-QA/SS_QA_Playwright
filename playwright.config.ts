import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';

// .env 파일에서 환경변수 로드 (없어도 오류 없음 — CI는 직접 env 주입)
config();

// ──────────────────────────────────────────────────────────────
//  Playwright 설정
//  - setup 프로젝트가 로그인 세션(storageState)을 1회 생성
//  - 본 테스트 프로젝트는 저장된 세션을 재사용 (매 테스트 재로그인 X)
// ──────────────────────────────────────────────────────────────

export const STORAGE_STATE = 'auth/.auth/admin.json';

// ── 병렬 최적화: 계정 풀 (기본 1 = 현 직렬, 하위호환) ───────────────────────
//  ACCOUNT_COUNT=N 이면 워커마다 다른 계정 storageState 사용 → 동시 로그인 충돌 없이 N병렬.
//  ⚠ 전제: N개 테스트 계정 + setup 으로 admin-0..N-1 storageState 생성(계정0=admin.json 재사용).
export const ACCOUNT_COUNT = Math.max(1, Number(process.env.ACCOUNT_COUNT) || 1);
//  계정 인덱스 → storageState 경로 (계정0 = 기존 admin.json 하위호환, 1.. = admin-N.json)
export const accountStorage = (i: number) => (i === 0 ? STORAGE_STATE : `auth/.auth/admin-${i}.json`);

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 단일 계정(기본)은 직렬 — 같은 계정 동시 로그인 시 강제 로그아웃. 계정 풀(N>1)에서만 병렬.
  fullyParallel: ACCOUNT_COUNT > 1,
  workers: ACCOUNT_COUNT,   // 1=직렬(안전 기본) / N=N병렬(워커별 distinct 계정)
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
