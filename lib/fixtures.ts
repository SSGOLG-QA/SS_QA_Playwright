import { test as base, Page } from '@playwright/test';
import { openAdmin } from './adminHelpers';
import { ACCOUNT_COUNT, accountStorage } from '../playwright.config';

type AdminFixtures = {
  admin: Page;
};

/**
 * admin: openAdmin()을 자동 실행하는 커스텀 픽스처.
 *
 * 사용법:
 *   import { test } from '../lib/fixtures';
 *   test('...', async ({ admin }) => { ... });
 *
 * - storageState(아래 오버라이드)로 쿠키 재사용
 * - 대시보드 → 경기관제 [어드민 가기] → /club/ 진입까지 자동 처리
 * - 팝업(로그인 확인·공지) 핸들러도 openAdmin 내부에서 등록됨
 */
export const test = base.extend<AdminFixtures>({
  // ── 병렬 최적화: 워커별 계정 storageState 분배 ────────────────────────────
  //  parallelIndex(워커 고정값) % ACCOUNT_COUNT 로 계정 풀에서 distinct 계정 선택.
  //  ACCOUNT_COUNT=1(기본)이면 항상 idx 0 → admin.json (현 단일계정 동작과 100% 동일).
  //  workers ≤ ACCOUNT_COUNT(config)라 두 워커가 같은 계정을 동시에 쓰지 않음 → 중복 로그인 강제 로그아웃 회피.
  storageState: async ({}, use, testInfo) => {
    const idx = testInfo.parallelIndex % ACCOUNT_COUNT;
    await use(accountStorage(idx));
  },
  admin: async ({ page, context }, use) => {
    const admin = await openAdmin(page, context);
    await use(admin);
  },
});

export { expect } from '@playwright/test';
