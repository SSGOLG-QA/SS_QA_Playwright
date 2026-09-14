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
//   실행(⚠ 세션 1런/로그인 — 파트 분리 권장, repo 관례대로 $env: 인라인): npm run course:auth 후
//     $env:LANGS="태국어"; $env:LANGUI_PART="overlap";  npm run course:lang-ui   # 겹침만(짧은 런)
//     $env:LANGS="태국어"; $env:LANGUI_PART="filename"; npm run course:lang-ui   # 파일명만(짧은 런)
//     $env:LANGS="태국어"; npm run course:lang-ui                                # 둘 다(세션 여유 시 — 후반 SKIP 가능)
//   ⚠ overlap+filename(7화면)을 한 런에 담으면 세션 만료로 후반 SKIP → **파트 분리 실행이 정석**.
//   ⚠ 파트 전환 후엔 이전 $env:LANGUI_PART 잔존 주의 → 다른 파트/all 실행 전 Remove-Item Env:LANGUI_PART (또는 새 셸).
//   산출: reports/코스관리_다국어UI[_overlap|_filename]_<언어>_report_*.xlsx (+ HTML, 파트별 분리)
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
  // ⚠ 세션 1런/로그인 한계([[session-one-run-per-login]]): overlap+filename(7화면)을 한 런에 담으면
  //   후반이 세션 만료로 SKIP됨. LANGUI_PART 로 파트 분리 실행 → 각각 fresh 세션(짧은 런)에서 전량 완주.
  //     LANGUI_PART=overlap  : 레이아웃 겹침만
  //     LANGUI_PART=filename : 내보내기 파일명만
  //     미지정/all           : 둘 다(짧은 언어/세션 여유 시)
  const PART = (process.env.LANGUI_PART || 'all').toLowerCase();
  const doOverlap = PART === 'all' || PART === 'overlap';
  const doFilename = PART === 'all' || PART === 'filename';
  const partSfx = PART === 'all' ? '' : `_${PART}`;   // 파트별 실행은 리포트 파일 분리(덮어쓰기 방지)
  const admin = await openCourseAdmin(page, context);
  console.log(`\n[course-lang-ui] PART=${PART} · 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    // overlap 먼저(액션 적음) → filename(세션 소모 큼) — all 실행 시 순서 유지.
    if (doOverlap) await runCourseLangOverlap(admin, lang);
    if (doFilename) await runCourseLangFilename(admin, lang);
    const name = `코스관리_다국어UI${partSfx}_${lang.ko}`;
    const scope = PART === 'overlap' ? '레이아웃 겹침' : PART === 'filename' ? '내보내기 파일명 i18n' : '내보내기 파일명 i18n + 레이아웃 겹침';
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · ${scope}(QA-15548) · 비파괴`,
      lead: `표준 다국어 검증이 보는 '화면 텍스트 번역'을 넘어, <b>${lang.ko}</b> 모드에서 ① 내보내기 <b>다운로드 파일명</b>에 한글이 남는지, ② 번역된 <b>라벨이 입력 박스와 겹치는지</b>(레이아웃 파손)를 검출합니다.${PART !== 'all' ? ` (이번 런=<b>${scope}</b>만)` : ''}`,
      catch: ['외국어 UI인데 <b>파일명이 한국어</b>(내보내기 미번역)', '긴 번역 라벨이 <b>입력 박스를 침범</b>(rect 교차)'],
      miss: ['미세 <b>간격</b> 조정(시각회귀 영역·오라클 없음)', '언어 <b>즉시반영</b> 지연(별도 타이밍 프로브)', '데이터 의존으로 내보내기/모달 미노출(정직 SKIP)', ...(PART !== 'all' ? [`다른 파트(<b>${PART === 'overlap' ? '파일명' : '겹침'}</b>)는 별도 LANGUI_PART 런`] : [])],
    });
    await writeReport(name);
  }
});
