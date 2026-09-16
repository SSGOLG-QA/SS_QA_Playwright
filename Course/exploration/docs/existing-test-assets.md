# 코스관리 PC — 기존 테스트 자산 분석 (Exploratory Agent 착수 전 조사)

> 목적: 코스관리 PC(`https://course-mng-td.smartscore.kr`, 킹즈락)용 **AI Exploratory Testing Agent** 구축에 앞서, 기존 Playwright 자산을 실측 매핑한다.
> 원칙: **새 프레임워크를 처음부터 만들지 않는다.** 아래 재사용 계층 위에 탐색 로직만 얹는다.
> 조사일: 2026-09-16 · 대상 범위: 코스관리 **PC 데스크톱**만(td17 어드민·코스 모바일 `/mobile/` 제외).

---

## 0. 프롬프트 대비 실측 정정 (설계 반영 필수)

| 프롬프트 기술 | 실측 |
|---|---|
| `isCourseLoggedOut` ∈ `lib/langCheck.ts` | ❌ 실제는 **`lib/course/courseHelpers.ts:111`** |
| `captureSlots` ∈ `lib/langCheck.ts` | ✅ 맞음(`lib/langCheck.ts:263`) |
| `withFixture(setup,body,teardown)` (코스) | ❌ **코스엔 없음.** `withFixture`는 `Playwright_New/destructive.ts`(admin 전용). 코스 teardown = **`CRUD_MARK`(`E2ECRUD발병`) + `deleteCourseMarkerRows(page,mark,max)`** 마커행 삭제 |
| 리포터 status `ANOMALY / NEEDS_REVIEW` | ❌ 네이티브 status는 **`PASS/FAIL/SKIP`만**. → ANOMALY·NEEDS_REVIEW는 **`review()`**(관찰 시트)로 기록하고, **결정론적 결함만 `record(...,'FAIL')`**. (report-standard 정합: AI Semantic 단독 FAIL 금지) |
| `admin.reload()` | 메서드는 `page.reload()`. 변수명은 스펙마다 `admin`/`page` 혼용(둘 다 `Page`) |

---

## 1. 현재 코스관리 PC 테스트 구조

```
Course/                       # 스펙(테스트) — 코스 전용 config로 구동
  playwright.config.ts        # project 'course', testDir=ROOT, workers:1, fullyParallel:false,
                              #   retries: CI?1:0, trace:'retain-on-failure', monocart-report
  course-*.spec.ts            # 회귀/검증 스펙 ~130개(예산·비용·HOME·다국어·위치필터·내보내기·작업지시·장비/자재/시설·상태전이…)
  _probe-*.spec.ts            # 일회성 구조 프로브(DOM 덤프) ~50개
  exploration/                # ★ 신규 탐색 산출물 루트(이번에 신설)
    docs/ results/ candidates/ knowledge/(past-defects.json 존재)
lib/course/                   # 코스 헬퍼/도메인(재사용 핵심)
  courseHelpers.ts  courseSuites.ts  deepScreenE2E.ts  screenBattery.ts
  qualityBatteries.ts  coverageAudit.ts  destructive.ts  workorderHelpers.ts
  assetHelpers.ts  locationFilter.ts  graphCards.ts  exportVerifyCommon.ts
  budgetExportVerify.ts  costExportVerify.ts  costHierarchy.ts  langPolicy.ts …
  domain/  invariants.ts  homeCostDrilldown.ts  budgetAnalysis.ts  budgetCost.ts
           budgetReconcile.ts  gradeEval.ts  graphCardRollup.ts   # 순수 계산 오라클(DOM 무관)
lib/
  reporter.ts                 # 검증 기록·엑셀/HTML/history.db 리포트 파이프라인
  langCheck.ts                # captureSlots·applySlotComparison·withToastObserver·classifyToastText
auth/
  course.setup.ts             # 코스 PC 인증(headed 수동) → auth/.auth/course.json
baselines/                    # 인벤토리·전이맵·Figma 문구 committed 기준선
  course-components*.json  course-transitions.<sub>.json  course-figma-texts…
reports/                      # *.xlsx + monocart HTML + history.db
```

**실행/세션**
- 인증: `npm run course:auth`(project `course-setup`, headed 수동 로그인) → `auth/.auth/course.json`.
- 실행: `playwright test --config=Course/playwright.config.ts --project=course <spec> --no-deps`. `course:*` npm 스크립트 다수(예 `course:smoke`/`course:suite`/`course:cost`/`course:workorder-write`…).
- **세션 1런/로그인 제약** → config가 이미 `workers:1`·`fullyParallel:false`로 직렬 강제(정합).
- 타입 게이트: `npm run typecheck`(`tsconfig.typecheck.json`).

**IA(탐색 프론티어 시드)**: `COURSE_IA` = **11 대메뉴 / 45 소메뉴** — Home · 코스 현황 관리 · 정보 관리 · 사진 관리 · 작업 관리 · 예산 관리 · 비용 관리 · 인력 관리 · 장비 관리 · 자재 관리 · 시설 관리.

---

## 2. 재사용 가능 모듈 (탐색 4축 = 진입·관측·전이·기록)

| 축 | 모듈 · export | 시그니처 | 탐색에서의 역할 |
|---|---|---|---|
| **진입/구동** | `courseHelpers.openCourseAdmin` | `(page,ctx?)→Page` | 세션 재사용 진입 + navReady 폴링 + degraded fail-fast |
| | `courseHelpers.gotoCourseMenu` | `(page,parent,child?)→bool` | killAlarms+navigateMenu **네비 원자연산** |
| | `courseHelpers.killAlarms` | `(page)→number` | 알림/dim 오버레이 제거(매 액션 후) |
| | `courseHelpers.isCourseLoggedOut` | `(page)→bool` | **런 중 세션만료 감지**(조기중단·오분류 방지) |
| | `courseHelpers.COURSE_IA` | `CourseMenu[]` | 화면 노드 열거 = **상태그래프 프론티어 시드** |
| | `courseHelpers.pickCourseDate/setCourseDateRange/setCourseOneYear` | | 달력 입력(fill 금지, range=수동타이핑→적용) |
| **관측(State)** | `screenBattery.dumpScreen` | `(admin)→ScreenInfo{btns,selects,vsels,dps,tables,rows,searchInp,heads}` | **화면→컴포넌트 벡터 요약**(상태 특징 추출기) |
| | `langCheck.captureSlots` | `(admin)→Slot[]{key=domPath,zone,text,clip,ell}` | **화면 텍스트 지문/스냅샷**(전이 전후 델타·중복상태 감지) |
| | `langCheck.withToastObserver` | `(admin,action)→string[]` | **액션 부수효과(토스트/알림) 포착**(MutationObserver 선설치) |
| **액션/전이** | `coverageAudit.auditButtonCoverage` | `(admin,P,tcRef,tcId,opts?)` | **표시 버튼 전수 열거→handled/파괴/프레임워크/미처리 분류**(=액션 프론티어+감사). 내부 정규식=코스 액션 어휘 사전 |
| | `deepScreenE2E.tabSweep` | `(admin,DeepScreenOpts)` | **탭 자동감지+순회**(활성전환·콘텐츠 델타) = 상태전이 검증 |
| | `deepScreenE2E.runDeepScreenE2E` | `(admin,opts)` | 탭→수정폼→재진입→신규폼(라디오·저장활성) 비파괴 |
| | `screenBattery.runScreenBattery` | `(admin,P,key,refBase)` | list/search/date/filter/sort/view/edit/register/reset/preset/export 12종 비파괴 |
| | `courseSuites.ScreenSpec`/`runCourseScreen(s)` | 선언형 DSL | **화면별 "만질 수 있는 것" 카탈로그**(COURSE_*_SPECS) |
| | `courseSuites.checkRowAction` | `(page,menu,sub,'보기'|'수정',tcId)` | 행 액션 열기(모달/새탭/인라인) 비파괴 |
| **오라클** | `domain/invariants.*` | `materialLedgerInvariant/costAggregateInvariant/summaryTotalInvariant/budgetSubtotal(Matrix)Invariant` | 순수 계산 정합(기말=기초+입고−출고·차액·총계=Σ) |
| | `domain/homeCostDrilldown.drilldownInvariants` | `(course,grid,total)→DrillCheck[]` | I1 예산Σ=작업Σ·I2 전체=Σ홀·I3 뷰간 교차 |
| | `langCheck.applySlotComparison/classifyToastText` | | 언어 카테고리 분류(미노출/한글노출/혼재…) |
| **기록/산출** | `reporter.record` | `(meta:CheckMeta,status,extra?{actual,error,detail,screenshot})` | 검출형 직접 기록(PASS/FAIL/SKIP) |
| | `reporter.review` | `(ReviewItem{lang,screen,kind,zone?,item,value?,screenshot?})` | **ANOMALY/NEEDS_REVIEW·관찰 기록**(단일 객체 인자 — record와 형태 다름) |
| | `reporter.skip/diff/capture/writeReport/setReportHtmlOpts` | | SKIP·기획차이·CDP전체캡처·엑셀+HTML+history.db |
| **안전** | `destructive.isCourseDestructiveAllowed` | `(page)→{ok,why}` | **3중 가드**(ALLOW_DESTRUCTIVE=1+course-mng-td+킹즈락) |
| | `destructive.CRUD_MARK/deleteCourseMarkerRows` | `E2ECRUD발병` / `(page,mark,max)→n` | 마커행 teardown(원복) |
| **시나리오(파괴)** | `workorderHelpers.*` | `fillWorkorderRequired/fillAndRegisterWorkorder/investEquipment(First)(WithTime)/pickCategories/pickVSByText…` | 작업지시 CRUD·투입 도메인 조작(파괴적→가드 세트로만) |
| | `assetHelpers.create{Equipment,Vendor,Facility,Material}` | `(admin,spec)→{registered,detail}` | 장비/거래처/시설/자재 등록 |
| **다국어 KB** | `past-defects.json` | `Course/exploration/knowledge/` | QA-15289 하위 PC 결함 244건 + 패턴 분류(회귀 hotspot·Risk 부스트) |

---

## 3. 중복 구현 금지 대상 (이미 존재 — 재작성 말고 재사용/이식)

- **상태전이 엔진**: `Course/course-transition-map.spec.ts`(전이맵 채굴: COURSE_IA 순회→열기형 트리거`OPENISH` 클릭→모달/새탭/페이지/무동작 분류→대상 구성요소 카탈로그→`baselines/course-transitions.<sub>.json` 기록) + `course-transition-battery.spec.ts`(전이맵 로드→재실행→`presenceInTarget` 검증→복원, 파괴 트리거 제외). ⚠ **로직이 spec 파일 내부(비export)** → 탐색 Agent용으로 `lib/course/exploration/`에 **로직 추출/일반화**해 재사용.
- **딥 인터랙션**: `deepScreenE2E.ts`(`tabSweep`/`runDeepScreenE2E`) + `course-deep-e2e-all.spec.ts`.
- **커버리지 감사**: `coverageAudit.auditButtonCoverage`(미처리 컨트롤 탐지의 정본).
- **화면 관측/배터리**: `screenBattery.ts`(`dumpScreen`/`runScreenBattery`), `qualityBatteries.ts`(`runControlBattery`/`runChartIntegrity`/`runFigmaCheckText`).
- **선언형 화면 카탈로그**: `courseSuites.COURSE_*_SPECS` + `ScreenSpec`.
- **계산 오라클**: `domain/*`(순수 함수) — 새로 만들지 말고 그대로 호출.
- **리포트/캡처/이력**: `reporter.ts` 전체(별도 로깅·리포트 시스템 신설 금지).
- **인증/세션/네비/날짜/오버레이**: `courseHelpers.ts` 전체.
- **파괴 가드/teardown**: `destructive.ts`.

---

## 4. 기존 자동화의 장점 (탐색이 올라탈 기반)

1. **관측·기록·산출 파이프라인 완비**: `dumpScreen`(구조)+`captureSlots`(텍스트지문)+`withToastObserver`(부수효과) → `record/review` → 엑셀+monocart HTML+`history.db`. 탐색 결과 싱크를 새로 만들 필요 없음.
2. **비파괴 원칙 + 파괴 옵트인 가드**가 코드 전반에 내장(3중 가드·마커 teardown) → 안전한 데이터변경 탐색 즉시 가능.
3. **순수 계산 오라클(domain/*)** 다수 → Deterministic Oracle을 바로 결합.
4. **전이맵/딥/감사/배터리** 프리미티브가 이미 존재 → 탐색 Agent = "이들을 Risk 기반으로 오케스트레이션"하는 얇은 계층으로 구현 가능.
5. **실측 IA 트리(COURSE_IA)** + **화면 카탈로그(ScreenSpec)** = 상태그래프 노드/액션 후보의 선언형 지식.
6. **report-standard 문화**(정직 실측·가짜 FAIL 금지·2축 검증 diff) 정착 → 탐색의 Finding/ANOMALY 분리 기록과 정합.

---

## 5. Exploratory 관점 부족분 (신규로 채울 것)

- **State Graph 부재**: 전이맵(`course-transitions.json`)은 "트리거→목적지+구성요소"의 정적 카탈로그일 뿐, **businessState(작성중/임시저장/완료확정…)를 노드로 하는 동적 상태그래프**와 미방문 프론티어 추적이 없다.
- **Risk 기반 Action 선택기 부재**: 배터리/스윕은 **정해진 순서로 전수** 수행. "미수행 전이>데이터변경>API유발>과거결함 유사"의 **우선순위 스코어링·시퀀스 생성기**가 없다.
- **다단계 시퀀스 미탐색**: 대부분 단발 검증. `입력→저장→Refresh`, `제출→Back→재제출`, `Offline→저장→Online`, `탭복제→A저장→B저장` 같은 **순서/브라우저/네트워크 조합 시퀀스**가 없다.
- **API 실패/지연/오프라인 오라클 미비**: thick-client라 nav만으론 요청 0 → **`page.route` 주입(4xx/지연/abort)+reload refetch** 관측기가 필요(현재 없음).
- **Heuristic/AI Semantic Oracle 부재**: "클릭 후 무변화/성공토스트-값 불일치/중복요청/비정상지연"을 자동 이상으로 잡는 계층 없음.
- **Reproducer/Regression Candidate 부재**: Finding을 **동일 세션 내 재현(2회)** → `REPRODUCIBLE_ANOMALY` 분류 → 후보 산출 파이프라인 없음.
- **ANOMALY/NEEDS_REVIEW 상태 미지원**: 리포터 status 3종뿐 → review 시트 매핑 규약을 정해야 함.

---

## 6. 개선 대상 (구체)

1. **전이맵 로직 export화**: transition spec 내부 헬퍼(`loadTransitions/clickTrigger/presenceInTarget/captureIn`)를 `lib/course/exploration/transitions.ts`로 추출(원 spec은 유지).
2. **관측 통합 스냅샷 함수**: `dumpScreen`+`captureSlots`+URL+businessState 추론을 묶은 `snapshotState(admin)` 신설(관측 3소스 1콜).
3. **Risk 스코어러**: `auditButtonCoverage`의 액션 열거 결과 + `past-defects.json` 패턴 + 미방문 전이로 Action 우선순위 계산.
4. **네트워크 오라클**: `page.route` 기반 4xx/지연/abort 주입 + reload refetch 관측 유틸.
5. **review 매핑 규약**: ANOMALY/NEEDS_REVIEW → `review({kind:'ANOMALY'|'NEEDS_REVIEW', screen, item, value})`, 결정론 결함만 `record FAIL`.

---

## 7. 신규 Agent가 기존 코드와 연결되는 지점

```
[진입]   openCourseAdmin → (세션가드) isCourseLoggedOut → gotoCourseMenu(COURSE_IA 노드)
             │
[관측]   snapshotState = dumpScreen + captureSlots + url + businessState 추론
             │
[액션후보] auditButtonCoverage(열거·분류) + ScreenSpec + 전이맵(course-transitions.json)
             │  ← Risk 스코어(past-defects.json 패턴 + 미방문 전이 + 데이터변경/API유발)
[실행]   click/입력/시퀀스  ──(데이터변경)── isCourseDestructiveAllowed 가드 → CRUD_MARK teardown
             │  ├ 부수효과: withToastObserver
             │  └ 네트워크: page.route 주입 + reload refetch (신규)
[오라클] Deterministic(domain/* 불변식·HTTP·console·toast) │ Heuristic │ AI Semantic
             │
[기록]   record(FAIL/PASS/SKIP) · review(ANOMALY/NEEDS_REVIEW) · capture · diff
             │
[재현]   동일 세션 상태리셋(gotoMobileLanding류 재진입·page.reload) × 2회 → REPRODUCIBLE_ANOMALY
             │
[산출]   writeReport('코스관리_탐색') + Course/exploration/{results,candidates}/  (Jira key 연관)
```

**연결 계약(요약)**
- 모든 이동은 `gotoCourseMenu`/`openCourseAdmin` 경유(직접 goto 금지 — 오버레이·세션가드 우회 방지).
- 모든 기록은 `reporter`로(`CheckMeta{path,tcRef,tcId,desc}` 규격). 탐색 tcRef=`코스관리탐색_<화면>`.
- 데이터변경 액션은 예외 없이 `isCourseDestructiveAllowed` 통과 + 마커 teardown.
- 계산 검증은 `domain/*` 순수 함수 재사용(중복 구현 금지).
- 신규 코드는 `lib/course/exploration/` + `Course/exploration/`에 격리(기존 `Course/` 회귀 무손상).

---

## 8. 상태 모델 시드 (PoC = 작업 지시)

```
미작성 → (입력) 작성중 → (임시저장) 임시저장 → (등록/저장) 저장 → (수정) 수정중
                                                              ↓ (작업완료)
                                                          작업완료 → (완료확정) 완료확정 → 완료
```
- 기존 자산: `workorderHelpers.fillWorkorderRequired/fillAndRegisterWorkorder/invest*`, `course-workorder-write.spec.ts`, `course-wo-complete/confirm/edit-*.spec.ts`.
- 탐색할 미검증 전이(과거결함 연관): `작성중→Refresh/Back/로그아웃`(QA-15334류 상태초기화) · `진행중→작업완료`(QA-15368 사진 소실) · `완료확정→수정`(QA-15367 소수점) · `임시저장→다른탭 수정` · `제출→Back→재제출`(중복요청) · `검색어 {}[] 입력`(QA-15350 400).

---

## 9. 다음 단계 (Phase 3~)

P3 Agent 아키텍처 설계 → P4 최소 Explorer(진입+관측+감사 1화면) → P5 State/Transition 기록(`results/state-graph.json`) → P6 Runtime Observer → P7 Risk 선택 → P8 Anomaly → P9 Reproducer(세션 내 2회) → P10 Candidate(`candidates/` + Jira key).
각 Phase는 **사용자 라이브 1런 → Claude가 exceljs 오프라인 판독**으로 검증(세션 1런/로그인).
