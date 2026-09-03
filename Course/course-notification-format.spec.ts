import { test } from '@playwright/test';
import { openCourseAdmin, killAlarms } from '../lib/course/courseHelpers';
import { verifyNotificationFormat } from '../lib/course/notificationFormat';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────────────────────
//  코스관리 2차 — 헤더 알림 "상태별 문구/발송시간 포맷" 검증(비파괴).
//  근거: `2026-09 코스관리_PC 2차` 헤더 시트(알림 리스트 상태별 문구 · 발송 시점별 시간 표기).
//  실행: npm run course:auth 후  npm run course:notif
//  헤더는 전역이라 메뉴 이동 없이 홈 진입 직후 검증. 비파괴(알림 리스트 열어 읽기만, '모두 읽음'·랜딩 금지).
//  ⚠ 데이터 의존: 알림 0건 시 SKIP. 트리거/구조 미검출 시 SKIP + analysis/_notif-probe_*.json 덤프(1런 확정).
// ──────────────────────────────────────────────────────────────────────────────

test('코스관리 2차 — 헤더 알림 상태별 문구/시간 포맷(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  await killAlarms(admin);
  await admin.waitForTimeout(1_000);
  await verifyNotificationFormat(admin, '헤더 > 알림', '코스관리_헤더알림', 'HDR');
  await killAlarms(admin);
  await writeReport('코스관리_알림포맷');
});
