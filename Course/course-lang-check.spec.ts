import { test } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { runCourseLangCheck, COURSE_LANGS, CourseLang } from '../lib/course/courseLangCheck';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어(언어) 검증 — 전 메뉴 정적 UI 표기 결함 검출(한글노출/미번역/혼재/타언어/인코딩/글자잘림).
//   admin langCheck 핵심(captureSlots·applySlotComparison) 재사용 + 코스 헤더 스위처(.select-btn).
//   지원 언어 7개(한국어 baseline 제외): 영어·베트남어·태국어·번체중문·간체중문·일본어·인도네시아어.
//
//   실행(⚠ 세션 1런/로그인): npm run course:auth 후
//     LANGS=영어 npm run course:lang-check              # 단일 언어(첫 검증 권장)
//     npm run course:lang-check                          # LANGS 미지정 = 전체 7개(한 세션 순회, 길다)
//     LANG_MENUS="예산,비용" LANGS=영어 npm run course:lang-check   # 부분 메뉴
//   산출: 언어별 reports/코스관리_언어검증_<언어>_report_*.xlsx (+ HTML)
//   비파괴: 언어 전환·읽기만, 화면마다 한국어 원복.
// ──────────────────────────────────────────────────────────────

// LANGS env: ko명(영어) 또는 clickLabel(English) 부분일치. 미지정 시 전체.
function pickLangs(): CourseLang[] {
  const raw = (process.env.LANGS || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  if (!raw.length) return COURSE_LANGS;
  return COURSE_LANGS.filter((l) => raw.some((r) => l.ko.includes(r) || l.clickLabel.toLowerCase().includes(r.toLowerCase()) || l.label.includes(r)));
}

test('코스관리 다국어(언어) 검증 — 전 메뉴 정적 UI 표기(비파괴)', async ({ page, context }) => {
  test.setTimeout(1_800_000);
  const admin = await openCourseAdmin(page, context);
  const langs = pickLangs();
  console.log(`\n[course-lang] 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    await runCourseLangCheck(admin, lang);
    const name = `코스관리_언어검증_${lang.ko}`;
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · 전 메뉴 정적 UI 표기 검증 · 비파괴`,
      lead: `한국어 기준 화면을 <b>${lang.ko}</b>로 전환해, 메뉴·버튼·컬럼·안내문구 등 <b>시스템 UI 표기</b>가 제대로 번역됐는지 요소별로 대조했습니다. 사용자 데이터(거래처·인명·수치)는 번역 대상이 아니라 제외합니다.`,
      catch: ['전환 후에도 <b>한글이 남은</b> 미번역', '<b>빈값</b>으로 사라진 미노출', '한글+외국어 <b>혼재</b>', '대상 언어가 아닌 <b>타 언어 노출</b>', '<b>인코딩 깨짐</b>·<b>글자 잘림</b>'],
      miss: ['<b>번역 정확도(오역)</b> 자체', '이미지 안의 텍스트·<b>픽셀 레이아웃</b>', '사용자 <b>데이터 값</b>(번역 비대상)'],
    });
    await writeReport(name);
  }
});
