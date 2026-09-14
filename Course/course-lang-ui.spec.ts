import { test } from '@playwright/test';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { COURSE_LANGS, CourseLang } from '../lib/course/courseLangCheck';
import { runCourseLangFilename, runCourseLangOverlap } from '../lib/course/courseLangLayout';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어 — **텍스트 번역 외 UI 결함** 검증 (QA-15548)
//   표준 course:lang-check(텍스트 번역 여부)가 못 잡는 두 부류:
//     · No.1 내보내기 다운로드 **파일명 한글 잔존**(외국어 UI인데 파일명 미번역)
//     · No.2 번역 **라벨↔입력박스 겹침**(레이아웃 파손 — 목표 설정 모달)
//
//   실행(⚠ 세션 1런/로그인): npm run course:auth 후
//     LANGS=태국어 npm run course:lang-ui           # 단일 언어(QA-15548 재현)
//     npm run course:lang-ui                         # LANGS 미지정 = 전체 7개
//   산출: 언어별 reports/코스관리_다국어UI_<언어>_report_*.xlsx (+ HTML)
//   비파괴: 내보내기(다운로드=읽기)·모달 열기/스캔/닫기만. 화면마다 한국어 원복.
// ──────────────────────────────────────────────────────────────

function pickLangs(): CourseLang[] {
  const raw = (process.env.LANGS || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  if (!raw.length) return COURSE_LANGS;
  return COURSE_LANGS.filter((l) => raw.some((r) => l.ko.includes(r) || l.clickLabel.toLowerCase().includes(r.toLowerCase()) || l.label.includes(r)));
}

test('코스관리 다국어 — UI 결함(파일명·레이아웃 겹침, QA-15548, 비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  const langs = pickLangs();
  const admin = await openCourseAdmin(page, context);
  console.log(`\n[course-lang-ui] 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    // ⚠ overlap 먼저(홈 1화면·모달 1개=액션 적음) → filename(7화면×전환·다운로드=세션 소모 큼) 나중.
    //   [[session-one-run-per-login]]: filename이 세션을 소진해 뒤 단계가 로그인 페이지로 빠지던 것 방지(1런 확인).
    await runCourseLangOverlap(admin, lang);
    await runCourseLangFilename(admin, lang);
    const name = `코스관리_다국어UI_${lang.ko}`;
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · 내보내기 파일명 i18n + 레이아웃 겹침(QA-15548) · 비파괴`,
      lead: `표준 다국어 검증이 보는 '화면 텍스트 번역'을 넘어, <b>${lang.ko}</b> 모드에서 ① 내보내기 <b>다운로드 파일명</b>에 한글이 남는지, ② 번역된 <b>라벨이 입력 박스와 겹치는지</b>(레이아웃 파손)를 검출합니다.`,
      catch: ['외국어 UI인데 <b>파일명이 한국어</b>(내보내기 미번역)', '긴 번역 라벨이 <b>입력 박스를 침범</b>(rect 교차)'],
      miss: ['미세 <b>간격</b> 조정(시각회귀 영역·오라클 없음)', '언어 <b>즉시반영</b> 지연(별도 타이밍 프로브)', '데이터 의존으로 내보내기/모달 미노출(정직 SKIP)'],
    });
    await writeReport(name);
  }
});
