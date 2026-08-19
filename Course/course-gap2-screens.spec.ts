import { test } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { runScreenBattery } from '../lib/course/screenBattery';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, skip, writeReport } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  미착수 화면 2차 갭 채우기(비파괴) — 균일 심화 배터리 12종 + 버튼 감사.
//  실행: npm run course:auth 후 npm run course:gap2
//  커버리지 매니페스트 미등록(= live-PASS 미기록) 6화면 대상. 개별 스펙엔 언급되나 매니페스트 미반영.
//   정보 관리 2종(코스 운영 정보·관리 기준 정보) / 작업 관리 2종(작업 계획·작업 일보) / 장비 관제 / 시설 관제.
//  ⚠ 장비 관제·시설 관제·작업 계획은 데이터 테이블이 아닌 관제/캘린더 화면일 수 있음 →
//    배터리가 비매칭 체크는 graceful SKIP, 리스트/카드 렌더 + 버튼 감사로 최소 커버 + 실제 구조 문서화.
//  한 로그인 순회(세션 1런 제약). 전부 비파괴(조회/열람/다운로드/모달 취소).
// ──────────────────────────────────────────────────────────────

const GAP2_SCREENS: { menu: string; sub: string; key: string }[] = [
  { menu: '정보 관리', sub: '코스 운영 정보', key: 'GAP2-INFOOPS' },
  { menu: '정보 관리', sub: '관리 기준 정보', key: 'GAP2-INFOEVAL' },
  { menu: '작업 관리', sub: '작업 계획', key: 'GAP2-TASKPLAN' },
  { menu: '작업 관리', sub: '작업 일보', key: 'GAP2-TASKDAILY' },
  { menu: '장비 관리', sub: '장비 관제', key: 'GAP2-EQUIPMON' },
  { menu: '시설 관리', sub: '시설 관제', key: 'GAP2-FACILMON' },
];

test('미착수 화면 2차 갭 채우기 균일 배터리(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  admin.on('filechooser', (fc) => { fc.setFiles([]).catch(() => {}); });

  for (const { menu, sub, key } of GAP2_SCREENS) {
    const P = `${menu} > ${sub}`;
    const ok = await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: `코스관리_갭2_${key}_0`, tcId: `${key}-00`, desc: '진입' }, '진입 실패(SNB 링크 없음/네비 실패)'); continue; }
    await admin.waitForTimeout(1200); await killAlarms(admin);
    await runScreenBattery(admin, P, key, `코스관리_갭2_${key}`);
  }

  await killAlarms(admin);
  await writeReport('코스관리_갭채우기2');
});
