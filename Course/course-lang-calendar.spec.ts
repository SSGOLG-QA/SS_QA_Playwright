import { test } from '@playwright/test';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { COURSE_LANGS, CourseLang } from '../lib/course/courseLangCheck';
import { runCourseCalendarLang } from '../lib/course/courseCalendarLang';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어 — **캘린더 표시 년도 정합성** 검증 (QA-15543)
//   표준 다국어 하네스(course:lang-check)가 못 잡는 "값 결함"(번역은 됐으나 년도가 틀림) 전용 오라클 검출.
//   방식: KO(그레고리 신뢰 baseline) 캘린더 년도 ↔ 대상 언어 캘린더 년도 → 언어별 허용 오프셋 대조.
//     · 태국어: 그레고리(0) 또는 불교력(+543) 정상, 그 외 = 결함.
//     · 그 외 언어: 그레고리(0)만.
//
//   실행(⚠ 세션 1런/로그인): npm run course:auth 후
//     LANGS=태국어 npm run course:lang-calendar          # 단일 언어(QA-15543 재현 권장)
//     npm run course:lang-calendar                        # LANGS 미지정 = 전체 7개(한 세션 순회)
//   산출: 언어별 reports/코스관리_캘린더년도_<언어>_report_*.xlsx (+ HTML)
//   비파괴: 언어 전환·datepicker 열기/읽기/Escape 만(날짜 선택·저장·이동 없음). 화면마다 한국어 원복.
// ──────────────────────────────────────────────────────────────

// LANGS env: ko명(태국어) 또는 clickLabel(Thailand) 부분일치. 미지정 시 전체.
function pickLangs(): CourseLang[] {
  const raw = (process.env.LANGS || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  if (!raw.length) return COURSE_LANGS;
  return COURSE_LANGS.filter((l) => raw.some((r) => l.ko.includes(r) || l.clickLabel.toLowerCase().includes(r.toLowerCase()) || l.label.includes(r)));
}

test('코스관리 다국어 — 캘린더 년도 정합성(QA-15543, 비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  const langs = pickLangs();
  const admin = await openCourseAdmin(page, context);
  console.log(`\n[course-lang-calendar] 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    await runCourseCalendarLang(admin, lang);
    const name = `코스관리_캘린더년도_${lang.ko}`;
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · 캘린더 년도 + 로케일 날짜 순서(QA-15543) · 비파괴`,
      lead: `한국어(그레고리) 기준으로 <b>${lang.ko}</b> 전환 후 같은 캘린더의 ① <b>표시 년도</b>가 정합한지(값 결함), ② <b>날짜 순서</b>(YMD vs DMY 등 로케일 관습)가 맞는지 대조합니다. 숫자·시간 포맷은 앱 적용 여부 확인용 <b>관찰(프로브)</b>로 샘플을 남깁니다. 표준 다국어 검증의 '번역 여부'와 달리 <b>값·표기형식</b> 결함을 봅니다.`,
      catch: ['그레고리와 어긋난 <b>잘못된 년도</b>(불교력 이중가산·역방향 등)', '로케일과 어긋난 <b>날짜 순서</b>(예: DMY여야 하는데 YMD)', '태국 숫자(๒๕๖๙) 정규화 대조'],
      miss: ['월↔일 <b>세밀 순서</b>(월이 텍스트라 년 위치까지만 판정)', '<b>숫자·시간 포맷</b>은 이번 런 관찰만(실측 후 판정 확장)', '캘린더 없는 화면·데이터 의존 미렌더(정직 SKIP)'],
    });
    await writeReport(name);
  }
});
