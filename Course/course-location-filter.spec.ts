import { test } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { verifyLocationFilter, verifyDateWeekday, verifyLocationSaveCascade } from '../lib/course/locationFilter';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, skip, writeReport } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────────────────────
//  코스관리 2차 개선 검증: "코스/홀/구역 선택 개선"(위치 설정 캐스케이드 필터) + "캘린더 요일 노출".
//  근거: 드라이브 `2026-09 코스관리_PC 2차` > 공통 시트(위치 설정 TC 5~35, 캘린더 TC 1~4).
//  실행: npm run course:auth 후  npm run course:locfilter   (재로그인 1회당 1런 — 단일 test 순회)
//  적용 화면(공통 시트 '적용범위' 7종): 정보관리 4 + 작업관리 3.
//  전부 비파괴(드롭다운 open/select·[적용]·달력 선택만, 저장 없음. 필터는 화면 재진입 시 리셋).
//  ⚠ 구조 미검출 시 SKIP(사유·실측 스냅샷) — 가짜 FAIL 금지(report-standard). 1런 후 SKIP 사유로 셀렉터 확정.
// ──────────────────────────────────────────────────────────────────────────────

const SCREENS: Array<{ parent: string; child: string; P: string; R: string; id: string }> = [
  { parent: '정보 관리', child: '잔디 측정 정보', P: '정보 관리 > 잔디 측정 정보', R: '코스관리_잔디측정', id: 'GRASS' },
  { parent: '정보 관리', child: '토양 측정 정보', P: '정보 관리 > 토양 측정 정보', R: '코스관리_토양측정', id: 'SOIL' },
  { parent: '정보 관리', child: '발병 정보', P: '정보 관리 > 발병 정보', R: '코스관리_발병정보', id: 'DISEASE' },
  { parent: '정보 관리', child: '일상 점검', P: '정보 관리 > 일상 점검', R: '코스관리_일상점검', id: 'DAILY' },
  { parent: '작업 관리', child: '작업 지시', P: '작업 관리 > 작업 지시', R: '코스관리_작업지시', id: 'WORK' },
  { parent: '작업 관리', child: '이슈 관리', P: '작업 관리 > 이슈 관리', R: '코스관리_이슈관리', id: 'ISSUE' },
  { parent: '작업 관리', child: '예측 정보', P: '작업 관리 > 예측 정보', R: '코스관리_예측정보', id: 'PREDICT' },
];

test('코스관리 2차 — 위치 설정 캐스케이드 필터 + 캘린더 요일(7화면, 비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  for (const s of SCREENS) {
    const entered = await gotoCourseMenu(admin, s.parent, s.child).then(() => true).catch(() => false);
    if (!entered) {
      skip({ path: s.P, tcRef: `${s.R}_0`, tcId: `${s.id}-00`, desc: '진입' }, '진입 실패(세션 degraded/메뉴 미노출)');
      continue;
    }
    await killAlarms(admin);
    await admin.waitForTimeout(1_200);   // 필터/데이터 렌더 여유
    await verifyLocationFilter(admin, s.P, s.R, s.id);
    await verifyDateWeekday(admin, s.P, s.R, s.id);
  }

  // ── 위치저장 등록폼 캐스케이드(TC36~67) — 작업 지시 신규 등록 모달 '작업 위치'(비파괴, 저장 안 함) ──
  {
    const P = '작업 관리 > 작업 지시 (신규 등록 폼)';
    const entered = await gotoCourseMenu(admin, '작업 관리', '작업 지시').then(() => true).catch(() => false);
    if (!entered) { skip({ path: P, tcRef: '코스관리_작업지시폼_0', tcId: 'WOFORM-00', desc: '진입' }, '진입 실패'); }
    else {
      await killAlarms(admin); await admin.waitForTimeout(1_000);
      await verifyLocationSaveCascade(admin, P, '코스관리_작업지시', 'WOFORM');
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_위치필터');
});
