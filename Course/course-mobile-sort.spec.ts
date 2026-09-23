import { test, devices } from '@playwright/test';
import { COURSE_MOBILE_STORAGE } from '../lib/course/courseHelpers';
import { openCourseMobile } from '../lib/course/courseMobileHelpers';
import { runCourseMobileSort } from '../lib/course/courseMobileSort';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** 정렬 불변식 검증 — E2E 기능 오라클(다국어와 별개, 2026-09-17)
//   선택한 정렬 라벨(향후 발생 임박순·최신순·이름순·중요도순)과 실제 카드 순서를 대조 → 단조성 위반 시 FAIL.
//   동기: 이슈/예측 "향후 발생 임박순"인데 코스_이슈001(2027-08-18)이 3번째 = 임박순 위반 의심.
//   선결: npm run course:auth-mobile (모바일 세션, 한국어).
//   실행: npm run course:mobile-sort
//   산출: reports/코스관리모바일_정렬검증_report_*.xlsx (+ HTML)
//   비파괴: 정렬 옵션 선택(조회)만 — 저장/삭제/등록 없음.
// ──────────────────────────────────────────────────────────────
const mobileState = fs.existsSync(COURSE_MOBILE_STORAGE) ? { storageState: COURSE_MOBILE_STORAGE } : {};
test.use({ ...devices['iPhone 13'], ...mobileState });

test('코스관리 모바일 정렬 불변식 검증 (기능 오라클, 비파괴)', async ({ page }) => {
  test.setTimeout(600_000);
  const admin = await openCourseMobile(page);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  await runCourseMobileSort(admin);
  const name = '코스관리모바일_정렬검증';
  setReportHtmlOpts(name, {
    subtitle: '모바일 정렬 불변식 — 선택 정렬 라벨 ↔ 실제 카드 순서 대조(기능 오라클) · 비파괴',
    lead: '리스트 화면에서 <b>정렬 옵션을 선택한 뒤 실제 카드 순서</b>가 그 정렬 기준(발생일/등록일/중요도/이름)과 일치하는지 단조성으로 검증합니다. 위반 시 첫 역전 지점과 실제 시퀀스를 근거로 FAIL.',
    catch: ['선택 정렬과 <b>다른 순서</b>(예: 향후 발생 임박순인데 발생일 역전)', '정렬 선택이 <b>실제 미반영</b>(기본 순서 노출)'],
    miss: ['정렬 키 사양 미확정(중요도 방향 등) → either/SKIP', '카드 2건 미만·데이터 의존 → SKIP', '정렬 컨트롤/옵션 미포착 → 진단 후 SKIP'],
  });
  await writeReport(name);
});
