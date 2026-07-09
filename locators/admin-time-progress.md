# 경기 진행 관리 4종 (진행시간 표준설정 · 실시간 · 조회 · 통계) - UI 요소 & Locator

> URL: `/club/page/control-time-standard` (표준설정) / 클럽: 킹즈락
> 분석일: 2026-06-23 / 기준: lib/suites.ts `runTimeStandard()` 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID(tgv-N-*) 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 1. 진행시간 표준 설정 (TSTD-01 ~ TSTD-11)

> URL: `/club/page/control-time-standard`
> 안내문구: `.info-box-text` (전문 일치)

### 1-1. 안내 문구

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 컨테이너 | `.info-box-text` | TSTD-01 | `checkText` 전문 일치, `.first()` 사용 |

**TSTD-01 기대 전문:**
```
진행시간을 평가하고 관리할 수 있도록 사전에 표준적인 진행시간을 다양하게 설정할 수 있습니다.
모든 홀에 시간이 설정되어 있어야 평가 및 관리가 가능하며 데이터 산출이 가능합니다.
*코스대기: 해당코스가 후반인 경우 표준적인 중간 대기시간
```

```typescript
// 안내문구 — 진입 후 최대 10초 대기
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
const infoBox = admin.locator('.info-box-text');
```

---

### 1-2. 코스 선택 패널

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 코스 선택 패널 | `.course-panel` | TSTD-02 | `.first()` 노출 확인, 데이터 의존 |
| 코스 카드 (South/East/West 등) | `.course-card` | TSTD-02 | `count() ≥ 1` 확인, 데이터 의존 |

> ⚠️ **데이터 의존**: `.course-card` 개수는 클럽 코스 구성에 따라 가변. 최소 1개 이상 노출 확인.

```typescript
// 코스 패널 및 카드
const coursePanel = admin.locator('.course-panel').first();
const courseCards = admin.locator('.course-card');
await expect(coursePanel).toBeVisible();
expect(await courseCards.count()).toBeGreaterThanOrEqual(1);
```

---

### 1-3. 홀별 입력 카드

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 홀 카드 컨테이너 | `.hole-card` | TSTD-03 | `count() ≥ 1` 확인, 데이터 의존 |
| 진행시간 입력 필드 | `.hole-card` > `input` (nth(0)) | TSTD-09/10 | 첫 번째 input = 진행시간(분) |
| 다음홀 대기 입력 필드 | `.hole-card` > `input` (nth(1)) | TSTD-09 | 두 번째 input = 다음홀대기(분) |

> ⚠️ **데이터 의존**: `.hole-card` 개수는 선택된 코스 홀 수(9홀/18홀)에 따라 가변.
> ⚠️ 각 카드 내 `input` 순서 — `nth(0)`: 진행시간, `nth(1)`: 다음홀대기. 순서 변경 시 TC 전체 영향.

```typescript
// 홀 카드 전체 순회 — 진행시간·다음홀대기 합산
const holes = admin.locator('.hole-card');
const holeCount = await holes.count();
for (let i = 0; i < holeCount; i++) {
  const inputs = holes.nth(i).locator('input');
  const playTime = await inputs.nth(0).inputValue();   // 진행시간(분)
  const waitTime = await inputs.nth(1).inputValue();   // 다음홀대기(분)
}

// TSTD-10: 첫 번째 홀 진행시간 변경 테스트 (비파괴·복구)
const firstHolePlay = admin.locator('.hole-card').first().locator('input').nth(0);
const orig = await firstHolePlay.inputValue();
await firstHolePlay.fill(String(parseInt(orig || '0') + 10));
await firstHolePlay.blur();
await admin.waitForTimeout(700);
// ... 검증 후 원상복구 (저장 안 함)
await firstHolePlay.fill(orig);
await firstHolePlay.blur();
```

---

### 1-4. 코스대기 설정 및 요약 패널

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 코스대기 설정 박스 | `.course-wait-box` | TSTD-04 | `.first()` 노출 확인 |
| 요약 패널 | `.summary-panel` | TSTD-04 | `.first()` 노출 확인 |
| 요약 > 경기시간 | `.summary-panel` innerText 내 `경기시간 H:MM` 패턴 | TSTD-07/09/10/11 | 정규식 추출: `/경기시간\s*(\d+:\d+)/` |
| 요약 > 홀간대기 | `.summary-panel` innerText 내 `홀간대기 H:MM` 패턴 | TSTD-07/09/11 | 정규식 추출: `/홀간대기\s*(\d+:\d+)/` |
| 요약 > 전체시간 | `.summary-panel` innerText 내 `전체시간 H:MM` 패턴 | TSTD-07/09/10/11 | 정규식 추출: `/전체시간\s*(\d+:\d+)/` |

> ⚠️ **정합성 불변식**: `전체시간 = 경기시간 + 홀간대기` — 모든 상태(초기·입력변경·권장값 적용)에서 성립해야 함.

```typescript
// 요약 패널 시간값 추출 헬퍼 (분 단위 변환)
const t2m = (s: string) => {
  const m = (s || '').match(/(\d+)\s*:\s*(\d+)/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
};

const summaryText = (await admin.locator('.summary-panel').first().innerText()).replace(/\s+/g, ' ');
const gameMatch  = summaryText.match(/경기시간\s*(\d+:\d+)/);
const waitMatch  = summaryText.match(/홀간대기\s*(\d+:\d+)/);
const totalMatch = summaryText.match(/전체시간\s*(\d+:\d+)/);
const gameMin  = gameMatch  ? t2m(gameMatch[1])  : NaN;
const waitMin  = waitMatch  ? t2m(waitMatch[1])  : NaN;
const totalMin = totalMatch ? t2m(totalMatch[1]) : NaN;
```

---

### 1-5. 하단 요약 테이블 컬럼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 컬럼 헤더 '코스명' | `getByRole('columnheader', { name: '코스명', exact: false })` | TSTD-05-1 | `.first()` 사용 |
| 컬럼 헤더 '경기시간' | `getByRole('columnheader', { name: '경기시간', exact: false })` | TSTD-05-2 | `.first()` 사용 |
| 컬럼 헤더 '홀간대기' | `getByRole('columnheader', { name: '홀간대기', exact: false })` | TSTD-05-3 | `.first()` 사용 |
| 컬럼 헤더 '코스대기' | `getByRole('columnheader', { name: '코스대기', exact: false })` | TSTD-05-4 | `.first()` 사용 |
| 컬럼 헤더 '전체시간' | `getByRole('columnheader', { name: '전체시간', exact: false })` | TSTD-05-5 | `.first()` 사용 |

```typescript
// 하단 테이블 컬럼 헤더 순회 검증
const columns = ['코스명', '경기시간', '홀간대기', '코스대기', '전체시간'];
for (const col of columns) {
  await expect(admin.getByRole('columnheader', { name: col, exact: false }).first()).toBeVisible();
}
```

---

### 1-6. 액션 버튼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| [초기화] 버튼 | `getByRole('button', { name: '초기화', exact: true })` | TSTD-06-1 | 노출 확인만 (비파괴), `.first()` |
| [저장] 버튼 | `getByRole('button', { name: '저장', exact: true })` | TSTD-06-2 | 노출 확인만 (비파괴), `.first()` |
| [권장값 적용] 버튼 | `getByRole('button', { name: '권장값 적용', exact: true })` | TSTD-06-3 | TSTD-11에서 정합성 검증 목적으로만 클릭, `.first()` |
| [이전 코스 값 복사] 버튼 | `getByRole('button', { name: '이전 코스 값 복사', exact: true })` | TSTD-06-4 | 노출 확인만 (비파괴), `.first()` |

> ⚠️ **비파괴 원칙**:
> - `[저장]` 버튼 — 노출·활성 확인만. 클릭 금지.
> - `[이전 코스 값 복사]` 버튼 — 노출·활성 확인만. 클릭 금지.
> - `[초기화]` 버튼 — TSTD-11 시나리오에서 권장값 적용 후 원상복구 목적으로만 클릭. 단독 클릭 금지.
> - `[권장값 적용]` 버튼 — TSTD-11 시나리오에서 정합성 검증 후 즉시 `[초기화]`로 복구. 저장 없음.

```typescript
// 버튼 노출 확인 (비파괴)
const buttons = ['초기화', '저장', '권장값 적용', '이전 코스 값 복사'];
for (const btn of buttons) {
  await expect(admin.getByRole('button', { name: btn, exact: true }).first()).toBeVisible();
}

// TSTD-11: 권장값 적용 → 정합 검증 → 초기화 복구 (비저장)
await admin.getByRole('button', { name: '권장값 적용' }).first().click().catch(() => {});
await admin.waitForTimeout(1200);
// ... 정합성 검증 ...
await admin.getByRole('button', { name: '초기화' }).first().click().catch(() => {});  // 복구
await admin.waitForTimeout(800);
```

---

### 1-7. 정합성 검증 — 코스 카드 + 요약 패널 자동 계산

| 검증 항목 | 관련 Locator | TC ID | 불변식 |
|-----------|-------------|-------|--------|
| 전체시간 = 경기시간 + 홀간대기 (요약·코스카드) | `.summary-panel, .course-card` | TSTD-07 | `전체 = 경기 + 홀간대기` |
| 라운드 자동계산 전체 = 전반 + 후반 | `table:has-text('전반')` > `td` | TSTD-08 | `전체 = 전반(경기+홀간) + 후반(경기+홀간)` |
| 경기시간 = Σ진행시간, 홀간대기 = Σ다음홀대기 | `.hole-card input`, `.summary-panel` | TSTD-09 | 입력값 합산 = 요약 표시값 |
| 입력변경 즉시 반영 (+10분) | `.hole-card` first `input` nth(0), `.summary-panel` | TSTD-10 | Δ경기시간 = Δ진행시간 = +10 |
| 권장값 적용 후 전체=경기+홀간 불변 | `.summary-panel`, `[권장값 적용]`, `[초기화]` | TSTD-11 | 적용 후에도 불변식 유지 |

```typescript
// TSTD-07: 복합 블록(summary-panel + course-card) 정합 검증
const blocks = admin.locator('.summary-panel, .course-card');
const blockCount = await blocks.count();
let checked = 0;
for (let i = 0; i < blockCount; i++) {
  const txt = (await blocks.nth(i).innerText()).replace(/\s+/g, ' ');
  const totalM = txt.match(/전체시간\s*(\d+:\d+)/);
  const gameM  = txt.match(/경기시간\s*(\d+:\d+)/);
  const waitM  = txt.match(/홀간대기\s*(\d+:\d+)/);
  if (totalM && gameM && waitM) {
    expect(t2m(totalM[1])).toBe(t2m(gameM[1]) + t2m(waitM[1]));
    checked++;
  }
}
expect(checked).toBeGreaterThanOrEqual(1);

// TSTD-08: 라운드 테이블(전반 포함) td 시간토큰 순서
// [경기前, 홀간前, 코스대기, 전체, 경기後, 홀간後] — 6개 단위 반복
const roundTable = admin.locator('table').filter({ hasText: '전반' });
```

---

## 공통 주의사항

| 항목 | 설명 |
|------|------|
| 시간 포맷 | `H:MM` 또는 `MM:SS` 형식 — `(\d+):(\d+)` 패턴으로 파싱, 분 단위 환산: `시×60 + 분` |
| 데이터 의존 요소 | `.course-card`, `.hole-card` — 클럽 코스/홀 구성에 따라 개수 가변. 항상 `count() ≥ 1` 조건으로 검증 |
| 비파괴 복구 패턴 | 값 변경 후 반드시 원래 값으로 `fill()` 복구. `[저장]` 클릭 없이 종료 |
| `.first()` 사용 이유 | 동일 클래스명/역할 요소가 코스별로 반복 렌더링되므로 중복 방지를 위해 `.first()` 필수 |
| `waitFor` 패턴 | 진입 시 `.info-box-text` 최대 10초 대기 (`.catch(() => {})` — 타임아웃 무시 후 계속 진행) |
| 정합성 불변식 | `전체시간 = 경기시간 + 홀간대기` — 초기 진입·입력 변경·권장값 적용 등 모든 상태에서 반드시 성립 |
