import { test } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { runFigmaCheckText, menusFilterFromEnv } from '../lib/course/qualityBatteries';

// Figma 설계 문구 checkText 검증 — 설계 정본 문구가 라이브 화면에 실재하는지(비파괴). 로직은 lib/course/qualityBatteries.ts.
// 실행: npm run course:auth 후 npm run course:figma-checktext

test('Figma 설계 문구 checkText 검증 — 정적 UI 텍스트 라이브 존재(비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  await runFigmaCheckText(admin, menusFilterFromEnv());
  setReportHtmlOpts('코스관리_Figma문구검증', {
    subtitle: 'Figma 설계 정본 문구의 라이브 화면 존재 검증 · 비파괴',
    lead: '설계서(Figma)에 정의된 <b>안내문구·라벨·제목</b>이 실제 화면에 <b>그대로 표시되는지</b> 확인했습니다.',
    catch: ['설계 문구가 화면에서 <b>빠지거나 바뀐</b> 경우(표시 회귀)'],
    miss: ['탭/상태에 따라 <b>지금 화면에 안 뜨는</b> 문구(참고로 분리)', '설계-구현 <b>문구 미세 차이</b>(공백·표기)'],
  });
  await writeReport('코스관리_Figma문구검증');
});
