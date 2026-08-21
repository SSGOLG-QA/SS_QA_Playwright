import { test } from '@playwright/test';
import { openCourseAdmin, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { runControlBattery, runChartIntegrity, runFigmaCheckText, menusFilterFromEnv } from '../lib/course/qualityBatteries';

// ──────────────────────────────────────────────────────────────
//  품질 통합 스위트 — 컨트롤 배터리 + 차트 정합성 + Figma 문구 검증을 단일 로그인으로 순차 실행.
//  실행: npm run course:auth 후 npm run course:quality
//  ⚠ "1로그인 1런" 제약 → 3개 배터리를 각각 돌리면 로그인 3번 필요하지만, 이 스위트는 openCourseAdmin 1회로 전부 수행.
//  결과: reports/코스관리_품질통합_report_*.xlsx + .html(예산·비용/HOME과 동일 2-tier 표준).
//  전부 비파괴(조회·탭 전환·API 조회만).
// ──────────────────────────────────────────────────────────────

test('품질 통합 — 컨트롤·차트·Figma문구 (단일 로그인)', async ({ page, context }) => {
  test.setTimeout(1_500_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const mf = menusFilterFromEnv();

  // 차트(Home 재로드) → 컨트롤 → Figma 순. 차트가 Home 재로드로 세션 프리페치를 살리므로 먼저 수행.
  console.log('\n═══ [1/3] 차트 데이터 정합성 ═══');
  await runChartIntegrity(admin).catch((e) => console.warn('[quality] chart 실패(계속):', e?.message || e));
  await killAlarms(admin);
  console.log('\n═══ [2/3] 컨트롤 배터리 ═══');
  await runControlBattery(admin, mf).catch((e) => console.warn('[quality] control 실패(계속):', e?.message || e));
  await killAlarms(admin);
  console.log('\n═══ [3/3] Figma 설계 문구 ═══');
  await runFigmaCheckText(admin, mf).catch((e) => console.warn('[quality] figma 실패(계속):', e?.message || e));
  await killAlarms(admin);

  setReportHtmlOpts('코스관리_품질통합', {
    subtitle: '컨트롤 노출 + 차트 데이터 정합성 + 설계 문구 — 단일 로그인 통합 · 비파괴',
    lead: '코스관리 화면 품질을 <b>세 가지</b>로 한 번에 확인했습니다 — <b>① 컨트롤 노출</b>(버튼·달력·이미지 등) · <b>② 홈 차트 데이터 정합성</b>(공급 API) · <b>③ 설계(Figma) 문구</b>의 화면 존재.',
    catch: ['컨트롤·설계문구가 <b>빠지거나 바뀐</b> 표시 회귀', '홈 차트의 <b>점수→등급 매핑·추세·목표=카드</b> 불일치'],
    miss: ['버튼 <b>클릭 동작</b>·차트 <b>픽셀 렌더</b>(존재/데이터만 확인)', '탭/데이터 없어 <b>지금 안 뜨는</b> 항목(참고로 분리)', '<b>입력 데이터 자체</b> 오류'],
  });
  await writeReport('코스관리_품질통합');
});
