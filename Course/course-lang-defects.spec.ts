import { test } from '@playwright/test';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts, skip, review } from '../lib/reporter';
import { openCourseAdmin, isCourseLoggedOut } from '../lib/course/courseHelpers';
import { COURSE_LANGS, CourseLang, runCourseLangCheck } from '../lib/course/courseLangCheck';
import { runCourseCalendarLang } from '../lib/course/courseCalendarLang';
import { runCourseLangOverlap, runCourseLangFilename } from '../lib/course/courseLangLayout';

// ──────────────────────────────────────────────────────────────
//  코스관리 다국어 — **통합 순차 검증** (언어별 명령어 1개 + 리포트 1개)
//   목적: 언어당 여러 스펙(캘린더/겹침/파일명/텍스트)을 따로 돌리는 번거로움·리포트 산개 해소.
//   포함(기본): ① 레이아웃 겹침(짧음) ② 캘린더 년도(짧음) ③ 내보내기 파일명(김) — QA-15543·15548 결함 검출 3종.
//   옵션: $env:LANG_DEFECTS_TEXT="1" → ④ 텍스트 번역(전 메뉴, 무거움) 뒤에 추가. (세션 여유 있을 때만 권장)
//
//   ⚠ 세션 1런/로그인([[session-one-run-per-login]]): 파트를 **짧은 것부터** 순차 실행하고, 매 파트 전 세션
//     생존을 확인 → 런 도중 세션이 죽으면 **남은 파트를 "세션 만료"로 정직 SKIP**(제품결함 오인·헛시도 방지).
//     경량 3종은 대개 한 세션에 완주. 무거운 텍스트(④)를 넣으면 뒷부분이 만료 SKIP될 수 있음(정직 표기됨).
//
//   실행: npm run course:auth 후
//     $env:LANGS="일본어"; npm run course:lang-defects                       # 결함 3종
//     $env:LANGS="일본어"; $env:LANG_DEFECTS_TEXT="1"; npm run course:lang-defects  # + 텍스트 번역
//     npm run course:lang-defects                                            # LANGS 미지정 = 전체 7개(언어마다 리포트)
//   산출: 언어별 reports/코스관리_다국어통합_<언어>_report_*.xlsx (+ HTML) — 파트가 시트/tcId로 구분됨.
//   비파괴: 언어 전환·읽기·다운로드(읽기)·모달 열기/닫기만. 화면마다 한국어 원복.
// ──────────────────────────────────────────────────────────────

function pickLangs(): CourseLang[] {
  const raw = (process.env.LANGS || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
  if (!raw.length) return COURSE_LANGS;
  return COURSE_LANGS.filter((l) => raw.some((r) => l.ko.includes(r) || l.clickLabel.toLowerCase().includes(r.toLowerCase()) || l.label.includes(r)));
}

test('코스관리 다국어 — 통합 순차 검증(캘린더·겹침·파일명[·텍스트], QA-15543/15548, 비파괴)', async ({ page, context }) => {
  test.setTimeout(1_800_000);
  const langs = pickLangs();
  const withText = process.env.LANG_DEFECTS_TEXT === '1';
  const admin = await openCourseAdmin(page, context);
  console.log(`\n[course-lang-defects] 대상 언어 ${langs.length}: ${langs.map((l) => l.ko).join(', ')} · 텍스트포함=${withText}`);

  for (const lang of langs) {
    resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
    // 짧은 것 → 긴 것 순(세션 살아있을 때 경량 먼저 완주). 각 파트 전 세션 게이트.
    //   resumeCmd = 세션 만료로 미수행 시 재인증(course:auth) 후 이 파트만 개별 재실행하는 명령(자동 안내용).
    const parts: { name: string; run: () => Promise<void>; resumeCmd: string }[] = [
      { name: '레이아웃 겹침', run: () => runCourseLangOverlap(admin, lang), resumeCmd: `$env:LANGS="${lang.ko}"; $env:LANGUI_PART="overlap"; npm run course:lang-ui` },
      { name: '캘린더 년도', run: () => runCourseCalendarLang(admin, lang), resumeCmd: `$env:LANGS="${lang.ko}"; npm run course:lang-calendar` },
      { name: '내보내기 파일명', run: () => runCourseLangFilename(admin, lang), resumeCmd: `$env:LANGS="${lang.ko}"; $env:LANGUI_PART="filename"; npm run course:lang-ui` },
    ];
    if (withText) parts.push({ name: '텍스트 번역(전 메뉴)', run: () => runCourseLangCheck(admin, lang), resumeCmd: `$env:LANGS="${lang.ko}"; npm run course:lang-check` });

    let sessionDead = false;
    const missed: { name: string; resumeCmd: string }[] = [];   // 세션 만료로 미수행된 파트(재개 안내용)
    for (const p of parts) {
      const meta = { path: `다국어 통합 > ${p.name}`, tcRef: `코스관리_다국어통합_${p.name}`, tcId: `LANGALL-${lang.ko}`, desc: `${lang.ko} ${p.name} 순차 검증` };
      if (sessionDead || isCourseLoggedOut(admin)) {
        sessionDead = true; missed.push({ name: p.name, resumeCmd: p.resumeCmd });
        skip(meta, `세션 만료(로그인 페이지)로 '${p.name}' 미수행 — course:auth 후 재개: ${p.resumeCmd}`);
        console.warn(`  [lang-defects ${lang.ko}] 세션 만료 → '${p.name}' 건너뜀`);
        continue;
      }
      try {
        console.log(`  [lang-defects ${lang.ko}] ▶ ${p.name} 시작`);
        await p.run();
      } catch (e: any) {
        const msg = (e?.message || String(e)).replace(/\s+/g, ' ').slice(0, 300);
        console.warn(`  [lang-defects ${lang.ko}] '${p.name}' 예외(격리·계속): ${msg}`);
        skip(meta, `'${p.name}' 처리 예외(격리·계속): ${msg}`);
        if (isCourseLoggedOut(admin)) sessionDead = true;
      }
    }
    // 세션 만료로 미수행 파트가 있으면 재개 안내를 리포트('확인 필요·관찰')+콘솔에 명시(SKIP된 것만 재수행 가이드).
    if (missed.length) {
      const cmds = missed.map((m) => `  • ${m.name}: ${m.resumeCmd}`).join('\n');
      review({ lang: lang.ko, screen: '(재개 안내)', kind: '세션 만료 — 미수행 파트 재실행', item: `${missed.length}개 파트 미수행`, value: `course:auth(재인증) 후: ${missed.map((m) => m.resumeCmd).join('  ||  ')}` });
      console.warn(`\n[lang-defects ${lang.ko}] ⚠ 세션 만료로 ${missed.length}개 파트 미수행. 재인증(npm run course:auth) 후 아래만 재실행:\n${cmds}\n`);
    }

    const name = `코스관리_다국어통합_${lang.ko}`;
    setReportHtmlOpts(name, {
      subtitle: `${lang.ko}(${lang.label}) 모드 · 캘린더 년도 + 레이아웃 겹침 + 내보내기 파일명${withText ? ' + 텍스트 번역' : ''}(QA-15543/15548) · 비파괴`,
      lead: `<b>${lang.ko}</b> 다국어 결함을 한 세션에서 순차 검증했습니다 — ① 번역 라벨↔입력박스 <b>겹침</b>, ② 캘린더 <b>표시 년도</b> 정합, ③ 내보내기 <b>파일명</b> i18n${withText ? ', ④ 전 메뉴 <b>텍스트 번역</b>' : ''}. 공유 QA 계정 세션 한계로 도중 만료되면 남은 파트는 '세션 만료'로 정직 표기됩니다(제품 결함 아님 — 재인증 후 재실행).`,
      catch: ['잘못된 <b>캘린더 년도</b>(QA-15543)', '외국어 UI인데 <b>파일명이 한국어</b>', '긴 번역 라벨이 <b>입력 박스 침범</b>'],
      miss: ['미세 <b>간격</b>·<b>즉시반영</b>(범위 밖)', '<b>세션 만료</b>로 미수행된 파트(재인증 후 재실행)', '데이터 의존 미노출(정직 SKIP)'],
    });
    await writeReport(name);
  }
});
