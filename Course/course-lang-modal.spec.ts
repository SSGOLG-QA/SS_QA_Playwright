import { test } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { runCourseLangModal, COURSE_LANGS, CourseLang } from '../lib/course/courseLangCheck';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어 — 모달/팝업 내부 언어 검증(Phase 2). admin runLangCheckModal 대응.
//   열기형 트리거(신규등록/보기/상세/설정/미리보기)를 KO에서 위치식별 → 전환 → 위치로 재오픈 → 모달 델타 KO↔FG 대조.
//   비파괴: 저장/삭제/변경/적용/업로드 등 파괴 트리거 제외, closeForm으로 복원.
//   실행(세션 1런/로그인): npm run course:auth 후
//     $env:LANGS="영어"; npm run course:lang-modal
//     $env:LANG_MENUS="정보,예산"; $env:LANGS="영어"; npm run course:lang-modal   # 부분
//   산출: reports/코스관리_언어검증_팝업_<언어>_report_*.xlsx
// ──────────────────────────────────────────────────────────────

function pickLangs(): CourseLang[] {
  const raw = (process.env.LANGS || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  if (!raw.length) return COURSE_LANGS;
  return COURSE_LANGS.filter((l) => raw.some((r) => l.ko.includes(r) || l.clickLabel.toLowerCase().includes(r.toLowerCase()) || l.label.includes(r)));
}

test('코스관리 다국어 — 모달/팝업 내부 표기 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(1_800_000);
  const admin = await openCourseAdmin(page, context);
  const langs = pickLangs();
  console.log(`\n[course-lang-modal] 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    await runCourseLangModal(admin, lang);
    const name = `코스관리_언어검증_팝업_${lang.ko}`;
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · 폼/팝업 내부 UI 표기 검증(모달·[수정] 편집화면·페이지폼) · 비파괴`,
      lead: `신규등록·상세·설정 <b>팝업</b>과 <b>[수정] 편집 화면</b>(같은 화면이 폼으로 전환)·페이지폼을 실제로 열어, 내부 UI 표기(입력 placeholder·[항목 추가] 등 버튼·datepicker)가 <b>${lang.ko}</b>로 제대로 번역됐는지 대조했습니다. 파괴 동작(저장·삭제)은 클릭하지 않고 열기만 수행 후 폐기합니다.`,
      catch: ['폼/팝업 내부 <b>미번역(한글 잔존)</b>', '<b>빈값</b> 미노출', '<b>혼재</b>·<b>타 언어</b>', '<b>인코딩 깨짐</b>'],
      miss: ['<b>번역 정확도(오역)</b>', '데이터 의존으로 <b>안 열리는 폼</b>(SKIP)', '이미지 텍스트·픽셀 레이아웃'],
    });
    await writeReport(name);
  }
});
