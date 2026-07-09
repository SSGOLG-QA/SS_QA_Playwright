# 캐디피 관리 4종 (캐디피 설정 · 통계 · 결제내역 · 캐디자료/신고서) - UI 요소 & Locator

> URL: `/club/page/caddy-fee-*` / 클럽: 킹즈락
> 분석일: 2026-06-23 / 기준: `lib/suites.ts` run*() 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID(`tgv-N-*`) 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 목차

1. [캐디피 설정 (CPSET-01~05)](#1-캐디피-설정-cpset-01~05)
2. [캐디피 통계 (CPSTAT-01~07)](#2-캐디피-통계-cpstat-01~07)
3. [캐디피 결제 내역 (CPAY-01~07)](#3-캐디피-결제-내역-cpay-01~07)
4. [캐디 자료/신고서 (CPDOC-01~05)](#4-캐디-자료신고서-cpdoc-01~05)
5. [공통 주의사항](#5-공통-주의사항)

---

## 1. 캐디피 설정 (CPSET-01~05)

> URL: `/club/page/caddy-fee-settings` (추정)
> 안내문구: `.info-box-text` — 부분 일치 `'캐디피'` (전문 일치 아님)
> 초기 대기: `.info-box-text, .contents-box` 중 first() visible 대기 (timeout 10s)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내 문구 컨테이너 | `.info-box-text` | CPSET-01 | `toContainText('캐디피')` — 부분 일치 ⚠️ 전문 일치 아님 |
| 기능 설정 섹션 | `.contents-box` filter `{ hasText: /감사팁\|기능\s*설정/ }` `.first()` | CPSET-02 | 감사팁 결제 영역 포함 컨테이너 |
| 감사팁 결제 토글 | `featureBox.locator('input[type="checkbox"], input[id^="tgv-"]')` | CPSET-03 | ⚠️ `count() >= 1` 확인만 — 비파괴·클릭 금지 |
| 금액 설정 섹션 | `.contents-box` filter `{ hasText: /금액\|캐디\s*피/ }` `.first()` | CPSET-04 | 섹션 존재 여부만 확인 |
| [저장] 버튼 | `getByRole('button', { name: '저장' }).first()` | CPSET-05 | ⚠️ 비파괴 — 노출·활성 확인만, 클릭 금지 |

```typescript
// CPSET: 핵심 로케이터
const infoBox = admin.locator('.info-box-text');
await expect(infoBox).toContainText('캐디피'); // 부분 일치

const featureBox = admin.locator('.contents-box')
  .filter({ hasText: /감사팁|기능\s*설정/ })
  .first();

// 토글 — 동적 ID(tgv-N-*) 직접 참조 금지, featureBox 스코프 내에서 접근
const toggleCount = await featureBox
  .locator('input[type="checkbox"], input[id^="tgv-"]')
  .count();
expect(toggleCount).toBeGreaterThanOrEqual(1);

const amountBox = admin.locator('.contents-box')
  .filter({ hasText: /금액|캐디\s*피/ })
  .first();

const saveBtn = admin.getByRole('button', { name: '저장' }).first();
await expect(saveBtn).toBeVisible(); // 클릭 금지
```

### CPSET 주의사항

- **CPSET-03**: `input[id^="tgv-"]` — 동적 ID 패턴. 반드시 `featureBox` 스코프 내에서 locator 체이닝. 전역 사용 금지.
- **CPSET-05**: `.contents-box`에 저장 버튼이 여러 개 존재할 수 있음 → `.first()` 필수. 클릭 절대 금지(데이터 변경).
- **금액 설정(CPSET-04)**: 정규식 `/금액|캐디\s*피/` — `캐디 피`(공백 포함) 및 `캐디피` 모두 매칭.

---

## 2. 캐디피 통계 (CPSTAT-01~07)

> URL: `/club/page/caddy-fee-statistics` (추정)
> 초기 대기: `.contents-box` first() visible 대기 (timeout 10s)
> 🔴 비파괴: 조회·뷰만. 금전 처리 화면 → Severity Critical 기준 적용

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 기간 검색 입력(from) | `.datepicker-input, input[placeholder*="날짜"]` `.first()` | CPSTAT-01 | datepicker from 필드 |
| [초기화] 버튼 | `getByRole('button', { name: '초기화' }).first()` | CPSTAT-02 | ⚠️ 비파괴 — 클릭 금지 |
| [검색]/[적용] 버튼 | `getByRole('button', { name: /검색\|적용/ }).first()` | CPSTAT-03 | 정규식 매칭 — 버튼명 둘 중 하나 |
| 결제금액 추이 차트 | `canvas` | CPSTAT-04 | ⚠️ `count() >= 1` — 데이터 의존 |
| 결제유형 비율 섹션 | `.contents-box` filter `{ hasText: /결제\s*유형\|비율/ }` `.first()` | CPSTAT-05 | 차트 또는 섹션 컨테이너 |
| 결제 금액 순위 탭 | `.tab-group` `.first()` `.locator('li, button, .tab-item')` | CPSTAT-06 | `count() >= 1` 확인 — 탭 4종 추정 |
| 상세 내역 테이블 | `.list-table-group table, .table-overflow-item table` `.first()` | CPSTAT-07 | `toBeAttached()` — DOM 존재 확인(visible 아님) |

```typescript
// CPSTAT: 핵심 로케이터
const datepickerFrom = admin
  .locator('.datepicker-input, input[placeholder*="날짜"]')
  .first();

const resetBtn = admin.getByRole('button', { name: '초기화' }).first();
const searchBtn = admin.getByRole('button', { name: /검색|적용/ }).first();

// 차트 — canvas 개수만 확인(데이터 의존)
const canvasCount = await admin.locator('canvas').count();
expect(canvasCount).toBeGreaterThanOrEqual(1);

const payTypeBox = admin.locator('.contents-box')
  .filter({ hasText: /결제\s*유형|비율/ })
  .first();

// 순위 탭 — .tab-group 첫 번째 스코프 내 탭 아이템
const rankTabCount = await admin.locator('.tab-group').first()
  .locator('li, button, .tab-item')
  .count();
expect(rankTabCount).toBeGreaterThanOrEqual(1);

// 테이블 — toBeAttached: 비가시 상태여도 DOM에 존재하면 통과
const detailTable = admin
  .locator('.list-table-group table, .table-overflow-item table')
  .first();
await expect(detailTable).toBeAttached();
```

### CPSTAT 주의사항

- **CPSTAT-04**: `canvas` 태그는 차트 라이브러리 렌더링 결과. 데이터가 없으면 canvas 자체가 미생성될 수 있음 — 데이터 의존.
- **CPSTAT-06**: `.tab-group` 클래스가 페이지에 여러 개일 경우 `.first()` 스코프 적용. 탭 4종(일별/주별/월별/캐디별 등) 추정이나 코드상 `>= 1` 확인만.
- **CPSTAT-07**: `toBeAttached()` 사용 — `toBeVisible()`과 다름. 테이블이 숨김(`display:none`) 상태여도 DOM에 붙어 있으면 통과.

---

## 3. 캐디피 결제 내역 (CPAY-01~07)

> URL: `/club/page/caddy-fee-payment` (추정)
> 초기 대기: `.info-box-text, .contents-box` 중 first() visible 대기 (timeout 10s)
> 🔴 비파괴: 조회·내보내기 노출만. 금전 처리 결제 내역 → Critical/High TC 경계값·예외 2배 적용

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내 문구 | `.info-box-text` | CPAY-01 | `toBeVisible()` — 텍스트 내용 미검증 |
| 기간 검색 입력 | `.datepicker-input, input[placeholder*="날짜"]` `.first()` | CPAY-02 | 검색 필터 영역(기간/조건) |
| [초기화] 버튼 | `getByRole('button', { name: '초기화' }).first()` | CPAY-03 | ⚠️ 비파괴 — 클릭 금지 |
| [검색]/[적용] 버튼 | `getByRole('button', { name: /검색\|적용/ }).first()` | CPAY-04 | 정규식 매칭 |
| [내보내기]/[다운로드] 버튼 | `getByRole('button', { name: /내보내기\|다운로드/ }).first()` | CPAY-05 | ⚠️ 비파괴 — 노출·`toBeEnabled()` 확인만, 클릭 금지 |
| 결제 내역 테이블 | `.list-table-group table, .table-overflow-item table` `.first()` | CPAY-06 | `toBeAttached()` |
| 빈 결과 안내 행 | `.empty-row, td:has-text("조회된"), td:has-text("데이터가")` | CPAY-07 | ⚠️ 데이터 의존 — 빈 결과 또는 데이터 행 중 하나 존재하면 통과 |
| 데이터 행 (빈결과 대안) | `.list-table-group tbody tr, .table-overflow-item tbody tr` | CPAY-07 | CPAY-07의 대안 조건 (OR 로직) |

```typescript
// CPAY: 핵심 로케이터
const infoBox = admin.locator('.info-box-text');
await expect(infoBox).toBeVisible();

const datepicker = admin
  .locator('.datepicker-input, input[placeholder*="날짜"]')
  .first();

const exportBtn = admin
  .getByRole('button', { name: /내보내기|다운로드/ })
  .first();
await expect(exportBtn).toBeVisible();
await expect(exportBtn).toBeEnabled(); // 클릭 금지 — enabled 상태만 확인

const paymentTable = admin
  .locator('.list-table-group table, .table-overflow-item table')
  .first();
await expect(paymentTable).toBeAttached();

// CPAY-07: 빈 결과 OR 데이터 행 존재 (데이터 의존 경계값)
const hasEmpty = (await admin
  .locator('.empty-row, td:has-text("조회된"), td:has-text("데이터가")')
  .count()) > 0;
const hasData = (await admin
  .locator('.list-table-group tbody tr, .table-overflow-item tbody tr')
  .count()) > 0;
expect(hasEmpty || hasData, '테이블(데이터) 또는 빈결과 안내 중 하나 존재해야 함').toBeTruthy();
```

### CPAY 주의사항

- **CPAY-05**: `[내보내기]` 버튼은 `toBeEnabled()` 검증 포함. 클릭 시 파일 다운로드 발생 → 절대 클릭 금지.
- **CPAY-07 (경계값)**: 실 검증은 데이터 의존. "데이터 없는 기간"을 선택해야 `.empty-row` 노출. 현재 코드는 **빈 결과 구조 OR 데이터 행** 중 하나만 존재해도 통과하는 OR 로직으로 처리.
  - `td:has-text("조회된")` — "조회된 데이터가 없습니다" 류 문구 셀
  - `td:has-text("데이터가")` — 동일 목적의 대안 셀 텍스트
- **CPAY-01 vs CPSET-01**: CPAY-01은 텍스트 내용 미검증(`toBeVisible()` 만). CPSET-01은 `toContainText('캐디피')` 부분 일치 검증.

---

## 4. 캐디 자료/신고서 (CPDOC-01~05)

> URL: `/club/page/caddy-fee-document` (추정)
> 초기 대기: `.info-box-text, .contents-box` 중 first() visible 대기 (timeout 10s)
> 🔴 비파괴: [불러오기]/[내보내기] 노출만(실행 금지). [초기화]도 클릭 금지. 금전·세무 자료 → Critical 기준.

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 사업자 과세 자료 섹션 | `.contents-box` filter `{ hasText: /사업자\|과세\s*자료\|신고서/ }` `.first()` | CPDOC-01 | 섹션 제목 또는 영역 노출 확인 |
| [불러오기] 버튼 | `getByRole('button', { name: /불러오기/ }).first()` | CPDOC-02 | ⚠️ 비파괴 — 노출 확인만, 클릭 금지 |
| [초기화] 버튼 | `getByRole('button', { name: '초기화' }).first()` | CPDOC-03 | ⚠️ 비파괴 — 클릭 금지 (세무 데이터 초기화 위험) |
| [내보내기] 버튼 | `getByRole('button', { name: /내보내기/ }).first()` | CPDOC-04 | ⚠️ 비파괴 — 노출 확인만, 클릭 금지 |
| 자료 목록 테이블 | `.list-table-group table, .table-overflow-item table, .contents-box table` `.first()` | CPDOC-05 | `toBeAttached()` — 3가지 셀렉터 복합 |

```typescript
// CPDOC: 핵심 로케이터
const taxDocBox = admin.locator('.contents-box')
  .filter({ hasText: /사업자|과세\s*자료|신고서/ })
  .first();
await expect(taxDocBox).toBeVisible();

// [불러오기] — 정규식 매칭, 클릭 금지
const loadBtn = admin.getByRole('button', { name: /불러오기/ }).first();
await expect(loadBtn).toBeVisible();

// [초기화] — exact match, 클릭 금지
const resetBtn = admin.getByRole('button', { name: '초기화' }).first();
await expect(resetBtn).toBeVisible();

// [내보내기] — 정규식 매칭, 클릭 금지
const exportBtn = admin.getByRole('button', { name: /내보내기/ }).first();
await expect(exportBtn).toBeVisible();

// 자료 테이블 — CPDOC은 .contents-box table 셀렉터 추가(다른 메뉴와 차이)
const docTable = admin
  .locator('.list-table-group table, .table-overflow-item table, .contents-box table')
  .first();
await expect(docTable).toBeAttached();
```

### CPDOC 주의사항

- **CPDOC-02 [불러오기]**: 정규식 `/불러오기/` 사용 — 버튼명에 접두어/접미어가 붙어도 매칭. 세무 데이터 로딩 트리거이므로 클릭 절대 금지.
- **CPDOC-03 [초기화]**: `exact: true` 상당(`name: '초기화'`) — 다른 메뉴의 초기화 버튼과 동일 패턴이나 **세무/신고서 화면**에서의 초기화는 Critical 위험도. 클릭 절대 금지.
- **CPDOC-05**: 타 메뉴 대비 `.contents-box table` 셀렉터가 추가됨. 자료/신고서 화면의 테이블 구조가 일반 `.list-table-group` 밖에 위치할 수 있음을 의미.
- **CPDOC-04 vs CPAY-05**: CPAY-05는 `toBeEnabled()` 추가 검증 포함이나 CPDOC-04는 `toBeVisible()` 만. 활성 상태 검증 불필요하거나 항상 활성 추정.

---

## 5. 공통 주의사항

### 5-1. 메뉴별 초기 대기 셀렉터 비교

| 메뉴 | 초기 대기 셀렉터 | timeout |
|------|----------------|---------|
| 캐디피 설정 | `.info-box-text, .contents-box` | 10s |
| 캐디피 통계 | `.contents-box` | 10s |
| 캐디피 결제 내역 | `.info-box-text, .contents-box` | 10s |
| 캐디 자료/신고서 | `.info-box-text, .contents-box` | 10s |

> 캐디피 통계만 `.info-box-text` 없음 — 통계 화면에는 안내 문구 박스가 없을 가능성.

### 5-2. 버튼명 매칭 방식 비교

| 버튼 | 매칭 방식 | exact 여부 |
|------|----------|-----------|
| `저장` | `name: '저장'` | exact (기본값) |
| `초기화` | `name: '초기화'` | exact (기본값) |
| `검색`/`적용` | `name: /검색\|적용/` | 정규식 — 둘 중 하나 |
| `내보내기`/`다운로드` | `name: /내보내기\|다운로드/` | 정규식 — 둘 중 하나 |
| `불러오기` | `name: /불러오기/` | 정규식 — 부분 포함 |

### 5-3. toBeAttached vs toBeVisible

```typescript
// toBeAttached: DOM에 존재하면 통과 (숨김 상태 허용)
await expect(table).toBeAttached();   // CPSTAT-07, CPAY-06, CPDOC-05

// toBeVisible: 화면에 실제 보여야 통과
await expect(section).toBeVisible();  // CPSET-02, CPSET-04, CPSTAT-05 등
```

> 테이블은 스크롤 밖이거나 조건부 렌더링 전 상태일 수 있어 `toBeAttached()` 사용.

### 5-4. 비파괴(데이터 변경 금지) 요소 목록

| 메뉴 | 요소 | TC ID | 이유 |
|------|------|-------|------|
| 캐디피 설정 | [저장] 버튼 | CPSET-05 | 캐디피 설정값 변경 |
| 캐디피 설정 | 감사팁 토글 | CPSET-03 | 기능 ON/OFF 변경 |
| 캐디피 통계 | [초기화] 버튼 | CPSTAT-02 | 검색 조건 리셋 |
| 캐디피 결제 내역 | [내보내기] 버튼 | CPAY-05 | 파일 다운로드 발생 |
| 캐디피 결제 내역 | [초기화] 버튼 | CPAY-03 | 검색 조건 리셋 |
| 캐디 자료/신고서 | [불러오기] 버튼 | CPDOC-02 | 세무 데이터 로딩 트리거 |
| 캐디 자료/신고서 | [초기화] 버튼 | CPDOC-03 | 세무/신고서 데이터 초기화 (Critical) |
| 캐디 자료/신고서 | [내보내기] 버튼 | CPDOC-04 | 세무 파일 다운로드 발생 |

### 5-5. runCommonActions 공통 액션

모든 4개 메뉴 함수 말미에 `await runCommonActions(admin, P, R)` 호출됨. 공통 액션 내용은 별도 문서 참조.

### 5-6. 데이터 의존 요소

| TC ID | 요소 | 의존 조건 |
|-------|------|----------|
| CPSTAT-04 | `canvas` 차트 | 해당 기간 결제 데이터 존재 시 렌더링 |
| CPSTAT-06 | 순위 탭 | 탭 렌더링은 데이터 또는 설정 의존 |
| CPAY-07 | `.empty-row` / 데이터 행 | 조회 기간 내 결제 데이터 유무에 따라 분기 |
