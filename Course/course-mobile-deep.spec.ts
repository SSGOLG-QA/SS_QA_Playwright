import { test, devices } from '@playwright/test';
import { COURSE_MOBILE_STORAGE } from '../lib/course/courseHelpers';
import { openCourseMobile } from '../lib/course/courseMobileHelpers';
import { runMobileDeepAll } from '../lib/course/courseMobileDeep';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** — 리스트 화면 딥 인터랙션 (공용 엔진, 5개 화면 일반화, 2026-09-21)
//   시설관리 파일럿(course-mobile-facility, 29/29)에서 확립한 플로우를 화면-무관 엔진으로 추출 →
//   작업관리·일상점검·이슈예측·장비관리·자재관리에 config로 일반화.
//   플로우(비파괴): 정렬 토글·조건설정 열기/적용/초기화·검색·등록폼 취소팝업·상세+⋮(수정/삭제 확인팝업).
//   선결: npm run course:auth-mobile. 실행: npm run course:mobile-deep
//   산출: reports/코스관리모바일_리스트딥_report_*.xlsx
//   ⚠ 세션 재로그인 1회당 1런 — 단일 test에서 5개 화면 순회(사이 hardReset).
// ──────────────────────────────────────────────────────────────
const mobileState = fs.existsSync(COURSE_MOBILE_STORAGE) ? { storageState: COURSE_MOBILE_STORAGE } : {};
test.use({ ...devices['iPhone 13'], ...mobileState });

test('코스관리 모바일 리스트 딥 인터랙션 (5개 화면 일반화, 비파괴)', async ({ page }) => {
  test.setTimeout(900_000);
  const admin = await openCourseMobile(page);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  await runMobileDeepAll(admin);
  const name = '코스관리모바일_리스트딥';
  setReportHtmlOpts(name, {
    subtitle: '모바일 리스트 딥 인터랙션 — 작업관리·일상점검·이슈예측·장비관리·자재관리 · 비파괴',
    lead: '시설관리 파일럿에서 검증된 딥 인터랙션(정렬 토글·조건설정·검색·등록폼 취소팝업·상세+⋮ 수정/삭제 확인팝업)을 공용 엔진으로 5개 리스트 화면에 일반화. 버튼 노출을 넘어 실제 클릭→동작→화면·상태까지 검증.',
    catch: ['정렬/조건설정/검색이 <b>클릭에 무동작</b>', '등록폼 [뒤로] 시 <b>취소 확인 팝업 미출현</b>', '상세 필드 미렌더·⋮ 수정/삭제 확인팝업 미출현'],
    miss: ['정렬 순서 단조성 → 보류(제품 수정 후)', '화면 미보유 컨트롤(장비/자재 조건설정 등) → SKIP', '데이터 0건·셀렉터 미포착 → 관찰 후 SKIP(가짜 FAIL 방지)'],
  });
  await writeReport(name);
});
