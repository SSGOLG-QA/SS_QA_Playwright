import { test, devices } from '@playwright/test';
import { COURSE_MOBILE_STORAGE } from '../lib/course/courseHelpers';
import { runCourseMobileLang, pickMobileLangs, openCourseMobileLangSafe } from '../lib/course/courseMobileLang';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** 다국어 검증 — 미해결 블로커 해소(2026-09-14)
//   ⚠ 앱 내 언어 스위처 부재 → 런타임 i18n 주입 전환을 감지해 전략 자동 선택:
//     · 전략 A(전환 가능): KO↔대상 슬롯 대조(데스크톱 applySlotComparison 재사용)
//     · 전략 B(세션 활성언어가 이미 외국어): 활성언어 누수 스캔(한글잔존·i18n키·인코딩)
//     · 둘 다 불가: 정직 SKIP + 진단(전환 메커니즘 review · 스위처 부재 diff)
//
//   선결: npm run course:auth-mobile (모바일 세션 — 언어별 로그인이면 그 언어로).
//   실행(⚠ 세션 1런/로그인):
//     npm run course:mobile-lang-verify                 # LANGS 미지정 = 전체 7개(전략 A 전환 성공 시 한 세션 순회)
//     $env:LANGS="일본어"; npm run course:mobile-lang-verify   # 단일 언어(전략 B는 그 언어로 로그인된 세션에서)
//   산출: reports/코스관리모바일_다국어_<언어>_report_*.xlsx (+ HTML)
//   비파괴: i18n 런타임 상태만 변경(서버 반영 없음)·읽기/스캔만. 종료 시 한국어 원복.
// ──────────────────────────────────────────────────────────────
const mobileState = fs.existsSync(COURSE_MOBILE_STORAGE) ? { storageState: COURSE_MOBILE_STORAGE } : {};
test.use({ ...devices['iPhone 13'], ...mobileState });

test('코스관리 모바일 다국어 검증 (자기발견형 전략, 비파괴)', async ({ page }) => {
  test.setTimeout(900_000);
  const langs = pickMobileLangs();
  // ⚠ 언어 독립 진입(외국어 로그인 세션 대응) — 기능용 openCourseMobile 은 한국어 타일 텍스트 의존이라
  //   태국어 등 외국어 세션에서 '세션 만료' 오판. 여기선 URL 판정만 하는 lang-safe 진입 사용.
  const admin = await openCourseMobileLangSafe(page);
  console.log(`\n[course-mobile-lang] 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    await runCourseMobileLang(admin, lang);
    const name = `코스관리모바일_다국어_${lang.ko}`;
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · 모바일 다국어(앱 내 스위처 부재) · 비파괴`,
      lead: `모바일 웹은 <b>앱 내 언어 스위처가 없어</b> 런타임 i18n 주입 전환 가능성을 먼저 감지한 뒤, 가능하면 <b>한국어↔${lang.ko}</b> 시스템 텍스트를 대조(전략 A), 세션이 이미 ${lang.ko}로 로그인돼 있으면 <b>활성언어 누수 스캔</b>(전략 B)을 수행합니다. 둘 다 불가하면 정직 SKIP하고 원인(전환 메커니즘)을 기록합니다.`,
      catch: ['외국어 UI인데 <b>한글 잔존</b>(미번역)', '<b>i18n 키 누출</b>(ui.2971 등 번역 실패)', '언어 <b>혼재</b>·타 언어 노출·인코딩 깨짐(전략 A)'],
      miss: ['앱 내 스위처 부재 → <b>런타임 전환 미지원 시 언어별 재로그인</b> 필요(전략 A 불가 시 SKIP)', '데이터(카드/행/뱃지·인명·날짜) 배제 → <b>시스템 chrome</b>만(보수적)', '문단형 안내문구·긴 텍스트는 이번 판(데이터 오탐 방지) 축소 스캔', '데이터 의존 미렌더·진입 실패(정직 SKIP)'],
    });
    await writeReport(name);
  }
});
