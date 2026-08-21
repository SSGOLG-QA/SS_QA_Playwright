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
import { runDeepScreensSweep, filterDeepScreens } from '../lib/course/deepScreenE2E';

// ──────────────────────────────────────────────────────────────
//  코스관리 전체 검증 — 기능/구조 검증 + E2E 심화를 단일 스펙·단일 리포트로 일원화(2026-08-20).
//  - 구성: ① 화면별 run*()(요소·목록·컬럼·계산 불변식) → ② 폼 보유 화면 리뉴얼 수준 심화 E2E
//          (탭 이동·[신규등록]/[수정] 양경로 폼·입력 전수·datepicker·[X]클리어·항목추가/삭제·라디오·저장활성).
//  - 단일 test 1회 진입 후 순회(세션 "1런" 제약). 전부 비파괴(등록/수정 폼은 열어 조작 후 [취소] 폐기, 저장 미클릭).
//  - 실행: npm run course:suite  (세션 만료 시: npm run course:auth)
//  - 산출물: reports/코스관리_전체테스트_report_*.xlsx  ← 기능+E2E 통합 리포트
//  - 옵션: COURSE_STRUCT_ONLY=1 → ② 심화 생략(빠른 구조-only 회귀, ~5분). 기본은 통합(~15~20분).
//          DEEP_MENUS/DEEP_SUBS → ② 심화 대상 화면 필터(부분 실행). 미설정 시 폼 보유 전 화면.
// ──────────────────────────────────────────────────────────────

// 기본 = 기능 + E2E 통합. COURSE_STRUCT_ONLY=1 시에만 심화 생략(빠른 구조 회귀 탈출구).
const STRUCT_ONLY = process.env.COURSE_STRUCT_ONLY === '1';

test('코스관리 전체 검증 (기능/구조 + E2E 심화 통합)', async ({ page, context }) => {
  test.setTimeout(STRUCT_ONLY ? 300_000 : 1_800_000);
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

  // ── ② E2E 심화(기본 실행): 폼 보유 화면 리뉴얼 수준 심화(탭·양경로 폼·라디오·배터리, 비파괴) ──
  //   기능/구조 검증(①)에 이어 같은 로그인에서 수행 → 단일 전체테스트 리포트로 통합.
  //   COURSE_STRUCT_ONLY=1 이면 생략(빠른 구조 회귀). DEEP_MENUS/DEEP_SUBS로 대상 화면 필터 가능.
  if (!STRUCT_ONLY) await runDeepScreensSweep(admin, filterDeepScreens());

  const file = await writeReport('코스관리_전체테스트');
  console.log('\n[코스관리 리포트]', file);
});
