import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { runTabletMessage, runTabletHoleEvent } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 태블릿 운영 관리 잔여 - 메시지 관리 + 홀 이벤트 관리 (구조 기반, 드라이브 상세 TC 미작성)
//   ⚠ 저장/추가/적용/수정/삭제/드래그는 비파괴(노출만). 안내문구는 부분 일치
// 실행: npx playwright test --project=admin-chromium Admin/tablet-message-event.spec.ts --no-deps
test('태블릿 운영 관리 잔여(메시지 관리/홀 이벤트 관리) 검증', async ({ page, context }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff();
  const admin = await openAdmin(page, context);
  if (await gotoMenu(admin, '태블릿 운영 관리', '메시지 관리', { path: '태블릿 운영 관리 > 메시지 관리', tcRef: '태블릿 운영 관리_메시지 관리', tcId: '진입', desc: '메시지 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runTabletMessage(admin);
  if (await gotoMenu(admin, '태블릿 운영 관리', '홀 이벤트 관리', { path: '태블릿 운영 관리 > 홀 이벤트 관리', tcRef: '태블릿 운영 관리_홀 이벤트 관리', tcId: '진입', desc: '홀 이벤트 관리 진입', failMsg: '메뉴 진입 불가' }))
    await runTabletHoleEvent(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('tablet-message-event'); });
