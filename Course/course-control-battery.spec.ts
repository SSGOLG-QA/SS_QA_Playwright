import { test } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../lib/reporter';
import { runControlBattery, menusFilterFromEnv } from '../lib/course/qualityBatteries';

// 컨트롤 배터리 — nav·달력·이미지·드롭·필터칩 라이브 존재 검증(비파괴). 로직은 lib/course/qualityBatteries.ts.
// 실행: npm run course:auth 후 npm run course:control-battery

test('컨트롤 배터리 — nav·달력·이미지·드롭·필터칩 라이브 존재 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  await runControlBattery(admin, menusFilterFromEnv());
  setReportHtmlOpts('코스관리_컨트롤배터리', {
    subtitle: '화면 컨트롤(버튼·달력·이미지·드롭·컬럼·입력) 라이브 노출 검증 · 비파괴',
    lead: '각 화면의 <b>버튼·달력·이미지·드롭다운·필터칩</b> 등 컨트롤이 실제로 <b>노출되는지</b> 확인했습니다.',
    catch: ['컨트롤이 <b>사라지거나 안 보이는</b> 회귀', '화면·탭 전환 시 <b>요소 누락</b>'],
    miss: ['버튼을 <b>눌렀을 때의 동작</b>(존재만 확인, 클릭 안 함)', '데이터가 없어 <b>안 뜨는</b> 컨트롤(참고로 분리)'],
  });
  await writeReport('코스관리_컨트롤배터리');
});
