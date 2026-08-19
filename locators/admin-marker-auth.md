# 라운드 관리 > 마커 인증 조회 (신규 화면)

> **학습 근거**: JIRA 3건(라이브 미캡처) — **QA-15254**(미번역·구조 노출)·**QA-15177**(초기화 버튼 부재)·**QA-15108**(검색 제약). 태블릿 고도화(MFUU-2) 범위.
> locator는 **JIRA 근거 설계값(⚠ 라이브 DOM 확인 필요)**. 확정 캡처: `Admin/_probe-marker-auth.spec.ts`(`npm run auth` 후 실행 → `analysis/라운드관리_마커_인증_조회.json`).
> **비파괴 원칙**: 조회(읽기) 화면 — [조회]/[초기화]는 검색 실행(비파괴). 결과 테이블은 데이터 의존.

## 개요
- **위치**: SNB `라운드 관리` 신규 하위 메뉴 **`마커 인증 조회`** (스코어 출력 설정 **다음**, 라운드 관리 최하위). [[score-output-setting]]와 이웃 신규 메뉴.
- **목적**: **마커(스코어 기록자) 인증 내역** 조회. 라운드별 플레이어/마커 인증 상태를 **라운드 목록** 형태로 조회(읽기 전용).
- **URL**: ⚠ 미확정 — 프로브로 확정(추정 `/club/page/marker-auth*` 또는 `/club/page/round-marker*`). 라이브 확인 필요.
- **SNB 순서**(추정, score-output locator 근거): …홀별 정산 관리·카트 관리·**스코어 출력 설정**·**마커 인증 조회**.
- **다국어**: `MENU_LIST`(langCheck) 이미 포함(2026-07-30). QA-15254 = 한글 외 언어 미번역 결함(완료) → 회귀 감시 대상.

## 화면 구성 (섹션별)

### ① 검색 영역
| 요소 | Locator(설계) | TC ID | 비고 |
|------|--------------|-------|------|
| **라운드 일자** (기간 datepicker) | 검색폼 스코프 후 `.datepicker-input` | MKAUTH-01 | QA-15108: 과거 **최대 1년 제한** 버그(예상=제한 없이). 시작~종료 기간 추정 |
| **플레이어명** input | `input[placeholder="플레이어명"]` | MKAUTH-02 | QA-15108: **maxlength 20**(20자까지만 입력, 예상결과). QA-15254: 미번역 대상 |
| **[조회]** 버튼 | 검색폼 스코프 `button:has-text("조회")` | MKAUTH-03 | 검색 실행(비파괴) |
| **[초기화]** 버튼 | 검색폼 스코프 `button:has-text("초기화")` | MKAUTH-04 | QA-15177: **원래 부재** → 통일성 위해 추가 요청(개선, **완료**) → 현재 존재 추정. ⚠ 라이브 확인(부재 시 diff 추적) |

### ② 결과 테이블 — `라운드 목록`
| 요소 | Locator(설계) | TC ID | 비고 |
|------|--------------|-------|------|
| 테이블 제목 | `라운드 목록` (sub-title-box) | MKAUTH-05 | QA-15254 명시 |
| 테이블 | `.table-overflow-item table` / `.list-table-group` | MKAUTH-05 | |
| 컬럼 `라운드 일자` | `columnheader` | MKAUTH-06a | QA-15254 명시 |
| 컬럼 `티오프` | `columnheader` | MKAUTH-06b | QA-15254 명시(티업 시각) |
| 컬럼 `플레이어` | `columnheader` | MKAUTH-06c | QA-15254 명시 |
| (추정) 코스·마커·인증상태 컬럼 | — | MKAUTH-06d | ⚠ JIRA 미명시 → **프로브로 전수 확정 필요** |
| 결과 행(≥1) | `tbody tr` | MKAUTH-07 | 데이터 의존(0건 시 skip) |
| 빈 상태 안내 | `[class*="empty"]` | MKAUTH-07 | 결과 없음 문구(라이브 확인) |

## 알려진 이슈(JIRA · diff/모니터링)
| JIRA | 유형 | 내용 | 상태 | 처리 |
|------|------|------|------|------|
| QA-15254 | 버그 | 한글 외 언어 미번역(라운드 일자·플레이어명·라운드 목록·티오프·플레이어) | 완료 | langCheck 회귀 감시(MENU_LIST 포함) |
| QA-15177 | 개선 | 검색영역 [초기화] 버튼 부재 → 추가 요청 | 완료 | MKAUTH-04 존재 확인(부재 시 diff) |
| QA-15108 | 버그 | 라운드 일자 1년 제한·플레이어명 20자 초과 입력 | 완료 | 기간/maxlength 검증 시 참고 |

## 검증 전략 (2축 · 비파괴)
- **검증축(PASS/FAIL)**: 검색폼(라운드 일자 datepicker·플레이어명 input·[조회]·[초기화]) 노출 + 결과 테이블(`라운드 목록`) 컬럼 노출. 데이터 있으면 행 ≥1.
- **상태/데이터 의존**: 결과 행은 검색 조건·데이터 의존 → 0건 시 `skip`(사유 명시). 컬럼 전수는 프로브 확정 후 AS-IS 반영.
- **추적축(diff/INFO)**: [초기화] 부재·미번역 잔존·1년 제한 등은 JIRA 완료건 → 회귀 시 재감지(diff).
- **공통동작**: datepicker 실조회(`runCommonActions`의 `checkDateSearch`) 적용 가능(검색폼에 datepicker 有).

### TC ID 요약
| TC ID | 항목 | 검증 |
|-------|------|------|
| MKAUTH-01 | 라운드 일자 datepicker | 노출 |
| MKAUTH-02 | 플레이어명 input | 노출(ph·maxlength) |
| MKAUTH-03 | [조회] 버튼 | 노출 |
| MKAUTH-04 | [초기화] 버튼 | 노출(부재 시 diff) |
| MKAUTH-05 | 라운드 목록 테이블 | 노출 |
| MKAUTH-06a~c | 컬럼(라운드 일자·티오프·플레이어) | 노출 |
| MKAUTH-06d | 추가 컬럼 | 프로브 확정 후 |
| MKAUTH-07 | 결과 행 ≥1 | 데이터 의존(0건 skip) |

## 다음 세션 착수 절차 (라이브)
1. `npm run auth`(td17 킹즈락 수동 로그인) → 세션 갱신.
2. `npx playwright test --project=admin-chromium Admin/_probe-marker-auth.spec.ts --no-deps` → `analysis/라운드관리_마커_인증_조회.json` 확정(URL·컬럼 전수·초기화 버튼 존부).
3. 프로브 결과로 이 문서 AS-IS 확정 + `lib/suites.ts`에 `runMarkerAuth(admin)`(MKAUTH-01~07) 작성.
4. `runRoundMgmt` 말미 **STEP 9**로 편입(스코어 출력 설정 다음) — [[score-output-setting]] 편입과 동일 패턴. `IA_TREE`는 이미 '마커 인증 조회' 등록(학습 대기 → 확정 시 note 갱신).
5. `Admin/marker-auth.spec.ts`(개별 스펙) 작성 → `--list` 컴파일 확인 → 실행·리포트.

> ⚠ **미착수 사유**: 본 세션(비파괴 검증 자동화, 2026-08-18)은 **td17 세션 만료**(admin.json TTL 소진)로 라이브 캡처 불가 → JIRA 근거 설계까지만 완료. 프로브·suite·spec 코드는 다음 로컬 세션에서 완결.
