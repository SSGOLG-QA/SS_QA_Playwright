import { test } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport } from '../lib/reporter';
import {
  runCourseHome, runCourseWorkOrders, runCourseVendor,
  runCourseMaterialLedger, runCourseCostAggregate, runCourseBudgetDetail,
  runCourseMonitor, runCourseMaterialSummary, runCourseEquipment, runCourseFacility,
  runCourseScreens, COURSE_INFO_SPECS, COURSE_STATUS_SPECS, COURSE_COST_SPECS,
  COURSE_BUDGET_SPECS, COURSE_MATERIAL_EXTRA_SPECS, COURSE_TASK_SPECS, COURSE_HR_SPECS,
} from '../lib/course/courseSuites';

// ──────────────────────────────────────────────────────────────
//  코스관리 전체 검증 — 화면별 run*() 순회 → 엑셀 리포트(경기관제와 동일 파이프라인).
//  - 단일 test 1회 진입 후 순회(세션 "1런" 제약). 비파괴(등록 모달은 열어서 검증 후 취소).
//  - 실행: npm run course:suite  (세션 만료 시: npm run course:auth)
//  - 산출물: reports/코스관리_전체테스트_report_*.xlsx
// ──────────────────────────────────────────────────────────────

test('코스관리 전체 검증 (화면별 + 계산 불변식)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();

  const admin = await openCourseAdmin(page, context);

  // Home (진입 직후 화면)
  await runCourseHome(admin);

  // 코스 현황 관리 — 코스 모니터(지도) + 나머지 5종(제네릭)
  await gotoCourseMenu(admin, '코스 현황 관리', '코스 모니터');
  await runCourseMonitor(admin);
  await runCourseScreens(admin, COURSE_STATUS_SPECS);

  // 정보 관리 — 거래처(상세) + 정보 10종·사진 2종(제네릭)
  await gotoCourseMenu(admin, '정보 관리', '거래처 정보');
  await runCourseVendor(admin);
  await runCourseScreens(admin, COURSE_INFO_SPECS);

  // 작업 관리 — 작업 지시(상세) + 이슈/예측(controls)
  await gotoCourseMenu(admin, '작업 관리', '작업 지시');
  await runCourseWorkOrders(admin);
  await runCourseScreens(admin, COURSE_TASK_SPECS);

  // 예산·비용
  await gotoCourseMenu(admin, '예산 관리', '예산 상세');
  await runCourseBudgetDetail(admin);
  await runCourseScreens(admin, COURSE_BUDGET_SPECS);
  await gotoCourseMenu(admin, '비용 관리', '비용 집계');
  await runCourseCostAggregate(admin);
  await runCourseScreens(admin, COURSE_COST_SPECS);

  // 자재 — 총괄(신규 등록 모달) + 수불(불변식) + 일자별(controls·날짜검색)
  await gotoCourseMenu(admin, '자재 관리', '자재 총괄');
  await runCourseMaterialSummary(admin);
  await gotoCourseMenu(admin, '자재 관리', '자재 수불(품목별)');
  await runCourseMaterialLedger(admin);
  await runCourseScreens(admin, COURSE_MATERIAL_EXTRA_SPECS);

  // 장비·시설 — 등록 폼
  await gotoCourseMenu(admin, '장비 관리', '장비 총괄');
  await runCourseEquipment(admin);
  await gotoCourseMenu(admin, '시설 관리', '시설 총괄');
  await runCourseFacility(admin);

  // 인력 관리 4종 (권한/인력/근태/투입)
  await runCourseScreens(admin, COURSE_HR_SPECS);

  const file = await writeReport('코스관리_전체테스트');
  console.log('\n[코스관리 리포트]', file);
});
