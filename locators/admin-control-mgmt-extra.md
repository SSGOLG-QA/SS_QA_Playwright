# 관제 관리 (관제 모니터 · 메시지 기록 조회) - UI 요소 & Locator

> URL: `/club/page/control-message-history` (메시지 기록 조회)
> 클럽: 킹즈락
> 분석일: 2026-06-23 / 기준: lib/suites.ts `runMessageHistory()`, `runCartTrace()` 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 1. 메시지 기록 조회 (MSGHIST-01 ~ MSGHIST-06)

> URL: `/club/page/control-message-history`
> 안내문구: `.info-box-text` (전문 일치 `checkText`)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | MSGHIST-01 | 전문 일치 `checkText`: `'센터와 태블릿 간의 메시지 기록을 조회할 수 있습니다. 단, 한 달 이내의 메시지 기록만 보관됩니다.'` |
| 조회일 datepicker | `.contents-box:has-text("조회일") .datepicker-input` (first) | MSGHIST-02 | 형식 YYYY.MM.DD · `.contents-box` 스코프 필수 |
| 검색어 input | `getByPlaceholder('검색어를 입력하세요.')` | MSGHIST-03 | placeholder 일치 |
| [초기화] 버튼 | `searchBox.getByRole('button', { name: '초기화' })` | MSGHIST-04 | `.contents-box:has-text("조회일")` 스코프 |
| [적용] 버튼 | `searchBox.getByRole('button', { name: '적용' })` | MSGHIST-04 | `.contents-box:has-text("조회일")` 스코프 |
| 대화창 결과 영역 | `.message-box` (first) | MSGHIST-05 | 결과 컨테이너 노출 확인 |
| 대화 항목 수신자 | `.message-box:first` 내 `To.{대상자}` 텍스트 포함 | MSGHIST-06 | ⚠️ 데이터 의존 — 조회 결과 없으면 SKIP (`/To\./` 정규식 검사 후 분기) |

### 진입 안정화

```typescript
// 페이지 진입 후 안내문구 노출까지 대기 (최대 10초, 실패 시 무시)
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
```

### 검색 영역 스코프 패턴

```typescript
// '조회일' 텍스트를 포함한 .contents-box 로 스코프 한정 → 다른 페이지의 동명 버튼과 충돌 방지
const searchBox = admin.locator('.contents-box').filter({ hasText: '조회일' });

// 조회일 datepicker
await expect(searchBox.locator('.datepicker-input').first()).toBeVisible();

// 초기화 / 적용 버튼
await expect(searchBox.getByRole('button', { name: '초기화' })).toBeVisible();
await expect(searchBox.getByRole('button', { name: '적용' })).toBeVisible();
```

### 결과 영역 패턴

```typescript
const messageBox = admin.locator('.message-box');

// MSGHIST-05: 결과 영역 노출
await expect(messageBox.first()).toBeVisible();

// MSGHIST-06: 데이터 존재 시만 검증 (데이터 의존)
const msgTxt = (await messageBox.first().innerText().catch(() => '')).trim();
if (msgTxt && /To\./.test(msgTxt)) {
  await expect(messageBox.first()).toContainText('To.');
} else {
  // skip — 조회 결과 없음
}
```

### ⚠️ 주의 사항

- **MSGHIST-06** 은 데이터 의존 TC: 조회 결과가 없거나 `To.` 패턴이 없으면 자동 SKIP 처리됨
- `[초기화]`, `[적용]` 버튼은 반드시 `searchBox` 스코프 안에서 접근 — 페이지 내 동명 버튼 충돌 방지
- 안내문구는 `checkText` 전문 일치 검증: 문자열 변경 시 MSGHIST-01 실패

---

## 2. 카트 이동경로 확인 (CARTTRACE-01 ~ CARTTRACE-06)

> URL: `/club/page/live-cart-trace`
> ⚠️ 비파괴 원칙: 지도 상호작용·경로재생·슬라이더 조작 검증 제외 — 필터·지도 컨테이너·컨트롤 **노출만** (클릭 금지)
> ⚠️ 재생 컨트롤(Ok/Clear/Prev/Next/Auto Start/Auto Stop) 클릭 시 재생/상태 변경 → **노출만 검증, 클릭 금지**
> 🔴 기획-구현 차이: UI 미한글화(영문) · 날짜 형식 YYYY-MM-DD(대시) — 기록 필수

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 조회일 datepicker | `.datepicker-input` (first) | CARTTRACE-01 | 🔴 형식 YYYY-MM-DD(대시) — 타 화면 YYYY.MM.DD와 불일치 |
| 캐디/조건 vue-select | `new VueSelect(admin)` count ≥ 1 | CARTTRACE-02 | 🔴 레이블 'Caddie' — 미한글화 |
| 지도 컨테이너 | `.map-box` (first) | CARTTRACE-03 | 진입 안정화 대상 — `waitFor` 사용 |
| [지도] 전환 버튼 | `button[title="지도"]` (first) | CARTTRACE-03b-1 | 비파괴(노출만) · Kakao Maps SDK 렌더링 버튼(innerText 없음) |
| [스카이뷰] 전환 버튼 | `button[title="스카이뷰"]` (first) | CARTTRACE-03b-2 | 비파괴(노출만) · `title` 속성으로만 식별 |
| [Ok] 컨트롤 버튼 | `ctrlBox.getByRole('button', { name: 'Ok', exact: true })` (first) | CARTTRACE-04-1 | 비파괴(노출만) · 클릭 금지 |
| [Clear] 컨트롤 버튼 | `ctrlBox.getByRole('button', { name: 'Clear', exact: true })` (first) | CARTTRACE-04-2 | 비파괴(노출만) · 클릭 금지 |
| [Prev] 컨트롤 버튼 | `ctrlBox.getByRole('button', { name: 'Prev', exact: true })` (first) | CARTTRACE-04-3 | 비파괴(노출만) · 클릭 금지 |
| [Next] 컨트롤 버튼 | `ctrlBox.getByRole('button', { name: 'Next', exact: true })` (first) | CARTTRACE-04-4 | 비파괴(노출만) · 클릭 금지 |
| [Auto Start] 컨트롤 버튼 | `ctrlBox.getByRole('button', { name: 'Auto Start', exact: true })` (first) | CARTTRACE-04-5 | 비파괴(노출만) · 클릭 금지 |
| [Auto Stop] 컨트롤 버튼 | `ctrlBox.getByRole('button', { name: 'Auto Stop', exact: true })` (first) | CARTTRACE-04-6 | 비파괴(노출만) · 클릭 금지 |
| 재생 슬라이더 | `.path-slider` (first) | CARTTRACE-05 | 비파괴(노출만) · 조작 금지 |
| 슬라이더 값 박스 | `.slider-val-box` (first) | CARTTRACE-06-1 | `toBeAttached()` — 재생 전 비표시 가능, 구조 존재만 검증 |
| 시각 박스 | `.time-box` (first) | CARTTRACE-06-2 | `toBeAttached()` — 재생 시 갱신 |
| 가속/정확도 박스 | `.acc-box` (first) | CARTTRACE-06-3 | `toBeAttached()` — 재생 전 비표시 가능성 높음 |

### 진입 안정화

```typescript
// 지도 컨테이너 노출까지 대기 (최대 10초, 실패 시 무시)
await admin.locator('.map-box').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
```

### 재생 컨트롤 스코프 패턴

```typescript
// 'Auto Start' 텍스트를 포함한 .contents-box 로 스코프 한정
const ctrlBox = admin.locator('.contents-box').filter({ hasText: 'Auto Start' });

// 재생 컨트롤 버튼 노출 검증 (클릭 금지 — 비파괴)
for (const b of ['Ok', 'Clear', 'Prev', 'Next', 'Auto Start', 'Auto Stop']) {
  await expect(ctrlBox.getByRole('button', { name: b, exact: true }).first()).toBeVisible();
}
```

### 지도 타입 토글 버튼 패턴

```typescript
// Kakao Maps SDK가 렌더링하는 버튼 — innerText 없음, title 속성으로만 식별
// 클릭 금지 (비파괴): 지도 타입 전환 발생
await expect(admin.locator('button[title="지도"]').first()).toBeVisible();
await expect(admin.locator('button[title="스카이뷰"]').first()).toBeVisible();
```

### 재생 상태 박스 패턴

```typescript
// 재생 전 일부 요소는 비표시 가능 → toBeVisible() 대신 toBeAttached() 사용
await expect(admin.locator('.slider-val-box').first()).toBeAttached();
await expect(admin.locator('.time-box').first()).toBeAttached();
await expect(admin.locator('.acc-box').first()).toBeAttached();  // 재생 전 비표시 가능성 높음
```

### 🔴 기획-구현 차이 기록

| 구분 | 기획(예상) | 구현(실제) | TC 참조 | 조치 |
|------|-----------|-----------|---------|------|
| UI 언어 | 한글 (확인/초기화/이전/다음/자동재생 등) | 영문 (Ok/Clear/Prev/Next/Auto Start/Auto Stop/Caddie) | `관제 관리_카트이동경로 확인_4` | 미한글화 — 기능 정상, QA·기획 확인 요망 |
| 날짜 형식 | YYYY.MM.DD (타 화면과 일관) | YYYY-MM-DD (대시) | `관제 관리_카트이동경로 확인_1` | 날짜 형식 불일치 — QA 확인 요망 |

### ⚠️ 주의 사항

- **재생 컨트롤 버튼 6종** (`Ok`/`Clear`/`Prev`/`Next`/`Auto Start`/`Auto Stop`) 은 클릭 시 재생 상태 변경 → **노출 검증만, 절대 클릭 금지**
- **지도/스카이뷰 토글** 은 클릭 시 지도 타입 전환 → **노출 검증만, 클릭 금지**
- **`.path-slider`** 슬라이더는 조작 시 재생 위치 변경 → **노출 검증만, 조작 금지**
- **`.acc-box`** 는 재생 전 DOM에 존재하나 비표시일 수 있으므로 `toBeVisible()` 대신 `toBeAttached()` 사용
- **`button[title]`** 패턴은 Kakao Maps SDK 전용 — SDK 버전 변경 시 속성 변경 가능성 있음
- **vue-select** 카운트는 `new VueSelect(admin).count()` 헬퍼 사용 — `≥ 1` 조건으로 데이터 의존성 최소화

---

## 공통 참조

### 메뉴 그룹 구조

```
관제 관리
├── 관제 모니터                  (별도 suite — 본 문서 미포함)
├── 메시지 기록 조회             → runMessageHistory()  MSGHIST-01~06
└── 카트 이동경로 확인           → runCartTrace()        CARTTRACE-01~06
```

### TC 참조 시트 매핑

| 함수 | TC 참조 접두사 (드라이브 시트) |
|------|-------------------------------|
| `runMessageHistory()` | `관제 관리_메시지 기록 조회_N` |
| `runCartTrace()` | `관제 관리_카트이동경로 확인_N` |

### 공통 진입 안정화 패턴

```typescript
// 메시지 기록 조회: 안내문구 노출 대기
await admin.locator('.info-box-text').first()
  .waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

// 카트 이동경로 확인: 지도 컨테이너 노출 대기
await admin.locator('.map-box').first()
  .waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
```

### 비파괴 검증 원칙 요약

| 검증 수준 | 사용 메서드 | 적용 대상 |
|-----------|------------|-----------|
| 노출 확인 | `toBeVisible()` | 일반 UI 요소 |
| 구조 존재 확인 | `toBeAttached()` | 재생 전 숨김 가능 요소 (`.acc-box` 등) |
| 텍스트 포함 | `toContainText()` | 동적 데이터 항목 (`To.{대상자}`) |
| 전문 일치 | `checkText()` 헬퍼 | 안내문구 고정 텍스트 |
| 클릭 금지 | — | 재생 컨트롤·지도 토글·슬라이더 |
