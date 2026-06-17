import { test as base, Page } from '@playwright/test';
import { openAdmin } from './adminHelpers';

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
 * - storageState(auth/.auth/admin.json)로 쿠키 재사용
 * - 대시보드 → 경기관제 [어드민 가기] → /club/ 진입까지 자동 처리
 * - 팝업(로그인 확인·공지) 핸들러도 openAdmin 내부에서 등록됨
 */
export const test = base.extend<AdminFixtures>({
  admin: async ({ page, context }, use) => {
    const admin = await openAdmin(page, context);
    await use(admin);
  },
});

export { expect } from '@playwright/test';
