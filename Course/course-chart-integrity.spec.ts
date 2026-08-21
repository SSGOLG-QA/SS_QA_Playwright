import { test } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { runChartIntegrity } from '../lib/course/qualityBatteries';

// 차트 데이터 정합성 — Home 등급추세(스파크라인)를 공급 API(eval-init)로 검증(비파괴). 로직은 lib/course/qualityBatteries.ts.
// 실행: npm run course:auth 후 npm run course:chart-integrity

test('차트 데이터 정합성 — Home 등급추세 API(eval-init) 값↔원천 대조(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  await runChartIntegrity(admin);
  setReportHtmlOpts('코스관리_차트정합성', {
    subtitle: 'Home 등급추세 차트 데이터 정합성(공급 API eval-init) · 비파괴',
    lead: 'Home 등급추세 차트는 화면에 값이 없어(스파크라인), <b>차트에 데이터를 공급하는 API</b>를 받아 <b>등급 산출·추세·목표=화면카드</b>가 맞는지 검증했습니다.',
    catch: ['점수→등급 <b>매핑이 틀린</b> 경우', '추세 최신월 값이 <b>최신 평가와 다른</b> 경우', '목표 등급이 <b>화면 카드와 다른</b> 경우'],
    miss: ['차트의 <b>픽셀 렌더</b> 자체(값은 API로 검증)', '<b>입력 데이터 자체</b>가 틀린 경우'],
  });
  await writeReport('코스관리_차트정합성');
});
