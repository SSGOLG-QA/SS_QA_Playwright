import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { runTabletFeature } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 태블릿 운영 관리 > 태블릿 기능 설정 - 구조 기반 전수 검증 (드라이브 상세 TC 미작성)
//   IA: 태블릿 운영 관리 하위 — 진입 가능(구현)
//   ⚠ 내용 수정/저장/삭제/확인 항목 추가/패스워드 변경/기능 토글은 비파괴(노출만)
// 실행: npx playwright test --project=admin-chromium Admin/tablet-feature.spec.ts --no-deps
test('태블릿 운영 관리 > 태블릿 기능 설정 검증 (구조 기반)', async ({ page, context }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  const admin = await openAdmin(page, context);
  if (await gotoMenu(admin, '태블릿 운영 관리', '태블릿 기능 설정', { path: '태블릿 운영 관리 > 태블릿 기능 설정', tcRef: '태블릿 운영 관리_태블릿 기능 설정', tcId: '진입', desc: '태블릿 기능 설정 진입', failMsg: '메뉴 진입 불가' }))
    await runTabletFeature(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('tablet-feature'); });
