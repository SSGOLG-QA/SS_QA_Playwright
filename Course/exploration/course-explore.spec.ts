import { test } from '@playwright/test';
import { openCourseAdmin } from '../../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, writeReport, setReportHtmlOpts } from '../../lib/reporter';
import { runExplorer, type Seed } from '../../lib/course/exploration/explorer';
import { loadBudget } from '../../lib/course/exploration/types';

// ──────────────────────────────────────────────────────────────
//  코스관리 PC — AI Exploratory Testing Agent (Phase 4 MVP)
//   범위: 비파괴 view-only. 시드 화면 진입 → 관측(dumpScreen+captureSlots+businessState) →
//         view류 액션 실행 → 전후 델타(무변화=ANOMALY) → 상태그래프(results/state-graph.json).
//   ⚠ 데이터 변경 0(파괴 가드 미사용). Risk 전체·시퀀스·netfault·재현·후보는 Phase 5~10.
//   실행(세션 1런/로그인): npm run course:explore  →  reports/코스관리_탐색_*.xlsx + results/state-graph.json
//   예산 오버라이드: $env:EXPLORE_MAX_ACTIONS / EXPLORE_MAX_DEPTH / EXPLORE_MAX_MIN …
//   ⚙ opt-in 확장(디폴트 미실행):
//     · netfault(비파괴 API 장애주입): $env:EXPLORE_NETFAULT="1" [; $env:EXPLORE_NETFAULT_STATUS="503"]
//     · 파괴 커밋(가드: 킹즈락+마커 teardown): $env:ALLOW_DESTRUCTIVE="1" [; $env:EXPLORE_COMMIT_MAX="3"]
// ──────────────────────────────────────────────────────────────

// 시드 — 과거결함(QA-15289 PC) **hotspot** 중 폼/리스트 화면(열기형 트리거 풍부).
//   ⚠ 지도/시각화(코스 모니터·식생·3D·그린·영역설정·드론)는 제외 — 트리거 탐색 부적합·행오버/렌더 리스크.
//   결함밀집: 작업지시45·정보관리38·이슈관리26·장비총괄17·자재총괄11. Risk 선택이 화면 내 우선순위를 재정렬.
const SEEDS: Seed[] = [
  { feature: '작업 관리', sub: '작업 지시' },      // 45건 — 최대 hotspot(등록폼·상세 모달)
  { feature: '작업 관리', sub: '이슈 관리' },      // 26건 — 리스트+등록/보기 모달
  { feature: '정보 관리', sub: '코스 기본 정보' },  // 정보관리(38) — 폼/조회
  { feature: '정보 관리', sub: '발병 정보' },       // 정보관리 write hotspot(등록 모달)
  { feature: '장비 관리', sub: '장비 총괄' },       // 17건 — 리스트+상세
  { feature: '자재 관리', sub: '자재 총괄' },       // 11건 — 리스트+상세
];

test('코스관리 PC 탐색 (관측·전이·서브상태 확장, 비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  await runExplorer(admin, { budget: loadBudget(), seeds: SEEDS, context });
  const name = '코스관리_탐색';
  setReportHtmlOpts(name, {
    subtitle: 'AI Exploratory Agent · 관측 + Risk 선택 + 이상 탐지 + 재현 + 후보 + (opt-in) netfault·파괴 커밋',
    lead: '시드 화면을 진입해 <b>구조+텍스트지문+businessState</b>를 관측하고 <b>열기형 트리거</b>로 서브상태에 진입해 이상을 탐지, <b>세션 내 2회 재실행</b>으로 REPRODUCIBLE/FLAKY 분류 후 재현확정분을 <b>결함 후보</b>로 산출합니다. opt-in 시 <b>API 장애 주입(netfault·비파괴)</b>과 <b>가드 하 파괴 커밋(마커+teardown)</b>도 수행합니다.',
    catch: ['상태 전이·서브상태 · 런타임 이상(JS예외·4xx/5xx·dialog)·예상외 nav·모달 교착·반복 비멱등', 'API 장애(4xx/5xx) 시 <b>uncaught 예외/무음 백지</b>(netfault, EXPLORE_NETFAULT=1)', '저장 <b>미반영/무동작/런타임예외</b>(파괴 커밋, ALLOW_DESTRUCTIVE=1)', '이상 <b>재현성 분류</b> + REPRODUCIBLE → 후보 산출'],
    miss: ['netfault/파괴 커밋은 <b>opt-in</b>(미설정 시 미실행) — 파괴는 3중 가드(킹즈락) + 마커 teardown 잔여0', '미완성 폼(vue-select/datepicker 필수)은 제출 비활성 → 무커밋 SKIP', '세션 만료 시 정직 SKIP(1런/로그인)'],
  });
  await writeReport(name);
});
