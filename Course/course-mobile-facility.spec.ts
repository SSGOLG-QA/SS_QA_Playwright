import { test, devices } from '@playwright/test';
import { COURSE_MOBILE_STORAGE } from '../lib/course/courseHelpers';
import { openCourseMobile } from '../lib/course/courseMobileHelpers';
import { runMobileFacilityDeep } from '../lib/course/courseMobileFacility';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** — 시설관리 딥 인터랙션 검증 (파일럿, 2026-09-21)
//   배경(사용자 지적): 기존 기능 스위트는 정렬/조건설정/시설등록 버튼을 **노출만** 검증 →
//     실제 클릭·동작·화면·상태(캐스케이드 필터·취소 팝업·상세 렌더)는 미검증 = "다수 화면 누락".
//   본 스펙: 시설관리 1화면에 4개 플로우 완결 검증 → 라이브 검증 후 6개 리스트 화면으로 일반화 예정.
//     ① 정렬 토글(진입/토글 동작만 — 순서 판정 보류) ② 조건설정 캐스케이드(위치→2/3분류·빈상태·적용/초기화)
//     ③ 시설등록 폼 + 취소 팝업(비파괴, 저장 안 함) ④ 시설 상세(필드·점검이력·위치맵 렌더)
//   선결: npm run course:auth-mobile (모바일 세션, 한국어).
//   실행: npm run course:mobile-facility
//   산출: reports/코스관리모바일_시설관리딥_report_*.xlsx (+ HTML)
//   비파괴: 필터=뷰만 / 등록폼=입력해도 [예]로 폐기(저장 안 함) / 상세=읽기만.
// ──────────────────────────────────────────────────────────────
const mobileState = fs.existsSync(COURSE_MOBILE_STORAGE) ? { storageState: COURSE_MOBILE_STORAGE } : {};
test.use({ ...devices['iPhone 13'], ...mobileState });

test('코스관리 모바일 시설관리 딥 인터랙션 (파일럿, 비파괴)', async ({ page }) => {
  test.setTimeout(300_000);
  const admin = await openCourseMobile(page);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  await runMobileFacilityDeep(admin);
  const name = '코스관리모바일_시설관리딥';
  setReportHtmlOpts(name, {
    subtitle: '모바일 시설관리 딥 인터랙션 — 정렬 토글·조건설정 캐스케이드·등록폼 취소팝업·상세 렌더 · 비파괴',
    lead: '버튼 <b>노출</b>을 넘어 실제 <b>클릭→동작→화면·상태</b>를 검증합니다. 정렬 토글(순서판정 보류)·조건설정 캐스케이드 필터(위치→2/3분류, "결과가 없습니다" 빈상태, 적용/초기화)·시설등록 폼 진입과 [뒤로]→취소 확인 팝업·시설 상세 렌더까지 완결 검증.',
    catch: ['정렬 버튼이 <b>클릭에 무동작</b>(라벨·리스트 불변)', '조건설정 모달·캐스케이드 필터 <b>미동작</b>', '등록폼 [뒤로] 시 <b>취소 확인 팝업 미출현</b>(무저장 이탈)', '상세 화면 필드·점검이력·위치맵 <b>미렌더</b>'],
    miss: ['정렬 순서 단조성 판정 → <b>보류</b>(제품 수정사항 반영 후)', '리스트 0건·데이터 의존 → SKIP', '셀렉터 미포착 → 관찰(review) 후 SKIP(가짜 FAIL 방지)'],
  });
  await writeReport(name);
});
