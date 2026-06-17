# CLAUDE.md

> SMARTSCORE **경기관제 어드민(td17 리뉴얼)** UI 검증 자동화 (Playwright).
> 드라이브 TC 예상결과를 전수 검증하고 **엑셀 리포트**로 산출. 이 문서는 새 세션이 맥락을 이어받기 위한 안내서.

## 프로젝트 개요
- **대상**: `https://td17.smartscore.kr` 경기관제 어드민(SPA, `/club/page/...`), 클럽 **킹즈락**
- **목적**: 드라이브 TC(2026-06 경기 관제 리뉴얼) 예상결과 전수 검증 + IA 구현여부 + SNB有/TC無 이슈 추적
- **산출물**: `reports/*_report_*.xlsx` (대메뉴별 시트 + 요약 + IA + SKIP + SNB有/TC無)
- **스택**: `@playwright/test` ^1.60, `exceljs`(리포트). TypeScript, commonjs.

## 환경 & 실행
세션은 **클라우드 대시보드 로그인 → 서브도메인 `td17` → 경기관제 [어드민 가기]** 다리를 통해 어드민에 진입(`storageState` 재사용).

```bash
# 0) 최초 1회: 인증 세션 생성 (반드시 headed, 브라우저에서 수동 로그인 — 최대 3분 대기)
npx playwright test --project=setup --headed
#    → auth/.auth/admin.json 저장 (클라우드+td17 쿠키 포함). 만료 시 재실행.

# 1) 개별 스펙 실행 (setup 의존 자동)
npx playwright test --project=admin-chromium Admin/icon-mgmt.spec.ts
#    --no-deps 로 setup 건너뛰기 가능(세션 유효 시). KEEP_OPEN=1 시 종료 전 pause.
```
- 설정: `playwright.config.ts` — `fullyParallel:false`, 창 최대화(`--start-maximized`, `viewport:null`), baseURL=td17.
- 프로젝트: `setup`(auth) / `flow`(Flow/) / `admin-chromium`(Admin/, storageState 재사용).

## 디렉터리 & 워크플로
분석 → 문서화 → 코드 → 실행 → 리포트 파이프라인:

| 단계 | 위치 | 내용 |
|------|------|------|
| ① 원시 분석 | `analysis/*.json` | 페이지 DOM 구조 덤프(`extractDom`). 기계가독, 일회성 |
| ② 락케이터 문서 | `locators/*.md` | 사람이 읽는 UI요소·Locator·주의사항 설계서 (코드의 근거) |
| ③ 검증 스위트 | `lib/suites.ts` | 화면별 `run*()` 함수 (홈/라운드관리/홀별정산/카트/아이콘/IA) |
| ④ 스펙 | `Admin/*.spec.ts` | 진입 → `run*()` 호출 → `writeReport()` |
| ⑤ 공통 | `lib/adminHelpers.ts` | `openAdmin`, `navigateMenu`, `gotoMenu`, `settle`, `extractDom` |
| ⑤ 리포터 | `lib/reporter.ts` | `check`/`checkText`/`gotoMenu`/`skip`/`noTC`/`recordIA`/`diff`/`checkRawCode`(오타·미가공코드)/`checkRowCountVsTotal`(정합성)/`writeReport` |
| ⑥ E2E(POM) | `Playwright_New/` | POM 기반 E2E(8항목: 진입/텍스트/이동·세션/정합성/페이지네이션/달력/입력/모달) + 파괴 테스트 골격(`destructive.ts`, 옵트인 가드). 독립 config |
| 산출 | `reports/`, `playwright-report/`, `test-results/` | 엑셀 + HTML + 스크린샷 |

> 루트의 `SmartScore/Spark_*.spec.ts`, `Cloud/`, `Flow/`는 별도(레거시/플로우). 핵심 작업은 `Admin/` + `lib/` + `locators/`.

## 핵심 컨벤션 (반드시 준수)
1. **리포터 패턴**: 검증은 `check(page, meta, fn)` / 안내문구는 `checkText(page, meta, locator)`. **실패해도 throw 안 하고 기록 후 계속** 진행(전수 검증). `meta`는 `{path, tcRef, tcId, desc, expected?, failMsg}`.
2. **비파괴 원칙**: `저장`/`적용`/`관제적용`/`변경`/`삭제`/`사용중지`/카드`✕` 등 **데이터 변경 동작은 클릭하지 않고 노출·활성만 검증**. 토글 ON/OFF 검증 시 반드시 **원상복구**(저장 안 함).
3. **동적 채번 ID 금지**: `#tgv-N-0`, `#tgv-1-*` 등 토글 id는 **SPA 네비게이션마다 N 증가** → 절대 id 의존 금지. **섹션(`.contents-box`+텍스트) 스코프** 후 `label` 클릭 / count 검증.
4. **중복 버튼 스코프**: `저장`/`변경`/`초기화`/`적용`은 한 화면에 여러 개 → **섹션·행 컨테이너로 스코프** 필수.
5. **공백 무시 매칭**: 메뉴/섹션명은 화면 공백이 가변(`홀별 정산 관리` vs `홀별정산관리`). `navigateMenu`는 norm(공백제거)으로 매칭, 섹션 텍스트는 **정규식**(`/홀별\s*정산\s*관리/`)으로.
6. **데이터 의존 완화**: 아이콘 개수·코스 수·행 수 등 골프장별로 다른 값은 **`≥1`/`≥2`** 로 검증(고정 count 금지).
7. **TC 출처 & tcRef 형식**: 드라이브 > SS_QA > 01.TC > 2026-06 경기 관제 리뉴얼. `tcRef`(TC참조 드라이브 컬럼)는 **`시트제목_1depth_No.`** 형식으로 기입 (예: `관제 관리_라이브채팅 공지 조회_1`). `tcId`(TC 컬럼)는 가독용 표기 id(예: `LIVECHAT-01`).
8. **2축 검증 전략 (구현 기준 검증 + 기획 차이 추적)**: 구현 UI가 기획서/TC와 다르나 **기능상 정상이면 현 구현을 유지**하는 경우 — ① **검증축(PASS/FAIL)**: 락케이터·기대값을 **현 구현(AS-IS)** 에 맞춤(가짜 FAIL 제거). ② **추적축(INFO)**: 기획-구현 차이는 결함이 아니라 `diff(menu, 기획, 구현, tcRef, 비고)`로 기록 → 리포트 **`기획-구현 차이`** 시트. 상태 의존 요소(토글 ON/OFF 등)는 조건부 검증 또는 `skip`(사유 명시).

## 검증 스위트 (`lib/suites.ts`)
- `runHome` — 홈 공통메인 TC #1~10
- `runRoundMgmt` — 라운드관리 7종(내장현황/통계/전체라운드/라운드설정/홀별정산/카트/단체) 오케스트레이터
- `runHoleCalc` — 홀별정산관리 관제어드민 상세 #288~300
- `runCartMgmt` — 카트관리 구조 기반 CART-02~10
- `runIconMgmt` — 관제관리>아이콘 관리 구조 기반 ICON-01~12
- `runLiveChatNotice` — 관제관리>라이브채팅 공지 조회 구조 기반 LIVECHAT-01~06
- `runCartTrace` — 관제관리>카트 이동경로 확인 구조 기반 제한(지도/재생) CARTTRACE-01~06 + **CARTTRACE-03b** 지도/스카이뷰 전환 토글 버튼 노출(✨2026-06-10)
- `runTabletFeature` — 태블릿 운영 관리>태블릿 기능 설정 구조 기반 TABLET-01~09(7섹션)
- `runTabletMessage`/`runTabletHoleEvent` — 태블릿 운영 관리>메시지 관리(TMSG)/홀 이벤트 관리(THEV)
- `runTimeStandard`/`runTimeRealtime`/`runTimeSearch`/`runTimeStats` — 경기 진행 관리 4종(TSTD/TRT/TSCH/TSTAT)
- `runCaddieList`/`runCaddieRegister`/`runCaddiePerformance` — 캐디 관리 3종(CADL/CADR/CADP)
- `runBetoRecord` — 배토 관리>배토 기록 조회(BREC)
- `runFnbVersion`/`runFnbRestaurant`/`runFnbProduct`/`runFnbOrderHistory` — 식음 관리 4종(FNBVER/RESTO/FNBPROD/FNBORD)
- `runHolemapZone`/`runHolemapCartEntrance`/`runHolemapTeeshot`/`runHolemapPreview` — 홀맵 관리 4종(HMZ/HMCE/HMTS/HMP). ✨HMTS-03→03-1(거리 input)/03-2(사용여부 checkbox)/03-3(사용여부 라벨) 분리, HMTS-04 `.first()` 추가(2026-06-10)
- `runPinPosition`/`runPinHistory`/`runPinAnalysis`/`runCourseAnalysis`/`runGreenSpeed`/`runClubNews` — 코스 운영 관리 6종
- `runCustomerEval`/`runCaddieEval`/`runReviewList`/`runReviewStats` — 고객 평가 관리 4종(CEVAL/CDEV/RVL/RVS)
- `runAccountList`/`runAccountPermission` — 계정 관리 2종(ACL/APM)
- `runTournament` — 대회>대회관리 구조 기반(TOURN-01~07)
- `runLangCheckAll`(`lib/langCheck.ts`) — 전 메뉴 언어 검증(한글 노출/미노출 검출, 언어별 분리 리포트) ✨신규
- `runIA` — IA 트리 전체 메뉴 구현여부(`IA_TREE` 정의)

## 진행 상황 (2026-06 기준)
**완료**
- 홈(`runHome`), 라운드관리 7종(`runRoundMgmt`), 홀별정산(`runHoleCalc`), 카트관리(`runCartMgmt`)
- **관제관리 > 아이콘 관리**: `locators/admin-icon-mgmt.md` + `runIconMgmt` + `Admin/icon-mgmt.spec.ts` — **검증 완료(2026-06-04, PASS 14/14, 기획-구현 차이 2건)**
- **관제관리 > 라이브채팅 공지 조회**: `locators/admin-live-chat-notice.md` + `runLiveChatNotice` + `Admin/live-chat-notice.spec.ts` — **검증 완료(2026-06-04, PASS 6/6, 차이 1건: 공지내용 검색 필드 라벨 '출력률' 오표기)**
- **관제관리 > 카트 이동경로 확인**: `locators/admin-cart-trace.md` + `runCartTrace` + `Admin/cart-trace.spec.ts` — ⚠️ **메뉴 제거됨(2026-06-16 드리프트)**. 6/4 검증 완료(PASS 15/15)였으나 현재 SNB에서 '카트이동경로 확인' 사라짐(`관제 모니터`로 통합 추정). `cart-trace.spec.ts`는 적응형(메뉴 present 시 기존 검증 수행, absent 시 `diff`+`skip`)으로 전환·`runCartTrace` 보존. all-suite STEP 제거, IA가 '미구현' 추적. QA 확인 요망(기능 이전/제거 여부).
- **태블릿 운영 관리 > 태블릿 기능 설정**: `locators/admin-tablet-feature.md` + `runTabletFeature` + `Admin/tablet-feature.spec.ts` — **검증 완료(2026-06-04, PASS 28/28). 7섹션(경기 진행 설정·통계카드/4개 메시지·확인서 테이블/추가 확인서/패스워드). 비파괴(내용 수정·저장·삭제·토글 클릭 안 함)**
- **태블릿 운영 관리 > 메시지 관리 / 홀 이벤트 관리**: `locators/admin-tablet-message-event.md` + `runTabletMessage`/`runTabletHoleEvent` + `Admin/tablet-message-event.spec.ts` — **검증 완료(2026-06-04, PASS 23/23). 차이 1건(홀이벤트 안내문구 오타 의심 '이미지가태'). 안내문구는 부분 일치 검증**
- **경기 진행 관리 4종(진행시간 표준 설정/실시간/조회/통계)**: `runTimeStandard`/`runTimeRealtime`/`runTimeSearch`/`runTimeStats` + `Admin/time-progress.spec.ts` — **검증 완료(2026-06-04, PASS 52/52). 차이 1건(진행시간 조회 안내문구가 실시간과 동일 — 복붙 의심). 구조 기반 비파괴, 안내문구 부분 일치. (locator 문서 미작성 — JSON+suite 주석으로 갈음)**
  - ✨ **정합성(자동계산값) 검증 추가(2026-06-08, TSTD-07~11)**: ① 진입 시 — 전체시간=경기시간+홀간대기(요약·코스카드, TSTD-07) / 라운드 자동계산 전체=전반+후반(TSTD-08) / 경기시간=Σ진행시간·홀간대기=Σ다음홀대기(TSTD-09). ② 입력 변경 시 — 1홀 진행+10 → 경기·전체 +10 즉시 반영 후 **원상복구**(저장 안 함, TSTD-10). ③ [권장값 적용] 후 — 불변식 전체=경기+홀간 유지 검증 + **초기화로 복구**(TSTD-11). 시간포맷 `H:MM` 분환산 비교. ⚠ 권장값 적용 후 요약 경기시간 ≠ Σ진행시간(입력카드) **집계 불일치 관찰** → `diff`로 추적(주요 이슈 현황 노출, QA 확인 요망 — 테스트환경 데이터/재계산 지연 가능). 시간 합산값 검증은 타 화면에도 동일 패턴 확장 가능.
  - ✨ **동작 자동화 추가(2026-06-08, 비파괴)**: 진행시간 실시간 6동작 — TRT-06(필터변경→검색 조회실행)·TRT-07(초기화→입력 클리어)·TRT-08(새로고침→재조회)·TRT-09([내보내기]→`waitForEvent('download')` 발생만, 내용검증X)·TRT-10([홀별시각보기↔숨김] 라벨 토글)·TRT-11([정보]아이콘→**새 탭** `context.waitForEvent('page')` 랜딩·데이터의존 skip)·TRT-12(검색입력 후 동적 [X]→값 클리어). **전체메뉴 확대(DRY)**: `lib/commonActions.ts`의 `runCommonActions`(**달력 날짜선택→조회**/초기화/내보내기 다운로드, 화면에 있으면만)를 **단일 화면 `run*()` 함수 31개 끝에 주입** → 개별 스펙·all-suite 양쪽 자동 반영(중복 호출 없음). 제외: runHome/RoundMgmt/CartMgmt/HoleCalc/TimeRealtime(자체 내보내기·초기화 보유)/IA. 검증: customer-eval 40→48·course-ops 48→52(공통동작 추가분)·전체테스트 523 PASS/0 FAIL. 모두 비파괴(조회/뷰/다운로드/클리어).
  - ✨ **달력 날짜선택→조회 동작 공통화(2026-06-12, `checkDateSearch` in `commonActions.ts`)**: datepicker 보유 메뉴에서 **노출 검증을 넘어 실제 [달력 열기→현재 월 유효 날짜 1개 선택→[조회]/[적용]] 동작**을 비파괴 수행(`DATESEARCH-01`). **달력 전용 데이트피커 구동**은 round-mgmt.pom의 검증된 방식 채택 — 팝업이 뷰포트 밖에 떠 좌표 클릭 불가하므로 날짜 셀을 **DOM `el.click()`**(뷰포트 무관)으로 클릭, 닫기는 Escape. **저장형 [적용] 오클릭 방지**: 날짜 셀·조회 버튼을 **`.datepicker-input`을 품은 `.contents-box`(검색폼)로 스코프** → datepicker 없는 화면(태블릿 기능/아이콘 등 저장형 적용)은 진입 자체 안 함. `runCommonActions`에 **dateSearch→reset→export 순**으로 편입(전체 datepicker 메뉴 자동 적용). 1개 날짜 선택이라 1년 초과 알럿 미발생. ⚠ 라운드관리·홀별정산은 runCommonActions 제외 대상이라 미적용(필요 시 명시 호출).
- **캐디 관리 3종(캐디리스트/등록 관리/실적)**: `Admin/caddie.spec.ts` — **검증 완료(PASS 35/35). 차이 1건(캐디 등록 자격취득일 YYYY-MM-DD 형식 불일치)**
- **배토 관리 > 배토 기록 조회**: `Admin/beto-record.spec.ts` — **검증 완료(PASS 8/8)**. ⛔ **작업 경로 팝업([보기] 클릭 후 지도/경로 시각화) 범위 제외**(BREC-05 skip) — 지도 상호작용·경로 재생 검증 부적합(카트 이동경로 정책 동일), [보기] 버튼 노출(BREC-04)만 검증.
- **홀맵 관리 4종(구역 설정/카트패스 진입여부/티샷 유의 거리/미리보기)**: `Admin/holemap.spec.ts` — **검증 완료(PASS 24/24→27/27). 미리보기는 시각 도구 제한 검증. ✨HMTS-03 분리(03-1 거리 input/03-2 사용여부 checkbox/03-3 사용여부 라벨 문구)+HMTS-04 저장·초기화 버튼 노출 추가(2026-06-10)**
- **코스 운영 관리 6종(핀 포지션 관리·변경이력·분석/코스 분석/그린스피드/골프장 소식)**: `Admin/course-ops.spec.ts` — **검증 완료(PASS 42/42)**
- **고객 평가 관리 4종(고객 평가/캐디 평가/후기 리스트/후기 통계)**: `Admin/customer-eval.spec.ts` — **검증 완료(PASS 36/36)**. (식음료 평가 JSON 미확보)
- **계정 관리 2종(계정 리스트/계정 권한 관리)**: `Admin/account.spec.ts` — **검증 완료(PASS 17/17). 권한변경·패스워드 변경·로그아웃·권한 적용 등 비파괴**
- **대회 > 대회관리**: `locators/admin-tournament.md` + `runTournament` + `Admin/tournament.spec.ts` — **검증 완료(2026-06-09, PASS 8/8). 차이 1건(리더보드 웹뷰 URL = 관리자 웹뷰 URL 동일 `https://smartscore.kr/leaderBoardLogin` → URL 복붙/매핑 오류 의심)**. URL `/club/page/tournament`. 3영역(안내+웹뷰 URL 2종·검색·대회 테이블 15컬럼). 공식 대회 운영(참가자/조편성/그룹/스코어/리더보드, 단체 라운드와 별개). 🔴 비파괴(신규 등록·설정·등록·복사·보기 노출만). ⚠️ 안내문구가 `.info-box-text` 아님 → 안내 박스 텍스트 스코프 부분 일치. 행 액션은 데이터 의존(0건 SKIP)
- **식음 관리 4종(버전 및 설정/식당 관리/상품 등록 관리/주문 내역 관리)**: `locators/admin-fnb-version.md`+`admin-fnb-rest.md` + `runFnbVersion`/`runFnbRestaurant`/`runFnbProduct`/`runFnbOrderHistory` + **`Admin/fnb.spec.ts`(4종 통합)** — **검증 완료(2026-06-09, PASS 27/27, 첫 메뉴 진입 플레이크는 재실행 통과). 차이 1건(SNB 라벨 드리프트: 실 SNB '버전 및 설정' ≠ IA 변경표 '버전 업데이트' → IA_TREE·langCheck MENU_LIST 정정함)**.
  - ① **버전 및 설정**(`/table-order-version`, FNBVER-01~09): F&B 데이터 연동 카드+현재버전·POS 연동 카드·코스별 기본 식당 vue-select. 🔴 전부 파괴적(동기화·코스 기본식당 변경) → 노출·활성만.
  - ② **식당 관리**(`/table-order-restaurant`, RESTO-01~05): 마스터-디테일(좌 식당 리스트+아이콘 범례+[관리]/[+ 식당 추가], 우 선택 안내).
  - ③ **상품 등록 관리**(`/table-order-product`, FNBPROD-01~05): 상품명 검색+액션 4버튼(선택삭제·원산지·카테고리·상품 등록)+상품 테이블 8컬럼(행 데이터 의존).
  - ④ **주문 내역 관리**(`/table-order-statistics`, FNBORD-01~09): 캐디주문실적·그늘집주문내역 통합 대시보드(관점탭2·기간/식당/캐디 필터·요약카드4·차트3·주문 랭킹/상세 테이블·내보내기). `runCommonActions`로 초기화/내보내기 동작 검증.
  - 🔴 **식음 실 SNB = 4종**. IA 변경표 6종 중 **그늘집 및 TOS관리·식당·품목 매핑은 미구현(SNB 부재)** → `runIA`가 미구현 기록. IA_TREE는 변경표 기준 6종 유지. SNB 네비 토글(`depth-2-toggle`)은 검증 제외.
- ✨ **언어 검증(전 메뉴 다항목 UI 표기 검증)**: `lib/langCheck.ts` + `Admin/lang-check-all.spec.ts`(전체) / `Admin/lang-check.spec.ts`(PoC) — **검증 완료(2026-06-09)**. **공식 지원 언어 7개**(한국어=baseline 제외: English/Tiếng Việt/ภาษาไทย/繁體中文/简体中文/日本語/Bahasa Indonesia) 전 메뉴에서 **정적 UI 표기 결함 전수 검출**. **언어별 리포트 파일 분리**(`reports/lang-check-<언어>_report_*.xlsx`, 7개). 전체 실행 ~26분.
  - **결과**(FAIL=결함, PASS=정상 번역 실제값 전수기록): 영어 **PASS 503 / FAIL 24**(한글노출 22·혼재 2, 미노출 0 — 번역 거의 완비) / 나머지 6개 언어 각 **FAIL 86**(한글노출 35·혼재 2·미노출 49, **6개 언어 완전 동일** = 동일 i18n 미연결 문자열 집합), PASS는 번역분만큼(예 일본어 360) / 공통 SKIP 8(미구현). **인사이트**: 한·영만 본격 로컬라이즈, VN/TH/ZH/JA/ID는 동일하게 미흡.
  - **검증 방식**: 한국어로 메뉴 진입 → baseline 슬롯 캡처(`captureSlots`) → 언어 전환 → 동일 슬롯(DOM경로 키) 대조. 종료 전 **한국어 원복**(비파괴). **시스템 요소만 검증** — 컨텐츠(공지·게시판 글 등)의 한글은 결함 아님(스캔 배제=PASS 취급).
  - **검출 카테고리(FAIL)**: ① **한글 노출**(전환 후 한글 잔존) ② **언어 혼재**(한글+타스크립트 동시 — 예 `URL복사`) ③ **미노출(미번역)**(전환 후 빈값/공란) ④ **인코딩 깨짐**(리터럴 `�`·`□`·`??`) ⑤ **글자 잘림**(leaf 텍스트 overflow 클리핑·말줄임 아님) ⑥ **타 언어 노출**(대상 언어가 아닌 다른 외국어 스크립트 노출 — 예: 태국어 전환 시 일본어/중국어/영어 노출, 일본어·중국어 전환 시 태국어 노출, 영어/베트남어/인도네시아어 전환 시 태국어·CJK·가나 노출). `detectWrongLanguage`로 스크립트 명확 불일치 케이스만 보수적 감지(false positive 방지). **PASS**=정상 번역 항목을 **실제값(번역 결과)과 함께 전수 기록**(예 `라운드 관리→Manage Rounds`). 현상(`error`) 컬럼으로 분류. **확인 필요·관찰 시트(판정 제외)**: 말줄임(`…`)·**날짜/숫자 포맷 관찰**(형태만 기록). **검증 범위 제외**: 글리프 깨짐(□)·이미지 내 텍스트·픽셀 레이아웃(DOM 불가)·번역 정합성(오역). 토스트/에러는 아래 별도 항목.
  - **슬롯 매칭 키 = 구조적 DOM 경로**(`영역|tag:nth-of-type 체인`): 순번(#idx) 대신 요소 고유 경로로 KO↔FG 1:1 매칭. `nth-of-type`은 숨김 형제 포함 전체 DOM 위치라 reflow에 불변 → 한 요소가 빠져도 뒤 슬롯이 안 밀려 오탐 제거. i18n은 텍스트만 교체하므로 경로 안정. (id는 동적 채번이라 부적합)
  - **언어 드롭다운**: 헤더 `.title` 트리거 + `.slot-item`(8개 언어). `switchLanguage`로 전환(후 Escape). 스펙은 `LANGS=영어,일본어` env로 일부 언어만 실행 가능.
  - **false positive 방지**: ① 스캔 영역(메뉴/버튼/탭/테이블헤더/안내문구/섹션제목/폼라벨/placeholder + 확장분), 사용자 데이터(tbody 텍스트·.notice-content·.message-box) 배제. ② 번역 카테고리는 **한국어 baseline에 한글 있는 슬롯만** 대상. ③ KO↔FG 슬롯 미매칭 시 skip. ④ 글자잘림은 **leaf 텍스트만**(자식 레이아웃 오탐 차단). **전역 SNB/레이아웃은 홈서 1회 귀속**(seen 중복 제거, 기록된 FAIL만 카운트). 교차검증: 글자잘림·인코딩 전 언어 오탐 0, CJK가 혼재 오탐 안 냄 확인.
  - ✨ **스캔 zone 확장(2026-06-09, 누락 컴포넌트 보강)**: 초기 9영역이 tbody 전체 제외·요약카드/드롭다운 미포함으로 다수 누락 → `keepInData` zone 추가(데이터 영역도 스캔하되 시스템 요소만): **행버튼**(`tbody/.list-table-group button` — 삭제·보내기·스코어·클럽체크·확인서류)·**요약카드 라벨**(`.summary-card__label`/`__days` — 값 `__value`는 제외 → 총 스스회원 내장객·조회기간 기준 합계·일평균 등)·**드롭다운값**(`.vs__selected` — 코스 전체). 교차검증: 핀포지션/전체라운드/내장통계에서 시스템 텍스트 검출↑, 사용자 데이터(강태구·31명) **오염 0건**. 슬롯수 예: 전체라운드 50→80.
  - ⏭ **클릭 팝업 검증(feasibility 확인됨, 구현 예정)**: 행 버튼([스코어]/[클럽체크] 등) 클릭 시 팝업은 **같은 페이지 `.modal-group` 오버레이**(z-index 101, 예 `sc-scorecard-pop`)로 열림(새 탭 아님) → DOM 스캔 가능. 구현 접근: 한국어로 버튼 위치(nth) 식별 → 언어 전환 → 동일 버튼 클릭 → `.modal-group` 한글노출 스캔 → 닫기(비파괴 view 팝업). 스코어카드 가로/세로 전환은 팝업 내 토글 클릭 후 재스캔. (삭제 confirm은 취소로 비파괴)
  - **주요 검출(비영어 공통)**: 대회 화면 테이블헤더 16종 미번역 / SNB 대메뉴 `식음관리 & 테이블오더`·메뉴(소) 공란(내장 통계·라운드 설정 — 스크린샷 빈칸) / 안내문구 전문 / 버튼(검색·보기·신규 등록·URL복사) / placeholder. 부수: 요약카드 **i18n 키 누출 `ui.2971`** 관찰.
  - **메뉴 목록**: `langCheck.ts`의 `MENU_LIST`(IA_TREE 기반, 관제팝업·단체라운드 제외). 미구현(캐디피·식음 일부·식음료 평가) 자동 SKIP. 실행: `npx playwright test --project=admin-chromium Admin/lang-check-all.spec.ts --no-deps`.
  - ✨ **`lang-check-unified` 다수 메뉴 진입 실패 수정(2026-06-10)**: `Admin/lang-check-unified.spec.ts`(통합 단일 파일 — 모든 언어 순회) 실행 시 SKIP 47개(연쇄)→7개(정상 미구현)로 개선. 원인: `closeModalNonDestructive` 전략②.5가 스코어카드 팝업 내 [이전홀] 오클릭 → 언어 원복 차단 → SNB 영어화 → 한국어 메뉴명 탐색 전부 실패. 수정 후 결과: 영어 PASS 1,738 / FAIL 73 / SKIP 7(정당, 10.7분).
  - ✨ **토스트·에러 메시지 언어검증(완료 — 2026-06-09, 7개 언어 PASS 7/7)**: `withToastObserver`/`classifyToastText`(`lib/langCheck.ts`) + `Admin/lang-check-toast.spec.ts`. **트리거: 코스 운영 관리 > 골프장 소식 > [등록] 모달**(내용 textarea + 노출시간 vue-select 첫옵션 → **동일 날짜/시간 충돌**) 제출 → **중복 에러 토스트**(`동일날짜/동일시간에 골프장 소식이 존재…`). 레코드 미생성=사실상 비파괴(첫 제출이 생성해도 `withFixture` teardown이 마커행 `E2ELANGTOAST` 전수 삭제, 잔여 0 검증). 언어별 토스트 캡처→분류(한글노출/혼재/인코딩/정상-실제값). 결과: 7개 언어 모두 토스트 정상 번역(PASS) — 예 EN `There already exists golf club news…`/VI `Đã tồn tại tin tức sân golf…`/JA `同一の日時に、すでにゴルフ場ニュースが…`. 리포트 `reports/lang-check-toast_report_*.xlsx`. `ALLOW_DESTRUCTIVE` 가드(td17/킹즈락), 비활성 시 SKIP.
    - **핵심 교훈**: ① 토스트는 **찰나 노출 후 소멸** → 폴링 대신 **제출 전 `MutationObserver` 설치**(`withToastObserver`)로 포착. `.toast-box`(상주·빈 컨테이너) 폴링은 놓침. 폼 모달(textarea/input/vue-select 포함)은 캡처서 제외. ② **언어 전환 시 버튼 텍스트도 번역** → 폼 조작은 **클래스 셀렉터**(`button.button-common.primary` 등, 텍스트 `등록`/`취소` 금지). ③ 모달 미닫힘 시 헤더 **언어 전환 차단** → 전환 전 모달 확실히 닫기(취소=`button-common:not(.primary):not(danger)`, Escape 폴백)+전환 성공 검증. ④ 빈 조회·무효 날짜·무변경 저장·즉시반영 토글(아이콘)은 토스트 **미발생** → 실제 토스트는 **실변경 제출**에서만. 실행: `$env:ALLOW_DESTRUCTIVE="1"; npx playwright test --project=admin-chromium Admin/lang-check-toast.spec.ts --no-deps`.
> ⚠️ 2026-06-04 일괄 배치: 위 경기진행·캐디·배토기록·홀맵·코스 17종은 **locator 문서 생략**(JSON + suite 주석으로 근거 갈음), **안내문구 부분 일치** 검증(전문 일치는 추후 probe). TC참조 형식 `시트제목_1depth_No.` 적용.
- 배토 통계(`Admin/beto-stats.spec.ts` → `runBetoStats`), IA 커버리지(`Admin/ia-coverage.spec.ts`)
  - ⚠️ **배토 통계 재작성(2026-06-05)**: 기존 스펙이 리뉴얼 이전 레거시(구 URL `/ss/admin/rounding.html?act=beto_calc`·`beto-*` BEM·`조회`/`엑셀변환`·Highcharts SVG·`일자` 컬럼)였음 → 분석 JSON(`analysis/배토관리_배토_통계.json`, `/club/page/topdressing-statistics`) 실측 기준으로 `runBetoStats`(BSTAT-01~08) + 표준 패턴(openAdmin→gotoMenu→writeReport) 재작성. 차트는 **CANVAS**(svg 아님), 필터 활성 표기 `button-outline-primary`/`button-outline-default`.
- 분석 JSON: 라운드관리 7종 + 아이콘 관리 (`analysis/`)

**범위제외(⛔)** — `locators/admin-snb-renewal.md` 기준
- **관제팝업**: 별도 `window.open` 모니터링 창, IA 범위제외 → 자동화 안 함 (해당 분석 JSON은 홈 오캡처여서 삭제됨)
- **단체라운드**: 단체팀 고도화 별도 프로젝트

**관제관리 잔여 메모(2026-06-04 리뉴얼 기준 SNB)** — 관제 모니터(신규, 구 관제팝업?·범위제외 가능) / 메시지 기록 조회(구 "메시지 기기 조회")
- **메시지 기록 조회**(`/club/page/control-message-history`): ✅ **콘텐츠 구현 확인(2026-06-08)** — 과거 빈 화면이었으나 안내문구("센터와 태블릿 간의 메시지 기록을 조회…")·조회일 datepicker·검색어 input·초기화/적용·대화창(.message-box, To.{대상자}) 구현됨. `runMessageHistory`+`Admin/message-history.spec.ts` 작성(MSGHIST-01~06, PASS 7/0). ⚠ SNB 라벨은 **'메시지 기록 조회'**(IA 변경표의 '기기 조회' 표기와 달리 라이브=기록 조회) → `IA_TREE` 정정함.

**미착수(IA 대메뉴)** — 분석·문서·스위트 필요
- 관제관리 잔여(관제 모니터 — 범위제외 가능), 캐디피 관리(SNB 대메뉴 부재=전체 미구현), 고객 평가 관리>식음료 평가(SNB 부재=미구현) — **미구현/범위제외 (스크립트 대상 아님)**
  - ℹ️ **커버리지 갭 분석(2026-06-09)**: 실 SNB(대메뉴 13·소메뉴 44) 전수 대조 → 구현된 인스코프 기능 중 미스크립트는 **대회관리 1건뿐이었고 구현 완료**. 잔여 미스크립트(관제 모니터=팝업·단체 라운드=별도프로젝트)는 의도적 범위제외. 캐디피 관리·식음료 평가·식음 그늘집/식당품목매핑은 SNB 부재(미구현).
> ✅ 분석 JSON이 있던 메뉴는 전부 스크립트화 완료(2026-06-04). 예외: 관제관리>메시지 기록 조회(빈 화면), 라운드관리>단체라운드(범위제외).

## 새 화면 추가 절차 (반복 패턴)
1. `analysis/<메뉴>.json` 확보(`extractDom` 결과) → 2. `locators/admin-<메뉴>.md` 설계(요소·Locator·주의) → 3. `lib/suites.ts`에 `run<메뉴>(admin)` 추가(check/checkText, 비파괴) → 4. `Admin/<메뉴>.spec.ts`(openAdmin→gotoMenu→run→writeReport) → 5. `--list`로 컴파일 확인 → 6. 실행·리포트.

## 함정 (Gotchas)
- ⚠️ **헤더 GNB 타이틀 변경(2026-06-04 리뉴얼 배포)**: `경기관제` → **`관제 어드민`**. `openAdmin`(adminHelpers)·`auth.setup`은 헤더 텍스트 대신 **URL(`/club/`)+SNB(`.depth-1-title`)** 로 도달 판정. ✅ `runHome` No.1-①도 `관제 어드민`으로 정정 완료.
- ✅ **라운드관리 리뉴얼 드리프트 정정(2026-06-04)**: 내장 통계 검색버튼 `조회`→`적용`(No.18-②) · 내보내기 버튼 `엑셀파일 다운로드`→`내보내기`(No.1-③/No.17/No.50) · 내장 현황 `도움말` 버튼 제거(No.1-② 부재 확인+diff) · 전체라운드 컬럼 `중대재해 확인서`/`추가 확인서`(공백) · 내장 통계 No.33/45/50은 **데이터 의존 → 0건 시 SKIP** · No.26(1년 초과 알럿)은 데이트피커 달력전용+알림 자동핸들러로 **SKIP**.
- 인증 세션(`auth/.auth/admin.json`)은 수일 내 만료 → `--no-deps` 실행이 로그인 페이지로 빠지면 `--project=setup --headed`로 수동 재로그인.
- ⚠️ **알림 팝업 자동 [확인]**: `openAdmin`이 `.modal-footer`의 [확인]을 자동 클릭해 알림 닫음(취소/아니요/닫기 동반 confirm은 비파괴 보호로 건드리지 않음). → **알림 출현 자체를 검증하는 TC는 자동 닫힘과 충돌** → SKIP 처리(예: 내장 통계 1년 초과 No.26).
- ℹ️ **`gotoMenu` 자동 RAW 스캔**: 진입 성공 화면마다 `checkRawCode`(오타/미가공코드)를 자동 기록(`tcId:'RAW'`). 전 대메뉴 일괄 적용 — 별도 호출 불필요(홈만 gotoMenu 미경유라 runHome에서 명시). `gotoMenu(...,{scanRawCode:false})`로 끌 수 있음. 정합성(`checkRowCountVsTotal`)은 리스트+총건수 화면에 명시 적용.
- ℹ️ **파괴 테스트(옵트인)**: `Playwright_New/destructive.ts` — `ALLOW_DESTRUCTIVE=1` + 호스트(td17)/클럽(킹즈락) 화이트리스트 충족 시에만 실행, 기본 SKIP. `withFixture(setup,body,teardown)`로 원복. td17=개발/테스트, 킹즈락=비실데이터(확정). 케이스: ①카트 사용중지→확인→재개 ②홀별정산 사유 저장(토글ON 조건부) ③**진행시간 표준설정 입력변경→저장→초기화(Default 채움)→저장**(2026-06-08, teardown서 원본 9홀값 복원+저장, 각 단계 정합성·저장영속·초기화=Default 검증). 실행: `ALLOW_DESTRUCTIVE=1 npx playwright test --config=Playwright_New/playwright.config.ts -g "표준설정"`.
  - **Tier A·B 확장(2026-06-08)**: `Playwright_New/destructive-settings.e2e.spec.ts` — 설정 저장형(홀맵 구역/카트패스/티샷/태블릿 기능/아이콘/그린스피드) + 토글형(후기 숨김처리) 제너릭(단일요소 변경→저장→원복, 엔게이지 실패/커스텀 토글/진입 플레이크 시 graceful SKIP·데이터 무변경). 실행결과 2 PASS/5 SKIP/0 FAIL. 커스텀 토글 화면은 화면별 전용 케이스 추가 시 완전 커버. **파괴 테스트 확장 타당성 분석(Tier A~E) Confluence**: QA 검증[품질팀] 스페이스 `https://smartscoretech.atlassian.net/wiki/spaces/Q/pages/1935015942`.
  - **커스텀 토글 전용 + Tier C CRUD(2026-06-08)**: `Playwright_New/destructive-advanced.e2e.spec.ts` — 커스텀 토글(카트패스/태블릿 기능/아이콘): `input[id^=tgv-]`가 뷰포트 밖 hidden → `label[for]` 또는 `el.click()`로 조작 + 확인모달 처리 + 저장 → **3 PASS**(teardown 토글 원복; 태블릿은 confirm-즉시적용이라 teardown 직후 isChecked stale read 가능하나 영속상태는 원복됨). 캐디 CRUD(`캐디 수정/해지` 탭에서 더미 생성→삭제, teardown 잔여 0): 등록폼이 **자격취득일 datepicker(달력 전용)+vue-select** 검증으로 [저장] 활성화가 까다로워 미충족 시 graceful SKIP(오펀 데이터 0). 폼 필드별 완성은 잔여.
- ⚠️ **`closeModalNonDestructive` 전략②.5 제거(2026-06-10)**: 이전 세션에서 추가한 전략②.5 `button.button-common:not(.primary):not(.danger)`이 전체 라운드 > 스코어카드 팝업의 [이전홀]/[다음홀] 버튼을 오클릭 → 팝업 미닫힘 → `switchLanguage(한국어)` 차단(모달 열린 상태) → SNB 영어 유지 → 이후 모든 `navigateMenu(한국어 메뉴명)` 실패 → lang-check-unified 47개 연쇄 SKIP. **해결**: ①전략②.5 완전 제거 (Escape 폴백으로 충분). ②`button[class*="close"]`를 모달 컨테이너 내부로 스코프 한정 → `.modal-group button[class*="close"]` 등. ③배토 팝업 [닫기] 버튼(`cls="button-common primary xxsmall route-close-btn"`)은 modal-scoped `button[class*="close"]`로 포착(`.primary` 클래스여서 기존 `:not(.primary)` 전략 전부 회피했음). **진단 도구**: `Admin/_probe-beto-popup.spec.ts` — `openModalCount` 탐지 + 오버레이 루트·버튼 전수 출력.
- ⚠️ **데이트피커는 달력 전용**: `fill()`·키 입력이 모델에 반영 안 됨(값 되돌아감). 날짜 변경은 달력 클릭(`.datepicker-layer .text-num`, nav 이전/다음) 필요. ✨ **실동작 검증은 `commonActions.ts`의 `checkDateSearch`로 공통화**(2026-06-12) — 달력 열기→유효 날짜 셀 **DOM `el.click()`**(뷰포트 밖 팝업 대응)→[조회]/[적용]. `runCommonActions` 경유로 datepicker 보유 메뉴 전체 자동 적용(비파괴). 단순 노출/존재 검증은 각 suite의 `count≥N`이 계속 담당. **내장 통계 검색 버튼은 `조회`가 아니라 `적용`**(타 조회 화면은 `조회`) — runRoundMgmt No.18-② 정정함. `checkDateSearch`는 검색폼 내 `조회` 우선·없으면 `적용` 순으로 자동 대응.
- ⚠️ **TC/UI 텍스트 변경 드리프트(2026-06-05, TC문서 갱신 동반)**: ① 홀 이벤트 관리 — `홀이벤트`→**`홀 이벤트`**(띄어쓰기 추가: 메뉴·섹션·컬럼·버튼 `홀 이벤트 추가`). suite는 `/홀\s*이벤트/` 정규식으로 보정. 행 [수정/삭제]·아이템 카드는 데이터 의존(빈 상태 SKIP). ② 후기 리스트 — 버튼 `숨김 처리`→**`숨김처리`**(붙임), `/숨김\s*처리/`로 보정. → **공백 변동 가능 라벨은 정규식 매칭 권장**. TC 변경추적 기준선: `tc-baseline/2026-06-경기관제리뉴얼.md`(드라이브 id `1l8Gw…`).
- ⚠️ **TC/UI 변경 드리프트(2026-06-08, TC문서 06-07 갱신 동반)**: ① 캐디 실적 안내문구 개정 — `애사심`류 → `…사용자 등록을 하여, …골프장의 발전에 기여한 내역을 확인할 수 있습니다.`(QA-14896). suite는 `'골프장의 발전에 기여'` 부분일치로 보정. ② 계정 리스트 행 `[로그아웃]` 버튼은 **'로그인된 계정' 행에만 노출**(TC No.23 사전조건·QA-14837) → 데이터 의존 SKIP 가드. → 안내문구/데이터의존 버튼은 라이브 재추출로 확인 후 AS-IS 반영. TC 전체 시트 baseline: `tc-baseline/sheets/*.md`(xlsx 다운로드분).
- ⚠️ **UI 변경 드리프트(2026-06-16, all-suite 전수 재검출 → AS-IS 반영)**: 6/4 검증 이후 발생한 구현 변경 9건 검출(PASS 559→567, FAIL 10→0). **검출법**: all-suite 라이브 실행 → 개별/직렬(`--workers=1`) 재실행으로 진입 플레이크 제거 → 프로브(`Admin/_probe-drift.spec.ts`→`analysis/_drift_probe.json`)로 현재 실제값 덤프. **(A) 구조 변경(기능 제거)**: ① **관제 관리 > 카트이동경로 확인 메뉴 제거**(SNB에서 사라짐, `관제 모니터`로 통합 추정) → `cart-trace.spec.ts` 적응형 전환(present 시 검증·absent 시 `diff`+`skip`, 가짜 진입 FAIL 방지), all-suite STEPS에서 제거, IA가 '미구현' 추적. ② **배토 기록 조회 `작업 경로` 컬럼·행 `[보기]` 버튼 제거**(4컬럼: No./캐디/시작시간/종료시간) → BREC-03(4컬럼)/BREC-04(부재 확인)/BREC-05(제거 skip)+`diff`. **(B) 라벨·맞춤법 변경(AS-IS로 기대값 갱신)**: 라운드 통계 안내문구 `데이타→데이터` / 캐디리스트 `관제적용→관제 적용` / 홀맵구역 `구역관리→구역 관리` / 핀포지션 컬럼 `핀포지션→핀 포지션` / 코스분석 컬럼 `퍼팅수→퍼트수` / 후기통계 컬럼 `등록후기수→등록후기 수` / 주문내역 검색버튼 `검색→적용`(+diff). → **공백/맞춤법 정비가 주 패턴**(06-05 `홀이벤트→홀 이벤트`, `숨김처리`와 동일). 라벨 변경 가능 요소는 정규식·부분일치, 컬럼/버튼은 라이브 프로브로 실제값 확인 후 AS-IS 반영.
- ℹ️ **'진입' 플레이크**: 연속/개별 실행 시 일부 spec의 첫 `gotoMenu`가 openAdmin 직후 SPA 네비 레이스로 간헐 실패(특히 `account.spec`). 재실행 시 통과 — 스크립트 값 오류 아님. 단독 재실행으로 확정. all-suite는 해당 메뉴가 시퀀스 중간이라 진입 안정적 → 개별 첫메뉴 플레이크 확정용으로 all-suite 교차 활용.
- ℹ️ **리포트 구조(2026-06-08 개편)**: **전체 테스트** = `Admin/all-suite.spec.ts`(전 대메뉴 순회 → `writeReport('전체테스트')`) → **단일 문서, 탭=대메뉴명**(`canonMenu`로 '관제관리'/'관제 관리' 등 공백변동 통합). **개별 테스트** = 각 `Admin/<메뉴>.spec.ts`가 개별 문서(현행 유지). **요약 시트 = 테스트 현황 대시보드**(진행률/PASS·Fail Rate + 대메뉴별 전체/수행/PASS/FAIL/N/A(SKIP)/PASS율 + Total, [이슈 현황]=결함(FAIL)+기획-구현 차이). 색상·항목은 `reporter.ts` writeReport에서 조정.
- TypeScript 단독 미설치 → 타입검증은 `npx playwright test <spec> --list`(컴파일 겸함)로.
- `openAdmin`은 새 탭 타이밍 의존 회피 위해 `/club/` URL 폴링(최대 2회 클릭). 로그인/공지 팝업은 `addLocatorHandler`로 자동 처리.
- 결과 테이블 vs 검색폼은 **별도 `.contents-box`** — 테이블은 `.list-table-group`/`.table-overflow-item table`로 스코프.
- 안내문구 검증(`checkText`)은 **TC 원문 전체 일치**(공백 단일화만) → 띄어쓰기/문구 차이도 FAIL로 검출.
