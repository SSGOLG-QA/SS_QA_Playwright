import { test, devices } from '@playwright/test';
import { COURSE_MOBILE_STORAGE } from '../lib/course/courseHelpers';
import { openCourseMobile, enterCourseMgmt } from '../lib/course/courseMobileHelpers';
import { runMobileExplore } from '../lib/course/exploration/mobile/mobileExplorer';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일** AI Exploratory Testing — P4 MVP (2026-09-23)
//   시드=작업 지시. 비파괴 열기 스윕(Tier A) + S1 연결검색 딥(Tier B) → R1/R2/R10 이상 표면화.
//   설계: Course/exploration/docs/mobile-exploratory-design.md · KB: knowledge/past-defects.mobile.json
//   선결: npm run course:auth-mobile. 실행: npm run course:explore-mobile
//   산출: reports/코스관리모바일_탐색_report_*.xlsx + results/mobile-state-graph.json + findings.mobile.json
//   ⚠ 세션 1런/로그인 · 비파괴(커밋 미실행) · thick-client · 페이지스택 hardReset.
// ──────────────────────────────────────────────────────────────
const mobileState = fs.existsSync(COURSE_MOBILE_STORAGE) ? { storageState: COURSE_MOBILE_STORAGE } : {};
test.use({ ...devices['iPhone 13'], ...mobileState });

test('코스관리 모바일 탐색 (P4 MVP — 작업 지시 시드, 비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  const admin = await openCourseMobile(page);
  await enterCourseMgmt(admin);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  await runMobileExplore(admin, context);
  const name = '코스관리모바일_탐색';
  setReportHtmlOpts(name, {
    subtitle: 'AI Exploratory Testing P4 MVP — 작업 지시 시드 · 비파괴 · R1/R2/R10',
    lead: '사전 TC 없이 Risk(과거결함 148건 KB) 우선순위로 비파괴 열기 스윕 + S1 연결검색을 탐색해 런타임 이상(R1)·예기치 않은 랜딩 이탈(R2)·연결 검색 초기화(R10)를 표면화. 이상은 review(ANOMALY/NEEDS_REVIEW), 결정론만 record.',
    catch: ['연결/불러오기 진입 시 <b>에러 팝업·JS 예외</b>(R1)', '뷰형 트리거 후 <b>랜딩 이탈</b>(R2)', '연결 검색어가 <b>조건설정 후 소실</b>(R10)', '0건 검색 시 <b>안내 문구 미노출</b>'],
    miss: ['커밋(저장·삭제·완료확정)은 비실행 → 관측 밖', '연결 트리거·검색 input 미발견 시 프로브 후 SKIP', '데이터 의존(0건 미형성) → SKIP'],
  });
  await writeReport(name);
});
