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
      subtitle: `${lang.ko}(${lang.label}) 모드 · 캘린더 표시 년도 정합성(QA-15543) · 비파괴`,
      lead: `한국어(그레고리) 캘린더 년도를 기준으로, <b>${lang.ko}</b> 전환 후 같은 캘린더의 <b>표시 년도</b>가 정합한지 대조했습니다. 표준 다국어 검증이 잡는 '번역 여부'가 아니라, 번역·현지화는 됐으나 <b>년도 값 자체가 틀린</b> 결함(QA-15543 계열)을 검출합니다.`,
      catch: ['그레고리 기준과 어긋난 <b>잘못된 캘린더 년도</b>', '불교력 이중가산(+1086)·역방향(−543) 등 <b>비정상 오프셋</b>', '태국 숫자(๒๕๖๙)로 표기된 년도까지 정규화 대조'],
      miss: ['월/일 값·요일 순서(별도)', '캘린더 <b>없는</b> 화면·데이터 의존으로 미렌더된 캘린더(정직 SKIP)', '데이터 셀의 날짜(작업일자·기간 범위 — 시스템 chrome 아님)'],
    });
    await writeReport(name);
  }
});
