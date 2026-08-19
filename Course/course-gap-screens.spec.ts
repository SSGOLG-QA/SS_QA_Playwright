import { test } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { runScreenBattery } from '../lib/course/screenBattery';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, skip, writeReport } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  미착수/저커버 화면 갭 채우기(비파괴) — 균일 심화 배터리 12종 + 버튼 감사.
//  실행: npm run course:auth 후 npm run course:gap
//  커버리지 리포트에서 0%/저커버로 확인된 데이터 화면에 info-deep 배터리 적용(공용 screenBattery).
//  한 로그인 순회(세션 1런 제약). 전부 비파괴(조회/열람/다운로드/모달 취소).
// ──────────────────────────────────────────────────────────────

const GAP_SCREENS: { menu: string; sub: string; key: string }[] = [
  { menu: '인력 관리', sub: '근태 관리', key: 'GAP-HRWORK' },
  { menu: '인력 관리', sub: '투입 관리', key: 'GAP-HRASSIGN' },
  { menu: '사진 관리', sub: '정보별 사진', key: 'GAP-PHOTOINFO' },
  { menu: '사진 관리', sub: '위치별 사진', key: 'GAP-PHOTOLOC' },
  { menu: '시설 관리', sub: '시설 총괄', key: 'GAP-FACILITY' },
  { menu: '장비 관리', sub: '장비 총괄', key: 'GAP-EQUIP' },
  { menu: '자재 관리', sub: '자재 총괄', key: 'GAP-MATSUM' },
  { menu: '자재 관리', sub: '자재 수불(품목별)', key: 'GAP-MATITEM' },
];

test('미착수 화면 갭 채우기 균일 배터리(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  admin.on('filechooser', (fc) => { fc.setFiles([]).catch(() => {}); });

  for (const { menu, sub, key } of GAP_SCREENS) {
    const P = `${menu} > ${sub}`;
    const ok = await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: `코스관리_갭_${key}_0`, tcId: `${key}-00`, desc: '진입' }, '진입 실패'); continue; }
    await admin.waitForTimeout(1200); await killAlarms(admin);
    await runScreenBattery(admin, P, key, `코스관리_갭_${key}`);
  }

  await killAlarms(admin);
  await writeReport('코스관리_갭채우기');
});
