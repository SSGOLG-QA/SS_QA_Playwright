import { test } from '@playwright/test';
import { openCourseAdmin, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { runCourseLangCheck, runCourseLangModal, COURSE_LANGS, CourseLang } from '../lib/course/courseLangCheck';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어 통합 스위트 — 정적·탭(course:lang-check) + 폼/모달/팝업(course:lang-modal)을
//   **단일 로그인**으로 순차 실행 → 언어별 **통합 리포트 1개**로 산출.
//  ⚠ "1로그인 1런" 제약([[session-one-run-per-login]]) → 두 검사를 각각 돌리면 로그인 2번 필요하지만,
//    이 스위트는 openCourseAdmin 1회로 둘 다 수행(언어당 2패스). course:quality/course:e2e와 동일한 "통합" 역할.
//  실행: npm run course:auth 후
//    $env:LANGS="영어"; npm run course:lang-all                          # 단일 언어(권장)
//    npm run course:lang-all                                            # LANGS 미지정 = 전체 7개(매우 김)
//    $env:LANGS="영어"; $env:LANG_MENUS="Home,예산 관리"; npm run course:lang-all  # 부분 메뉴
//  산출: 언어별 reports/코스관리_언어검증_통합_<언어>_report_*.xlsx (+ HTML)
//  비파괴: 언어 전환·읽기·폼 열기만(저장/삭제/변경/적용/업로드 제외), 화면·언어 원복.
// ──────────────────────────────────────────────────────────────

// LANGS env: ko명(영어) 또는 clickLabel(English) 부분일치. 미지정 시 전체.
function pickLangs(): CourseLang[] {
  const raw = (process.env.LANGS || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  if (!raw.length) return COURSE_LANGS;
  return COURSE_LANGS.filter((l) => raw.some((r) => l.ko.includes(r) || l.clickLabel.toLowerCase().includes(r.toLowerCase()) || l.label.includes(r)));
}

test('코스관리 다국어 통합 — 정적·탭 + 폼/팝업 (단일 로그인, 언어별 통합 리포트)', async ({ page, context }) => {
  test.setTimeout(2_400_000);   // 40분 — 언어당 2패스(정적·탭 + 폼/팝업)
  const admin = await openCourseAdmin(page, context);
  const langs = pickLangs();
  console.log(`\n[course-lang-all] 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    console.log(`\n═══ [${lang.ko}] 1/2 정적·탭 화면 (lang-check) ═══`);
    await runCourseLangCheck(admin, lang).catch((e) => console.warn('[lang-all] check 실패(계속):', e?.message || e));
    await killAlarms(admin);
    console.log(`\n═══ [${lang.ko}] 2/2 폼·모달·팝업 (lang-modal) ═══`);
    await runCourseLangModal(admin, lang).catch((e) => console.warn('[lang-all] modal 실패(계속):', e?.message || e));
    await killAlarms(admin);

    const name = `코스관리_언어검증_통합_${lang.ko}`;
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · 정적·탭 화면 + 폼/팝업 내부 UI 표기 통합 검증 · 비파괴`,
      lead: `한국어 기준 화면을 <b>${lang.ko}</b>로 전환해, <b>①조회·탭 화면</b>(메뉴·버튼·컬럼·탭 이름·2/3단 탭·안내문구·표 분류·차트 라벨)과 <b>②등록/수정 폼·모달·팝업 내부</b>(placeholder·[항목 추가] 등 버튼·datepicker)의 <b>시스템 UI 표기</b>가 제대로 번역됐는지 요소별로 대조했습니다. 사용자 데이터(거래처·인명·수치)는 번역 대상이 아니라 제외합니다.`,
      catch: ['전환 후에도 <b>한글이 남은</b> 미번역', '<b>빈값</b>으로 사라진 미노출', '한글+외국어 <b>혼재</b>', '대상 언어가 아닌 <b>타 언어 노출</b>', '<b>인코딩 깨짐</b>·<b>글자 잘림</b>'],
      miss: ['<b>번역 정확도(오역)</b> 자체', '이미지 안의 텍스트·<b>픽셀 레이아웃</b>', '데이터 의존으로 <b>안 열리는 폼</b>(참고로 분리)', '사용자 <b>데이터 값</b>(번역 비대상)'],
    });
    await writeReport(name);
  }
});
