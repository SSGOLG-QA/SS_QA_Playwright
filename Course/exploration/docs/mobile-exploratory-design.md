# 코스관리 Mobile — AI Exploratory Testing 시나리오 설계

> 대상: 코스관리 **모바일 웹**(`/mobile/course/*`, course-mng-td / 킹즈락, iPhone 13 에뮬레이션)
> 근거: 에픽 **QA-15289**(코스관리 2차 PC/Mobile) 하위 **[코스관리_MO] 결함 148건** 분석
> 원칙: PC 탐색 에이전트([agent-architecture.md](agent-architecture.md), P1~P10) **동일 수준** 적용 — 사람이 TC를 사전작성하지 않아도 AI가 탐색·상태이해·이상발견·재현가능 결함후보를 만든다(TC 변환기·몽키테스트 아님).
> 산출 KB: [`../knowledge/past-defects.mobile.json`](../knowledge/past-defects.mobile.json) (148건, feature·pattern 분류)

---

## 0. 요약 — PC와 무엇이 다른가

| 축 | PC(QA-15289 244건) | Mobile(QA-15289 148건) |
|---|---|---|
| 결함 성격 | **UI_SPEC_DIFF 164/244 (67%)** = 문구·레이아웃 지배 | **기능결함 지배** — 검색/연결 초기화 23·지도/위치 20·누락 15·상태전이 12 (UI_SPEC_DIFF 25/148 = 17%뿐) |
| 최상위 hotspot | 작업 지시 45·정보관리 38 | **작업 지시 53**·이슈/예측 20·코스정보 13·공통 13 |
| 고유 축 | (없음) | **네이티브 상호작용**(키패드·상태바·회전·롱프레스·백키)·**OS 플랫폼 분기**(iOS/AOS Only)·**페이지 스택 뒤로가기**·**지도 heavy** |

**설계 함의**: 모바일 탐색은 문구 검증(다국어·checkText가 이미 담당)보다 **연결/검색 흐름 · 상태 전이 · 위치/지도 정합 · 네이티브 상호작용**에 Risk 가중을 크게 둔다. PC 파이프라인(진입→관측→Risk→이상→재현→후보)은 **그대로 재사용**하되, 오라클/이상규칙/시드를 모바일로 교체한다.

---

## 1. 결함 패턴 분류 (148건 → 14 패턴 체계)

`past-defects.mobile.json`의 primaryPattern 분포(내림차순). 아래 13행 외 **PLATFORM_DIVERGENCE**(iOS/AOS Only)는 primary 0건이나 교차 태그로 유지(대부분 NATIVE 등 기능패턴이 먼저 매칭) — 총 14개 분류 체계:

| # | 패턴 | 건수 | 대표 결함 | 탐색 관측 포인트 |
|---|---|---|---|---|
| 1 | **SEARCH_FILTER_STATE_RESET** 검색/연결/조건 초기화 | 23 | QA-15573(검색어 소실)·15562(종료일만 조회)·15659(결과없음 문구)·15592(조건설정 위치 미반영)·15585(뒤로 시 초기화) | 연결 검색 후 이탈→재진입 시 검색어/조건 보존, 결과없음 안내 |
| 2 | **MAP_LOCATION** 지도/위치/구역 정합 | 20 | QA-15655(코스홀↔지도 위치 불일치)·15664(폴리곤 오노출)·15667(구역정보 누락)·15654(위치영역 빨간선)·15692(지하 아이콘) | 위치 저장 방식별 상세 표시 정합, 지도 렌더(heavy=정합값 위주) |
| 3 | **MISSING_FIELD** 누락/비노출 | 15 | QA-15663(점검번호)·15556(작업자명)·15656(평균시간)·15681(총투입시간)·15686(종료일) | 상세 필드 존재 단언(toBeVisible) |
| 4 | **EXTRA_DISPLAY** 오노출/불필요 | 14 | QA-15689(종류 오노출)·15640(토글)·15637(사진버튼)·15677(버튼)·15552(뱃지 색상) | 조건부 노출 규칙 위반 |
| 5 | **STATE_TRANSITION_DATA_LOSS** 상태전이/저장반영 | 12 | QA-15593·15673·15607(저장 후 즉시 미반영)·15669·15671(저장 불가)·15645(수정 에러) | 상태 변경→정보화면 델타, 저장 가능성 |
| 6 | **DATE_BOUNDARY** 날짜/기간/캘린더 | 9 | QA-15570(디폴트 어제)·15695(7일 제한)·15697(월선택)·15587(yyyy-mm)·15610(mm-dd) | 디폴트·범위·포맷 경계 |
| 7 | **BOUNDARY_VALIDATION** 경계값/유효성 | 8 | QA-15557(200자)·15584(기등록 자재명)·15613(반복설정 없이 등록)·15575(구역 미선택 통과)·15671(체크해제) | 부정입력 허용 여부 |
| 8 | **NATIVE_MOBILE_INTERACTION** 네이티브 상호작용 | 6 | QA-15651·15549(키패드로 버튼 사라짐)·15565(AOS 상태바)·15566(회전)·15660(롱프레스 iOS) | 소프트키보드·상태바·회전·롱프레스(에뮬 한계 명시) |
| 9 | **CALC_CONSISTENCY** 계산/표시값 | 6 | QA-15656(평균시간)·15681(총투입)·15639(참여자 시간오류)·15626(시간 잘림) | 시간값 화면 간 일치·null/0 |
| 10 | **API_ERROR** 에러 팝업 | 5 | QA-15652(이슈선택 에러)·15579(작업만들기 무동작)·15588(관련작업 이슈 에러)·15617(조회실패) | 연결/선택 시 에러팝업·조회실패 |
| 11 | **NAVIGATION_STACK** 뒤로가기/스택 | 3 | QA-15576(뒤로 리스트 미복귀)·15619(삭제 후 리스트 쌓임)·15590(백키 가드 우회) | 헤더 스택 diff·미저장 가드 |
| 12 | **PERMISSION** 권한/로그인 | 2 | QA-15550(3단말 로그아웃)·15698(권한) | 다중 세션·권한 |
| 13 | **UI_SPEC_DIFF** 문구/레이아웃 | 25 | QA-15688(완료확정 문구)·15618(삭제 문구)·15560(레이블) | 다국어/checkText 상보(낮은 우선순위) |

> ⚠ 패턴은 자동 분류(요약 키워드 휴리스틱) — primaryPattern은 우선순위(네이티브·기능결함 > UI_SPEC_DIFF) 첫 매칭. 다중 태그는 `defects[].patterns`.

---

## 2. Risk 모델 — hotspot & matchBoost (PC 재사용)

PC `risk.ts`의 `scoreTrigger` 공식을 그대로 쓰되 **입력 KB만 모바일로 교체**:

```
score = base[kind](view −1 / openModal +1 / save·submit·delete +3)
      + 미방문 +3 / 재방문 −2
      + 데이터변경 +3 + API유발 +2 − 반복감쇠
      + matchBoost
matchBoost = feature hotspot(작업지시 53건→최대 +3) + 라벨 직접연관(+2, jiraKeys 부착) + 고위험패턴 존재(+1)
```

- **feature hotspot 순위**(matchBoost 상한): `작업 지시 53 ≫ 이슈/예측 20 > 코스정보 13 · 공통 13 > 자재 관리 10 > 코스뷰 9 > 장비관리 6 · 일상점검 6 > 나의 작업 보기 5`.
- **고위험 패턴(HV, +1)**: `SEARCH_FILTER_STATE_RESET · STATE_TRANSITION_DATA_LOSS · MAP_LOCATION · BOUNDARY_VALIDATION · CALC_CONSISTENCY · NATIVE_MOBILE_INTERACTION · NAVIGATION_STACK`. (UI_SPEC_DIFF·MISSING·EXTRA는 저위험 = 노출 검증으로 충분.)
- **시드 우선순위**(hotspot×패턴밀집): ① 작업 지시(연결·반복작업·투입시간·상세) ② 이슈/예측(연결·예측달력·정렬·삭제) ③ 코스정보(측정정보 위치·조건설정) ④ 공통 위치/지도 ⑤ 자재관리(등록검증·이력) ⑥ 코스뷰(지도).

---

## 3. 재사용 4축 — 모바일 자산 매핑

PC는 desktop 자산을 재사용했다. 모바일은 **이미 구축된 딥 인터랙션 엔진**을 재사용한다(재작성 아님).

| 축 | PC 자산 | **모바일 대응 자산(기존)** |
|---|---|---|
| **진입** | openCourseAdmin·gotoCourseMenu·COURSE_IA | `openCourseMobile`·`enterCourseMgmt`·`enterArea`(3회 재시도)·`returnToLanding`·`killMobileAlarms` ([courseMobileHelpers.ts](../../../lib/course/courseMobileHelpers.ts)) |
| **관측** | dumpScreen·captureSlots·withToastObserver | `probeDump`(DOM 구조)·`headerTitles`(스택 레이어)·`captureMobileSlots`(텍스트 지문)·`readFacilityCards`(카드 파싱)·`totalCount` |
| **액션/전이** | auditButtonCoverage·transitions·tabSweep | `courseMobileDeep`(flowSort/Filter/Search/RegisterCancel/Detail)·`clickKebab`(⋮ 좌표)·`clickFrontLayerBack`(스택 백)·`hardReset`(스택 붕괴)·`CARD_SEL` |
| **오라클** | domain/*·homeCostDrilldown | facility 오라클(필터·검색·상세↔카드 정합) + 신규 모바일 오라클(§4) |
| **안전** | isCourseDestructiveAllowed | `isCourseDestructiveAllowed`(동일)·**비파괴 우선**·beforeunload dialog accept(정리 네비만) |
| **기록** | reporter.record/review | 동일 `record/review/skip/writeReport` |

**핵심 자산(딥 인터랙션서 확정, 5307c38)**:
- `clickFrontLayerBack(page, baseTitles)` — 스택 뒤 리스트 레이어 오클릭 방지, **프론트 레이어 헤더행 최좌측 백만** 클릭.
- `hardReset(page, area)` — returnToLanding + enterArea로 스택 붕괴(beforeunload dialog accept).
- ⋮ 메뉴명 화면별 상이(일상=편집 / 이슈·장비=수정 / 자재=구매·사용이력만).

---

## 4. 이상 규칙 (Anomaly Rules) — PC R1~R4 + 모바일 R5~R10

PC 규칙 재사용 + 모바일 결함 148건에서 도출한 신규 규칙. 판정은 report-standard 준수(결정론만 `record` FAIL, 불확실은 `review` ANOMALY/NEEDS_REVIEW).

| 규칙 | 상태 | 트리거 | 오라클(이상 판정) | 근거 결함 |
|---|---|---|---|---|
| R1 runtime-error | ANOMALY(5xx/JS)·REVIEW(4xx) | 모든 전이 | 전이 중 JS예외·5xx·4xx (RuntimeObservers) | QA-15652·15579·15588·15617 |
| R2 unexpected-nav | ANOMALY | 뷰형 트리거 | 뷰인데 랜딩(`나의 작업 보기`) 이탈 | (딥서 확정한 랜딩 이탈 패턴) |
| R3 modal-not-closeable | REVIEW | 등록/수정 폼 | 표준 닫기 실패→하드내비로만 | (딥 등록폼 스택) |
| R4 repeat-non-idempotent | ANOMALY | 최상위 Risk 2회 | 2회 열기 결과 상이 | — |
| **R5 keyboard-obscures-control** | REVIEW | 폼 입력 필드 포커스 | 소프트키보드(viewport 축소) 상태서 제출/추가 버튼이 뷰포트 밖·`display:none`·미가시 | **QA-15651·15549** |
| **R6 back-guard-bypass** | ANOMALY | dirty 폼 [<] 백 | 미저장 값 있는데 취소확인 팝업 없이 이탈 (딥서 `clickFrontLayerBack`+dirty로 검증 확립) | **QA-15590** |
| **R7 stack-not-unwound** | ANOMALY | 상세→서브→뒤로 / 삭제 후 | 뒤로 후 헤더 스택(headerTitles) 미복귀 or 리스트가 상세 위 잔존 | **QA-15576·15619** |
| **R8 state-not-reflected** | ANOMALY | 상태/저장 변경 후 | 변경 후 정보화면 델타 없음(slotSig 동일) | **QA-15593·15673·15607** |
| **R9 stale-data-untouchable** | REVIEW | 삭제된 항목 선택 | "이미 삭제된 데이터" 토스트 후 화면 무반응(이후 클릭 무동작) | **QA-15624·15625** |
| **R10 search-reset-on-nav** | ANOMALY | 연결 검색/조건 후 이탈→복귀 | 검색어·조건 소실 or 결과없음 안내 부재 | **QA-15573·15585·15659** |

> 파괴 규칙(commit·netfault)은 PC와 동일하게 opt-in(ALLOW_DESTRUCTIVE / EXPLORE_NETFAULT). ⚠ 모바일은 **삭제 UI 부재** → 생성-only(마커 E2E*, 수동/주기 정리) — write-path 정책과 동일.

---

## 5. 탐색적 테스팅 시나리오 (핵심 산출)

각 시나리오 = **시드 · 트리거(탐색 액션) · 관측 · 오라클 · 이상규칙 · 연관 결함 · 비파괴 처리**. Risk 내림차순.

### S1. 작업 지시 — 연결/불러오기 검색·조건 상태 (SEARCH_FILTER_STATE_RESET, Risk 최상)
- **시드**: 작업 지시 > 등록/수정 폼 > [종료된 작업 불러오기]·[발병정보 연결]·[일상점검 연결]·[이슈 연결].
- **트리거**: ① 검색어 입력 → [조건설정] 열고 닫기 → 검색어 잔존 확인 → ② 조건설정에서 위치/기간 설정 → 리스트 반영 확인 → ③ 상세 1뎁스 진입 → [<] → 연결 리스트 복귀 확인 → ④ 결과 0건 검색어 입력.
- **관측**: 검색 input value·리스트 카드 수·헤더 스택(headerTitles)·"결과가 없습니다" 텍스트.
- **오라클(R10/R7)**: 조건설정 후 검색어 보존 · 위치/기간 필터가 리스트에 반영 · 뒤로 시 연결 리스트로 복귀(랜딩·초기화 아님) · 0건 시 안내 문구 노출.
- **연관**: QA-15573·15562·15592·15576·15585·15659·15581·15587·15583. **비파괴**(불러오기 미확정, [<]로 이탈).

### S2. 작업 지시 — 반복 작업 / 장비 투입시간 저장 경계 (BOUNDARY + STATE, Risk 상)
- **시드**: 작업 지시 > 등록 > 반복 작업 토글 ON.
- **트리거**: ① 반복 설정 없이 [등록] 시도(음성 경계) → ② 장비 투입시간 상세설정 '전체 작업시간' OFF 상태 저장 시도 → ③ 장비 체크 → 체크 해제 → 등록 가능성 → ④ 토/일 제외 설정 → 투입시간 반영.
- **관측**: 제출 버튼 활성/비활성·유효성 토스트·저장 성공 여부(모달 이탈).
- **오라클(R5 keyboard 포함/BOUNDARY)**: 필수 미충족 시 등록 차단(QA-15613 반복설정 없이 등록됨=음성) · OFF 시 저장 가능해야(QA-15669) · 체크해제 후에도 완료 처리(QA-15671) · 키패드 올림/내림 후 [추가]·[등록] 버튼 가시(QA-15651).
- **연관**: QA-15613·15669·15671·15629·15670·15651. **비파괴**(등록 직전까지·제출 안 함 or 마커 후 정리).

### S3. 작업 지시 — 상세 필드 누락 & 투입시간 정합 (MISSING + CALC, Risk 상)
- **시드**: 작업 지시 리스트 > 상태별(대기중/진행중/작업완료/완료확정) 카드 상세.
- **트리거**: 상태별 상세 진입 → 필드 스윕(작업기간·종료일·장비 투입시간·평균시간·총 투입시간·작업참여자 시간).
- **관측**: 필드 존재(getByText)·시간 값·상태별 노출 차이.
- **오라클(R8 델타/CALC/MISSING)**: 종료일 노출(QA-15686) · 평균시간 제공(QA-15656) · 완료·완료확정 시 총 투입시간 제공(QA-15681) · 참여자 시간 오류 없음(QA-15639) · 대기중엔 작업자 사진버튼 미노출(QA-15637=EXTRA 교차).
- **연관**: QA-15686·15656·15681·15639·15638·15643·15626·15687·15615. **비파괴**(조회만).

### S4. 이슈/예측 — 연결·예측달력·정렬 (API_ERROR + SEARCH, Risk 상)
- **시드**: 이슈/예측 상세 · 예측달력.
- **트리거**: ① 이슈 상세 [작업 지시 만들기] → ② 이슈 연결에서 이슈 선택 → ③ 예측달력 필터(분류 멀티선택·코스분류) → ④ 예측달력 이슈/작업정보 [상세보기] → ⑤ 정렬 방식 변경.
- **관측**: 화면 전환·에러 팝업 텍스트(RuntimeObservers)·정렬 후 첫 항목 변화·필터 옵션.
- **오라클(R1/R8)**: [작업 지시 만들기] 동작(QA-15579 무동작=이상) · 이슈 선택 시 에러팝업 없음(QA-15652) · [상세보기] 전환(QA-15632) · 정렬 실제 반영(QA-15646) · 분류 멀티선택 가능(QA-15628).
- **연관**: QA-15579·15652·15653·15632·15631·15646·15628·15641·15648·15649·15650. **비파괴**.

### S5. 공통/작업/일상 — 위치 설정 방식별 지도 정합 (MAP_LOCATION, Risk 상)
- **시드**: 등록 폼 > 위치 설정([코스/홀 선택] · [지도 선택] 2경로).
- **트리거**: ① 코스/홀로 위치 선택 → 구역 선택/전체선택 → [추가] → ② 지도로 위치 선택 → 저장 → ③ 두 방식 저장 후 상세 [크게 보기].
- **관측**: 상세 위치영역(빨간선·구역정보·아이콘)·크게보기 지도·폴리곤 렌더(heavy=존재/정합 위주).
- **오라클(MAP)**: 코스/홀 선택 시 구역정보 노출(QA-15667) · 위치영역 빨간선 표시(QA-15654) · 구역 전체선택 [추가] 시 위치 추가됨(QA-15662) · 코스/홀 크게보기가 지도선택 위치로 뒤바뀌지 않음(QA-15655) · 지하 위치 아이콘 정합(QA-15692) · 폴리곤 오노출 없음(QA-15664).
- **연관**: QA-15667·15654·15662·15655·15692·15664·15575·15594·15595. **비파괴**(지도 상호작용 정밀검증 제외 — 렌더·정합값만).

### S6. 폼 [<] 뒤로 → 미저장 취소 가드 (NAVIGATION_STACK + R6, Risk 중상)
- **시드**: 각 등록/수정 폼(작업·일상·이슈·장비·자재·시설).
- **트리거**: 폼 첫 입력에 값 타이핑(dirty 유발: pressSequentially + input/change dispatch) → **프론트 헤더행 [<]** (clickFrontLayerBack).
- **관측**: "작업중이던 내용을 취소하시겠습니까?" 팝업 · 헤더 스택.
- **오라클(R6/R7)**: dirty 상태 [<] 시 취소확인 팝업 노출([예]로 폐기=비파괴). 팝업 없이 이탈=이상(QA-15590 백키 우회 동형). ← **딥 인터랙션서 검증 확립(49P/0F)**, 탐색은 전 폼으로 일반화.
- **연관**: QA-15590·15576·15619. **비파괴**([예]로 빈/폐기 이탈).

### S7. 상태 전이 즉시 반영 (STATE_TRANSITION_DATA_LOSS + R8, Risk 중상)
- **시드**: 코스뷰·작업·일상·장비/시설 이력.
- **트리거**: 상태값 수정(예: 진행상태 변경) → 정보 화면 복귀 → 델타 관측.
- **관측**: 변경 전/후 slotSig(상태 뱃지·값).
- **오라클(R8)**: 상태 변경이 정보 화면에 즉시 반영(QA-15593·15673·15607 미반영=이상). 수정 시 에러팝업+미저장 없음(QA-15645).
- **연관**: QA-15593·15673·15607·15645. ⚠ **상태 변경은 데이터 커밋** → opt-in 파괴 가드 하에서만(원복 가능한 토글 우선), 미허용 시 노출·활성만.

### S8. 삭제된 데이터 접근 (R9 stale-data-untouchable, Risk 중)
- **시드**: 장비·시설 리스트(다른 세션서 삭제된 항목 존재 시 — 데이터 의존).
- **트리거**: 삭제된 항목 카드 선택.
- **관측**: "이미 삭제된 데이터입니다" 토스트 → 이후 화면 클릭 반응.
- **오라클(R9)**: 토스트 후 [확인] 터치 가능·화면 조작 복구(QA-15624·15625 무반응=이상).
- **연관**: QA-15624·15625. **비파괴**(선택만). 데이터 없으면 SKIP.

### S9. 날짜/기간 경계 (DATE_BOUNDARY, Risk 중)
- **시드**: 나의 작업 보기 · 조건설정 기간 · 작업 지시 진입 날짜.
- **트리거**: ① 나의 작업 보기 진입 디폴트 날짜 · 달력 월 선택 · 앞/뒤 7일 범위 → ② 조건설정 기간 1년 초과 [선택] 반복 → ③ 종료일 < 시작일 설정.
- **관측**: 디폴트 값·토스트 중복·날짜 포맷·이동 가능 범위.
- **오라클(BOUNDARY)**: 디폴트 오늘(QA-15694·15570 어제=이상) · 월 선택 가능(QA-15697) · 7일 초과 이동(QA-15695) · 1년초과 토스트 1회(QA-15672 중복=이상) · 종료<시작 차단(QA-15612).
- **연관**: QA-15694·15570·15697·15695·15672·15612·15587·15610·15661. **비파괴**(조회만).

### S10. 네이티브 상호작용 (NATIVE_MOBILE_INTERACTION, Risk 중 · 에뮬 한계)
- **시드**: 입력 폼(키패드) · 지도 등록(회전) · 상세(상태바).
- **트리거**: ① 입력 필드 포커스(소프트키보드=viewport 축소 모사) → 제출/추가 버튼 가시성 → ② `resize_window` 가로/세로 전환 후 위치 설정 유지.
- **관측**: 버튼 boundingRect(뷰포트 내/밖)·회전 후 상태.
- **오라클(R5)**: 키보드 상태서 [추가]·[등록] 가시(QA-15651·15549). 회전 후 값 유지(QA-15566).
- **연관**: QA-15651·15549·15566·15565·15660. ⚠ **에뮬 한계**: 실 소프트키보드·상태바·iOS 롱프레스·백키는 웹 에뮬에서 부분 모사만 → **review로 표면화, 판정 보수적**(FAIL 금지, NEEDS_REVIEW). 실기기 수동 병행 권장.

> **저위험 스위프(노출 검증으로 충분)**: MISSING_FIELD·EXTRA_DISPLAY·UI_SPEC_DIFF(문구)는 이미 `course-mobile`(구조 노출)·`course-mobile-lang`(문구)·`course-mobile-deep`(딥)이 담당 → 탐색은 **중복 지양**, 신규 발견은 review로만.

---

## 6. Phase 계획 (PC P1~P10 미러링, 모바일 자산 재사용으로 압축)

| Phase | 내용 | 상태 |
|---|---|---|
| P1 결함 분석 | QA-15289 MO 148건 수집·13패턴 분류·hotspot | ✅ (본 문서 + KB) |
| P2 자산 인벤토리 | §3 4축 모바일 매핑(courseMobileDeep 재사용) | ✅ (본 문서) |
| P3 아키텍처 | 단일세션 오케스트레이터 = PC 구조 재사용 + 모바일 시드/오라클 | ✅ (본 문서) |
| P4 MVP | 시드=작업 지시, 비파괴 view+연결검색 전이, R1/R2/R10 | ☐ `lib/course/exploration/mobile/` 신규 |
| P5 상태전이 | 상세/서브/등록폼 서브상태 + hardReset·clickFrontLayerBack | ☐ (딥 자산 이식) |
| P6 런타임 관측 | RuntimeObservers(console·pageerror·4xx/5xx·dialog) = PC 재사용 | ☐ |
| P7 Risk | risk.ts + past-defects.mobile.json 교체 | ☐ |
| P8 이상 | R1~R10 규칙(§4) | ☐ |
| P9 재현 | 세션 내 2회 재실행(재로그인 금지) = PC 재사용 | ☐ |
| P10 후보 | REPRODUCIBLE_ANOMALY만 candidates 산출 | ☐ |
| 확장 | netfault(모바일 route 주입)·commit(생성-only, 삭제 UI 부재) opt-in | ☐ |

**MVP 최소 슬라이스(P4)** = 작업 지시 시드 → 진입(openCourseMobile+enterArea) → snapshotState(probeDump+headerTitles) → **S1 연결검색 전이**(비파괴) → R10/R1/R2 평가 → review/record → state-graph.json. (PC MVP와 동일 골격, 시드·오라클만 모바일.)

---

## 7. 제약 & 안전 (PC 동일 + 모바일 특수)

- **세션 1런/로그인**(공유 QA 계정) → 단일 컨텍스트 완결, 재현은 재로그인 아닌 **세션 내 hardReset**, Claude는 reports xlsx 오프라인 판독. [[session-one-run-per-login]]
- **thick-client** — nav만으론 API 0건 → 조회/검색 액션·reload로 refetch 유발(netfault). [[course-mobile-web-separate-app]]
- **페이지 스택** — 리스트↔상세↔서브 DOM 누적 → 플로우마다 hardReset, back은 clickFrontLayerBack(프론트 레이어 스코프).
- **beforeunload 다이얼로그** — 정리 네비에서만 accept(가드 검증엔 미영향).
- **비파괴 우선** — filter/조회=뷰만, 등록/수정=입력해도 [예]/취소로 폐기, 삭제=[취소]. 파괴(상태변경·생성)는 opt-in 3중 가드(ALLOW_DESTRUCTIVE + course-mng-td + 킹즈락). **모바일 삭제 UI 부재** → 생성-only(마커 잔존, 수동 정리).
- **에뮬 한계** — 소프트키보드·상태바·회전·롱프레스·백키·OS분기는 부분 모사 → **NEEDS_REVIEW로 표면화**, FAIL 금지, 실기기 수동 병행.
- **report-standard** — ANOMALY/NEEDS_REVIEW는 `review()`, 결정론만 `record` FAIL. 정직 SKIP(데이터 의존·에뮬 한계).

---

## 8. 산출물

- `Course/exploration/knowledge/past-defects.mobile.json` — 148건 KB(✅ 생성).
- `Course/exploration/docs/mobile-exploratory-design.md` — 본 문서(✅).
- (구현 시) `lib/course/exploration/mobile/{explorer,seeds,oracles,anomaly}.ts` + `Course/exploration/course-explore-mobile.spec.ts` + `npm run course:explore-mobile`.
- (구현 시) `results/mobile-state-graph.json` · `findings.mobile.json` · `candidates/*` · `reports/코스관리모바일_탐색_*.xlsx`.
