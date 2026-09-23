import { test, devices } from '@playwright/test';
import { COURSE_MOBILE_STORAGE } from '../lib/course/courseHelpers';
import { openCourseMobile, enterCourseMgmt } from '../lib/course/courseMobileHelpers';
import { runAllMobile, runMobileWritePaths } from '../lib/course/courseMobileSuites';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** 기능 검증 (구조 기반·비파괴, 9영역 단일 순회)
//  - 선결: npm run course:auth-mobile (모바일 세션). 실행: npm run course:mobile
//  - iPhone 13 에뮬레이션 + 모바일 세션(course-mobile.json).
//  - 산출: reports/코스관리모바일_report_*.xlsx
//  - ⚠ 세션 재로그인 1회당 1런 — 단일 test에서 9영역 순회.
// ──────────────────────────────────────────────────────────────
const mobileState = fs.existsSync(COURSE_MOBILE_STORAGE) ? { storageState: COURSE_MOBILE_STORAGE } : {};
test.use({ ...devices['iPhone 13'], ...mobileState });

test('코스관리 모바일 기능 검증 (9영역 구조 기반·비파괴)', async ({ page }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();

  const admin = await openCourseMobile(page);
  await enterCourseMgmt(admin);
  await runAllMobile(admin);
  // 파괴(생성-only) write-path — ALLOW_DESTRUCTIVE=1 + course-mng-td + 킹즈락 충족 시에만 실행(미충족 SKIP).
  //   ⚠ 모바일 삭제 UI 부재로 teardown 불가 → 마커(E2EW*) 기록 잔존(테스트 서버·사용자 승인). 수동/주기 정리.
  await runMobileWritePaths(admin);

  await writeReport('코스관리모바일');
});
