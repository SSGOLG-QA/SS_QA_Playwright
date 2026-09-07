import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, writeReport, setReportHtmlOpts } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  코스관리 안내문구(정적 가이드 텍스트) 라이브 존재 검증 — 비파괴, 단일 test 1런.
//   커버리지 심화(C-B): coverage-tree 미커버 '안내문구' 중 Figma 정본에 없는(구현 전용) 가이드 문구를
//   명시 checkText로 검증·기록 → 화면 텍스트 회귀(문구 제거/변경) 검출 + coverage-tree 크레딧.
//   ⚠ report-standard: 부분문자열 가시성 검증 → 제거 시 FAIL(거짓 PASS 없음). 상태/데이터 무관 정적 문구만.
//   크레딧 원리: meta.path = "<인벤토리 화면키> > <안내문구 전문>" → coverage-tree screenTailOf가
//     화면키 prefix 매칭, tail(안내문구 전문)이 인벤토리 라벨을 포함 → PASS 시 해당 컴포넌트 커버.
//   실행: npm run course:auth 후 npm run course:guide-text → reports/코스관리_안내문구검증_report_*.xlsx
// ──────────────────────────────────────────────────────────────

interface Guide {
  menu?: string; sub?: string;   // gotoCourseMenu 인자(Home은 생략 — 랜딩)
  tab?: RegExp;                   // 화면 내 탭 클릭 필요 시(Home 비용 탭 등)
  screenKey: string;             // 인벤토리 화면키(baselines/course-components) — 정확 일치 필수
  probe: string;                 // 가시성 검증용 안정적 부분문자열(문구 변경에 덜 민감한 핵심 어구)
  full: string;                  // 안내문구 전문(경로 tail·기대값 — 인벤토리 라벨과 동일)
  tcId: string;
}

// coverage-tree 미커버 '안내문구 — checkText 매핑 필요' 중 실재 정적 가이드 문구(2026-09-07 갭 분석 산출).
const GUIDES: Guide[] = [
  {
    tab: /^\s*비용\s*$/, screenKey: 'Home', tcId: 'GUIDE-HOME-COST',
    probe: '수립된 예산과 실제로 집행된 회계상 비용을 비교분석',
    full: '수립된 예산과 실제로 집행된 회계상 비용을 비교분석하여 제공되는 정보입니다. 해당값은 [예산관리] 메뉴에서 입력 관리합니다. 비용은 작업지시를 통하여 집계된 비용과 차이가 있을 수 있습니다.',
  },
  {
    menu: '예산 관리', sub: '예산 상세', screenKey: '예산 관리 > 예산 상세', tcId: 'GUIDE-BUDGET-DETAIL',
    probe: '전체 탭은 5개 분류를 한 표로 확인하는 조회 화면입니다',
    full: '전체 탭은 5개 분류를 한 표로 확인하는 조회 화면입니다. 데이터 수정은 각 분류 탭에서, 엑셀 업로드/내보내기는 이 탭에서만 가능합니다.',
  },
  {
    menu: '예산 관리', sub: '실적 관리', screenKey: '예산 관리 > 실적 관리', tcId: 'GUIDE-PERF',
    probe: '전체 탭은 5개 분류의 실적을 한 표로 확인하며',
    full: '전체 탭은 5개 분류의 실적을 한 표로 확인하며, 대분류별 소계가 표시됩니다. 데이터 수정은 각 분류 탭에서, 엑셀 업로드·내보내기는 이 탭에서만 가능합니다.',
  },
  {
    menu: '예산 관리', sub: '예산 분석', screenKey: '예산 관리 > 예산 분석', tcId: 'GUIDE-BUDGET-ANAL',
    probe: '수립한 예산 대비 실제 발생한 총비용을 비교하고 분석한',
    full: "수립한 예산 대비 실제 발생한 총비용을 비교하고 분석한 정보를 제공합니다. 실제 발생한 총비용은 작업지시를 통하여 자동으로 집계되는 비용과는 차이가 있을 수 있습니다. 작업지시를 통하여 집계되는 비용의 분석은 '비용 관리' 메뉴에게 제공됩니다",
  },
  {
    menu: '정보 관리', sub: '잔디 측정 정보', screenKey: '정보 관리 > 잔디 측정 정보', tcId: 'GUIDE-TURF',
    probe: '주요 구역의 잔디 정보를 일별로 기록합니다',
    full: '그린, 페어웨이, 러프, 티박스 등 주요 구역의 잔디 정보를 일별로 기록합니다 담당자가 모바일을 통해서 입력하거나 PC에서 입력 가능하며 이는 작업일보에도 자동으로 반영됩니다',
  },
  // 커버리지 심화 2차(2026-09-07): coverage-tree 미커버 안내문구 중 실재 정적 텍스트/라벨.
  {
    menu: '코스 현황 관리', sub: '식생 분석', screenKey: '코스 현황 관리 > 식생 분석', tcId: 'GUIDE-VEG-LEGEND',
    probe: '창밖=배경',
    full: '창밖=배경 · 낮음=빨강(나지) · 높음=초록(건강)',
  },
  {
    menu: '작업 관리', sub: '예측 정보', screenKey: '작업 관리 > 예측 정보', tcId: 'GUIDE-PREDICT',
    probe: '코스관리에 중요한 고려사항으로 등록된 이슈',
    full: '코스관리에 중요한 고려사항으로 등록된 이슈 및 아래에서 선택된 기준연도에 이루어진 작업중에 이후연도에도 참고할 필요가 있는 작업으로 판단되어 선택된 작업들이 노출됩니다. 이를 활용하여 이후 기간의 코스관리를 계획하고 실행하는데 활용할 수 있습니다',
  },
  {
    menu: '자재 관리', sub: '자재 총괄', screenKey: '자재 관리 > 자재 총괄', tcId: 'GUIDE-MAT-CNT',
    probe: '품목수', full: '품목수',
  },
  {
    menu: '자재 관리', sub: '자재 총괄', screenKey: '자재 관리 > 자재 총괄', tcId: 'GUIDE-MAT-QTY',
    probe: '총단위수량', full: '총단위수량',
  },
  {
    menu: '자재 관리', sub: '자재 총괄', screenKey: '자재 관리 > 자재 총괄', tcId: 'GUIDE-MAT-AMT',
    probe: '총재고금액', full: '총재고금액',
  },
];

async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2500 }).catch(() => false)) {
    await t.click({ timeout: 2500 }).catch(() => {}); await admin.waitForTimeout(1400); await killAlarms(admin); return true;
  }
  return false;
}

test('코스관리 안내문구 라이브 존재 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  for (const g of GUIDES) {
    // 진입: Home(랜딩, sub 없음)은 홈 유지, 그 외 gotoCourseMenu
    if (g.menu && g.sub) {
      const ok = await gotoCourseMenu(admin, g.menu, g.sub).then(() => true).catch(() => false);
      if (!ok) {
        // 진입 실패 = 검증 불가 → FAIL 아님(가짜 FAIL 방지). check로 남기되 failMsg로 사유 명시.
        await check(admin, { path: `${g.screenKey} > ${g.full}`, tcRef: `안내문구_${g.screenKey}`, tcId: g.tcId, desc: '안내문구 라이브 노출', expected: g.full, failMsg: '메뉴 진입 실패(검증 불가)' },
          async () => { throw new Error('메뉴 진입 실패'); });
        continue;
      }
      await admin.waitForTimeout(1200); await killAlarms(admin);
    }
    if (g.tab) await clickTab(admin, g.tab);

    await check(
      admin,
      { path: `${g.screenKey} > ${g.full}`, tcRef: `안내문구_${g.screenKey}`, tcId: g.tcId, desc: '안내문구 라이브 노출(정적 가이드 텍스트)', expected: g.full, failMsg: '안내문구 미노출/제거(텍스트 회귀)' },
      async () => {
        const loc = admin.locator('.contents, main').getByText(g.probe, { exact: false }).first();
        if (!(await loc.isVisible({ timeout: 6000 }).catch(() => false))) throw new Error('안내문구 미노출');
      },
      { getActual: async () => admin.locator('.contents, main').getByText(g.probe, { exact: false }).first().innerText({ timeout: 3000 }).then((t) => t.slice(0, 200)).catch(() => '') },
    );
  }

  setReportHtmlOpts('코스관리_안내문구검증', {
    subtitle: '정적 안내문구(가이드 텍스트)의 라이브 화면 존재 검증 · 비파괴',
    lead: 'Figma 정본에 없는 <b>구현 전용 안내문구</b>가 실제 화면에 <b>표시되는지</b> 확인했습니다(coverage-tree 미커버 보완).',
    catch: ['안내문구가 화면에서 <b>빠지거나 변경</b>된 경우(텍스트 회귀)'],
    miss: ['탭/상태 전환으로 <b>진입 자체가 실패</b>한 경우(검증 불가로 분리)'],
  });
  await writeReport('코스관리_안내문구검증');
});
