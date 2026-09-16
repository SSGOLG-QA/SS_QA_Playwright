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
    subtitle: 'AI Exploratory Agent · 비파괴 · 관측 + Risk 선택 + 이상 탐지 + 재현(세션내 2회)',
    lead: '시드 화면을 진입해 <b>구조(dumpScreen)+텍스트지문(captureSlots)+businessState</b>를 관측하고, <b>열기형 트리거</b>(상세·등록·설정)를 클릭해 모달/페이지/새탭 서브상태로 진입한 뒤 그 상태의 구성요소를 관측·기록합니다. 이상 Finding은 <b>재로그인 없이 세션 내 2회 재실행</b>해 <b>REPRODUCIBLE / FLAKY</b>로 분류합니다. 저장/삭제/제출 등 <b>커밋은 실행하지 않습니다</b>(모달=취소·페이지=뒤로·새탭=닫기 복귀).',
    catch: ['상태 전이(조회→작성중 등) 및 서브상태 구성요소', '전이 중 <b>런타임 이상</b>(JS예외·4xx/5xx·요청실패·dialog)·예상외 nav·모달 교착·반복 비멱등', '이상 Finding <b>재현성 분류</b>(2회 모두 재현=REPRODUCIBLE)'],
    miss: ['커밋(저장/삭제/제출) 미실행 — netfault/파괴 시퀀스는 후속', '후보 산출(candidates)은 Phase 10', '세션 만료 시 정직 SKIP(1런/로그인)'],
  });
  await writeReport(name);
});
