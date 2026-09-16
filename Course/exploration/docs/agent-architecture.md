# 코스관리 PC — AI Exploratory Testing Agent 아키텍처 (Phase 3 설계)

> 전제: [existing-test-assets.md](./existing-test-assets.md)의 재사용 계층 위에 **탐색 오케스트레이션 계층만** 얹는다.
> 설계 원칙: 기존 `Course/` 회귀 무손상 · 신규는 `lib/course/exploration/`·`Course/exploration/`에 격리 · 세션 1런/로그인 · 비파괴 기본 + 파괴 옵트인 가드 · report-standard(정직 수치).
> 이 문서는 **설계(인터페이스·데이터흐름·의사코드)** 다. 구현은 Phase 4~(최소 슬라이스부터).

---

## 1. 큰 그림 — 단일 세션 오케스트레이터

세션 1런/로그인 제약 때문에 탐색 전체는 **하나의 Playwright test 안에서** 완결한다(어드민 all-suite와 동일 패턴).

```
Course/exploration/course-explore.spec.ts   (엔트리 — 얇은 래퍼)
  test('코스관리 PC 탐색', async ({ page }) => {
    resetResults/Review/Diff();
    const admin = await openCourseAdmin(page);          // 1회 로그인
    const budget = loadBudget();                        // env 오버라이드
    await runExplorer(admin, { budget, seeds });        // ← 오케스트레이터(lib/course/exploration/explorer.ts)
    await writeReport('코스관리_탐색');                  // 엑셀+HTML+history.db
  });
```

- Claude(작업자)는 라이브 실행 불가 → 사용자가 `npm run course:explore` 1회 실행, Claude는 `reports/코스관리_탐색_*.xlsx` + `Course/exploration/results/*.json`을 **exceljs 오프라인 판독**.
- 파괴 탐색은 `ALLOW_DESTRUCTIVE=1`일 때만(가드), 기본은 view-only.

---

## 2. 모듈 레이아웃 (`lib/course/exploration/`)

| 파일 | 책임 | 주 재사용 |
|---|---|---|
| `types.ts` | 핵심 타입(State·Transition·ActionCandidate·Finding·Candidate·Verdict·Budget) | — |
| `observe.ts` | `snapshotState(admin)` = 구조+텍스트+URL+businessState 통합 스냅샷, `stateKey()` 지문 | `dumpScreen`·`captureSlots`·`isCourseLoggedOut` |
| `frontier.ts` | 액션 후보 열거(버튼·전이맵·ScreenSpec)→미방문 필터 | `auditButtonCoverage`(열거부)·`COURSE_IA`·`course-transitions.json`·`ScreenSpec` |
| `risk.ts` | 후보별 Risk Score 계산(과거결함·미방문·데이터변경·API) | `past-defects.json` |
| `strategy.ts` | 시퀀스 후보 생성(repeat/refresh/back/offline/tab-dup/order-swap) | — |
| `oracles.ts` | Deterministic·Heuristic·Semantic 판정 → `Verdict` | `domain/*`·`withToastObserver`·`applySlotComparison` |
| `netfault.ts` | `page.route` 주입(4xx/5xx/지연/abort)+reload refetch 관측 | — |
| `observers.ts` | console/pageerror/network/dialog 훅(세션 상주) | Playwright 이벤트 |
| `graph.ts` | StateGraph(노드/엣지/미방문) + `results/state-graph.json` 영속 | — |
| `reproduce.ts` | 동일 세션 상태리셋 후 시퀀스 2회 재실행 → 재현성 분류 | `openCourseAdmin`·`gotoCourseMenu` |
| `candidate.ts` | Regression Candidate 산출(`candidates/`) + Jira key 연관 | `past-defects.json`·`capture` |
| `report.ts` | Finding→`record`/`review` 매핑, 요약 시트 옵션 | `reporter.*` |
| `safety.ts` | 파괴 게이트 + 마커 teardown + 액션 위험 분류 | `isCourseDestructiveAllowed`·`CRUD_MARK`·`deleteCourseMarkerRows` |
| `transitions.ts` | 전이맵 spec 내부 로직 추출/일반화(트리거→목적지 판별) | `course-transition-map/battery.spec` 로직 이식 |
| `explorer.ts` | **메인 루프**(관측→후보→Risk정렬→실행→오라클→기록→재현) + Budget | 위 전부 |

원 spec(`course-transition-*.spec.ts`)은 **유지**하고 로직만 `transitions.ts`로 추출(export화)한다.

---

## 3. 핵심 데이터 타입 (설계 스케치)

```ts
// types.ts (설계 — 구현 시 조정)
export type BusinessState =
  | '미작성' | '작성중' | '임시저장' | '저장' | '수정중'
  | '작업완료' | '완료확정' | '완료' | '조회' | '알수없음';

export interface ExplorerState {
  url: string;
  feature: string;           // COURSE_IA 대메뉴
  sub: string;               // 소메뉴/화면
  businessState: BusinessState;
  domSig: string;            // dumpScreen 요약 해시(btns/selects/tables/rows…)
  slotSig: string;           // captureSlots key+text 해시(텍스트 지문)
  actions: ActionCandidate[];// 이 상태에서 가능한 액션
}
export function stateKey(s: ExplorerState): string;  // `${feature}|${sub}|${businessState}|${domSig}`

export type ActionKind = 'view' | 'search' | 'filter' | 'sort' | 'date'
  | 'openModal' | 'nav' | 'tab' | 'input' | 'save' | 'submit' | 'delete' | 'reset';
export interface ActionCandidate {
  id: string;                // 안정 식별자
  kind: ActionKind;
  label: string;             // 버튼/컨트롤 텍스트
  destructive: boolean;      // 데이터 변경 여부(가드 필요)
  apiLikely: boolean;        // 요청 유발 가능성
  selector?: string;         // 실행 힌트(공백무시 텍스트 등)
  risk: number;              // risk.ts 산출
  reasons: string[];         // 우선순위 근거(과거결함 key 등)
}

export interface Transition { from: string; action: string; to: string; ts: string; }

export type FindingStatus = 'PASS' | 'FAIL' | 'ANOMALY' | 'NEEDS_REVIEW';
export interface Verdict { status: FindingStatus; oracle: 'det'|'heur'|'sem'; reason: string; evidence?: any; }
export interface Finding {
  id: string; screen: string; sequence: string[]; verdict: Verdict;
  jiraPattern?: string;      // past-defects 패턴 id
  jiraKeys?: string[];       // 연관 QA-152xx
  repro?: 'REPRODUCIBLE_ANOMALY' | 'FLAKY_OR_ENVIRONMENTAL' | 'not-checked';
  screenshot?: string; trace?: string;
}

export interface Budget {
  maxActionsPerSession: number;  // 기본 120
  maxDepth: number;              // 기본 4
  maxScenarios: number;          // 기본 30
  maxRepeatedAction: number;     // 기본 3
  maxExecutionMinutes: number;   // 기본 18
}
```

**status 매핑(정정 반영)**: 리포터 네이티브는 PASS/FAIL/SKIP뿐 → `Finding.verdict.status`가
`FAIL`이면 `record(meta,'FAIL',…)`, `PASS`면 `record(meta,'PASS')`,
`ANOMALY`/`NEEDS_REVIEW`면 `review({kind:status, screen, item:reason, value:evidence})`.
**AI Semantic(sem) 단독은 절대 FAIL 금지** → 항상 `ANOMALY`/`NEEDS_REVIEW`.

---

## 4. 관측: `snapshotState`

```
snapshotState(admin):
  if isCourseLoggedOut(admin): throw SessionExpired   // 조기중단(정직 SKIP)
  url  = admin.url()
  info = dumpScreen(admin)                             // 구조 벡터
  slots= captureSlots(admin)                           // 텍스트 지문
  bs   = inferBusinessState(info, slots)               // 배지/버튼으로 추론
  domSig  = hash(info.btns.sorted, info.tables, info.rows, info.heads.sorted)
  slotSig = hash(slots.map key+text)
  actions = frontier.enumerate(admin, info)            // 아래
  return {url, feature, sub, bs, domSig, slotSig, actions}
```

- **businessState 추론(`inferBusinessState`)**: 화면의 상태 배지/버튼 텍스트로 판정 — 예 `완료 확정` 버튼 노출=`저장`, `작업완료` 배지=`작업완료`, `임시저장` 버튼 활성=`작성중`. 규칙 테이블은 작업지시부터 시드(과거결함 QA-15368/15367 상태 어휘 활용).
- 동일 URL이라도 businessState/domSig가 다르면 **다른 상태**(프롬프트 요구).

---

## 5. 액션 후보 열거 + Risk 정렬

```
frontier.enumerate(admin, info):
  buttons = auditButtonCoverage.enumerate(admin)       // 표시 컨트롤 전수(내부 열거부 재사용)
  triggers= transitions.openishTriggers(admin)         // 전이맵 열기형 트리거
  catalog = ScreenSpec 매칭(현재 sub)                   // 선언형 후보
  merge/dedup → ActionCandidate[] (destructive/apiLikely 태깅: coverageAudit 정규식)

risk.score(action, state, pastDefects, graph):
  s  = base[action.kind]                               // view -1, save/submit/delete +3, openModal +1 …
  s += graph.isUnvisitedTransition(state, action) ? +3 : -2
  s += action.destructive ? +3 : 0
  s += action.apiLikely   ? +2 : 0
  s += pastDefects.matchBoost(state.feature, action)   // 동일 화면 과거결함 패턴 유사 +4 (완료=회귀위험)
  s -= graph.visitCount(state, action) * 1             // 반복 감쇠
  return s
```

- `pastDefects.matchBoost`: `past-defects.json`에서 `feature` 일치 + 패턴 트리거(상태변경/검색재진입/특수문자/순서/경계) 매칭 시 +4, 연관 `jiraKeys` 부착.
- 정렬: risk 내림차순, Budget 내에서 상위부터 실행. **Coverage가 아니라 결함 발견 가능성 우선.**

---

## 6. 시퀀스 전략 (`strategy.ts`)

단발 액션에 더해, 상태 변경 액션(save/submit)이 나오면 **시퀀스 후보**를 생성:

```
input→save→save        (중복요청/중복생성)
input→save→refresh      (저장 후 소실)      ← QA-15368류
input→save→back
input→refresh→save      (입력 중 새로고침)
input→submit→back→submit(재제출 중복)
input→save→edit→save    (재수정 순서)       ← QA-15311류
input→offline→save→online→save (netfault)
input→tabDup→A save→B save (멀티탭 덮어쓰기)
search set→leave→re-enter (검색 상태초기화)  ← QA-15334류
특수문자 {}[] 입력→save   (400)             ← QA-15350
```
- 각 시퀀스는 `maxScenarios`·`maxDepth` 예산 내. 파괴 포함 시퀀스는 가드 통과 시에만.

---

## 7. 오라클 (`oracles.ts`) → Verdict

| 계층 | 판정 예 | 재사용 | status |
|---|---|---|---|
| **Deterministic** | HTTP 4xx/5xx, console/pageerror, 저장 데이터, 토스트 분류, **domain 불변식**(비용=Σ·기말=기초+입고−출고·drilldown I1~I3) | `domain/*`·`withToastObserver`·`applySlotComparison`·observers | PASS/FAIL |
| **Heuristic** | 클릭 후 domSig/slotSig 무변화 · 동일 액션 중복 request · 성공 토스트인데 값 이전 그대로 · 예상외 nav · 비정상 지연 | observers·snapshot 델타 | ANOMALY |
| **AI Semantic** | 상태·이전상태·액션·네트워크 종합해 UX/업무 이상 서술 | 구조화 기록만 | ANOMALY / NEEDS_REVIEW |

- Deterministic 통과 시 곧장 FAIL 가능. Heuristic/Semantic은 **Finding(ANOMALY)** 로만 → 재현 단계로.
- 모든 Verdict에 evidence(스크린샷·trace·네트워크·전후 스냅샷 델타) 첨부.

---

## 8. 네트워크 오라클 (`netfault.ts`) — thick-client 대응

```
withNetFault(admin, patternRe, mode, action):
  route = admin.route(patternRe, r =>
     mode==='status4xx' ? r.fulfill({status:400, body:'{}'})
   : mode==='status5xx' ? r.fulfill({status:500})
   : mode==='delay'     ? setTimeout(()=>r.continue(), 6000)
   : mode==='abort'     ? r.abort()
   : r.continue())
  await action()                    // [조회]/[검색]/[저장]/[제출] or admin.reload() (비파괴 refetch)
  observe: UI가 에러/스피너/무한로딩/미처리 예외를 어떻게 다루는지 → Verdict
  unroute()
```
- "요청 0건"은 SKIP(가짜 FAIL 금지). reload는 비파괴 refetch 유발용.

---

## 9. 상태그래프 (`graph.ts`)

- 노드=`stateKey`, 엣지=`Transition{from,action,to}`. `unvisited(state)`=아직 안 밟은 (state,action).
- 영속: `Course/exploration/results/state-graph.json` `{nodes:[...], edges:[...], meta}`.
- 탐색은 미방문 프론티어를 risk 우선으로 소진(Budget 한도).

---

## 10. 재현 & 후보 (`reproduce.ts` / `candidate.ts`)

- **재현(세션 내, 재로그인 금지)**: Finding의 시퀀스를 `openCourseAdmin` 재진입 or `gotoCourseMenu`+`page.reload`로 seed 리셋 후 **2회 재실행**. 2회 모두 동일 이상 → `REPRODUCIBLE_ANOMALY`, 아니면 `FLAKY_OR_ENVIRONMENTAL`.
- **후보 산출**: `REPRODUCIBLE_ANOMALY`만 `Course/exploration/candidates/<id>.md`(+`.json`) 생성 — Title·Feature·Precondition·Sequence·Expected·Actual·ReproCount·Screenshot·Trace·Network·Console·Risk·연관 Jira key·추천 Regression Test. **기존 `Course/`에 자동 merge 금지**(사람 검토 후 승격).

---

## 11. 안전 (`safety.ts`)

```
runAction(admin, action):
  if action.destructive:
     g = await isCourseDestructiveAllowed(admin)
     if !g.ok: review({kind:'SKIP', item:`파괴 액션 비허용: ${g.why}`}); return 'gated'
     mark로 식별 가능한 입력만(CRUD_MARK) → 실행 → finally deleteCourseMarkerRows()
  else: 실행(비파괴)
```
- 절대 자동 금지: 결제·대량삭제·계정삭제·운영데이터·외부발송·복구불가. host≠course-mng-td 또는 클럽≠킹즈락이면 파괴 전면 차단(가드가 처리). credential 하드코딩 금지(storageState 사용).

---

## 12. 산출물

| 산출 | 경로 |
|---|---|
| 엑셀/HTML/이력 | `reports/코스관리_탐색_*.xlsx` · `Course/monocart-report/` · `reports/history.db` |
| 상태그래프 | `Course/exploration/results/state-graph.json` |
| 세션 로그 | `Course/exploration/results/session-<ts>.json`(액션이력·관측·네트워크 요약) |
| 결함 후보 | `Course/exploration/candidates/<id>.{md,json}` |
| 과거결함 KB | `Course/exploration/knowledge/past-defects.json`(기존) |

**리포트 시트**: 기존 요약/이슈/커버리지/SKIP/diff/review에 더해, 탐색 결과는 `record`(FAIL/PASS/SKIP)·`review`(ANOMALY/NEEDS_REVIEW·상태그래프 요약)로 자연 편입.

---

## 13. 탐색 루프 (의사코드, `explorer.ts`)

```
runExplorer(admin, {budget, seeds}):
  observers.attach(admin)                 // console/pageerror/network/dialog
  graph = new StateGraph()
  pastDefects = load('knowledge/past-defects.json')
  actions=0; t0=now()
  frontier = seeds.map(gotoAndSnapshot)   // 예: 작업 지시

  while frontier.nonEmpty && actions<budget.max && minutes<budget.maxExecutionMinutes:
    state = frontier.popHighestRisk()
    graph.addState(state)
    cands = risk.rank(state.actions, state, pastDefects, graph)
    for a in cands (budget.maxDepth 내):
      if isCourseLoggedOut(admin): record SKIP('세션만료'); break
      before = state
      res = safety.runAction(admin, a)     // 비파괴/가드
      if res=='gated': continue
      after = snapshotState(admin)
      graph.addTransition(before, a, after)
      v = oracles.evaluate(before, a, after, observers.drain())
      if v.status in {FAIL, ANOMALY, NEEDS_REVIEW}:
        f = makeFinding(before, a, after, v, pastDefects)
        if v.oracle!='det':                // 이상은 재현 확인
          f.repro = reproduce(admin, f.sequence)   // 세션 내 2회
        report.emit(f)                      // record/review
        if f.repro=='REPRODUCIBLE_ANOMALY': candidate.write(f)
      // 시퀀스 전략: 상태변경 액션이면 strategy 후보를 frontier에 주입
      if a.kind in {save,submit}: frontier.push(strategy.generate(state, a))
      if after.isNew: frontier.push(after)
      actions++
    recover(admin)                          // 오버레이 정리·seed 재진입(캐스케이드 방지)
  graph.persist('results/state-graph.json')
```

---

## 14. Phase 4 최소 슬라이스(MVP) 정의

**범위(1런 안, 비파괴, view-only)**: 작업 지시 1개 화면에서
1. `openCourseAdmin`→`gotoCourseMenu('작업 관리','작업 지시')`
2. `snapshotState`(dumpScreen+captureSlots+businessState 추론) 1회
3. `frontier.enumerate` + `auditButtonCoverage`로 액션 후보 열거(destructive/apiLikely 태깅만, 실행은 view류만)
4. view류 액션 몇 개 실행 → 전후 `snapshotState` 델타 → Heuristic(무변화) 관측
5. `graph` 노드/엣지 1~2개 + `state-graph.json` 기록
6. `writeReport('코스관리_탐색')` + `results/` 산출

**수용 기준(성공기준 §16 정합)**: 기존 자산(진입·dumpScreen·captureSlots·auditButtonCoverage·reporter) 재사용 확인 / 기존 회귀 무손상 / 상태 인식(businessState 1개↑ 분류) / 액션 후보 열거(≥5) / 전후 델타 관측 1건 / state-graph.json 생성 / **데이터 변경 0**(가드 미사용).
**아직 안 함**: Risk 전체·시퀀스·netfault·재현·후보(Phase 5~10).

---

## 15. 리스크 & 오픈 이슈 (설계 시점)

- **businessState 추론 정확도**: 화면별 상태 어휘가 달라 규칙 테이블을 화면별로 시드해야 함(작업지시부터). 오추론 시 상태 폭발 → domSig로 완화.
- **전이맵 로직 추출**: spec 내부 함수 이식 시 원 spec 회귀 깨지지 않게 **export 추가만**(동작 불변) 후 spec이 이식 함수를 호출하도록 리팩터(선택).
- **세션 예산**: 1런 제약상 maxActions 보수적. 재현 2회가 예산을 크게 먹으므로 **ANOMALY만 재현**(FAIL은 결정론이라 재현 불필요).
- **오버레이 캐스케이드**: 각 상태 소진 후 `recover()`(killAlarms+seed 재진입)로 차단(모바일 다국어에서 검증된 하드리셋 패턴 이식).
