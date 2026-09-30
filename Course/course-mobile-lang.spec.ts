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
  test.setTimeout(3_000_000);   // 50분 — 철저 모드(MLANG_CRAWL_MAX=14 등) + 예산 상향(MLANG_BUDGET_MS=38분) 수용 여유(2026-09-30). 기본 예산 32분 유지, 철저 런 시 예산 38분 + 오버슈트 + writeReport 를 50분 내 흡수. 세션은 동시로그인 제약이지 지속시간 제약 아님.
  const langs = pickMobileLangs();
  // ⚠ 언어 독립 진입(외국어 로그인 세션 대응) — 기능용 openCourseMobile 은 한국어 타일 텍스트 의존이라
  //   태국어 등 외국어 세션에서 '세션 만료' 오판. 여기선 URL 판정만 하는 lang-safe 진입 사용.
  const admin = await openCourseMobileLangSafe(page);
  console.log(`\n[course-mobile-lang] 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    // ⚠ writeReport 를 try/finally 로 보장(2026-09-28) — 커버리지 확장으로 런이 길어져 예외/부분완료 시에도
    //   여기까지 모은 결과를 반드시 리포트로 산출(이전: 타임아웃 시 리포트 통째 유실). 내부 데드라인이 시간초과를 정직 SKIP 처리.
    try {
      await runCourseMobileLang(admin, lang);
    } catch (e) {
      console.error(`[course-mobile-lang] ${lang.ko} 런 예외(부분 결과로 리포트 발행):`, e);
    }
    const name = `코스관리모바일_다국어_${lang.ko}`;
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · 모바일 다국어(앱 내 스위처 부재) · 비파괴`,
      lead: `모바일 웹은 <b>앱 내 언어 스위처가 없어</b> 런타임 i18n 주입 전환 가능성을 먼저 감지한 뒤, 가능하면 <b>한국어↔${lang.ko}</b> 시스템 텍스트를 대조(전략 A), 세션이 이미 ${lang.ko}로 로그인돼 있으면 <b>활성언어 누수 스캔</b>(전략 B)을 수행합니다. 둘 다 불가하면 정직 SKIP하고 원인(전환 메커니즘)을 기록합니다.`,
      catch: ['외국어 UI인데 <b>한글 잔존</b>(미번역)', '<b>i18n 키 누출</b>(ui.2971 등 번역 실패)', '언어 <b>혼재</b>·타 언어 노출·인코딩 깨짐(전략 A)', '<b>레이아웃 결함</b> — 글자 잘림·영역 벗어남은 FAIL(전용 시트 "레이아웃 결함"), <b>버튼 겹침</b>은 DOM만으로 시각겹침 단정 불가라 히트테스트 통과분만 <b>관찰(확인 필요)</b>로 기록. 현재 언어 렌더 기준(다국어 오버플로 포착)'],
      miss: ['앱 내 스위처 부재 → <b>런타임 전환 미지원 시 언어별 재로그인</b> 필요(전략 A 불가 시 SKIP)', '데이터(카드/행/뱃지·인명·날짜) 배제 → <b>시스템 chrome</b>만(보수적)', '문단형 안내문구·긴 텍스트는 이번 판(데이터 오탐 방지) 축소 스캔', '데이터 의존 미렌더·진입 실패(정직 SKIP)'],
    });
    await writeReport(name);
  }
});
