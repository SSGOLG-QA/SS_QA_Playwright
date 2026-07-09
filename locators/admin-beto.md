# 배토 관리 2종 (배토 기록 조회 · 배토 통계) - UI 요소 & Locator

> URL: `/club/page/topdressing-record` (배토 기록 조회) / `/club/page/topdressing-statistics` (배토 통계)
> 클럽: 킹즈락
> 분석일: 2026-06-23 / 기준: lib/suites.ts `runBetoRecord()` · `runBetoStats()` 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID(tgv-N-*) 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 1. 배토 기록 조회 (BREC-01 ~ BREC-25)

> URL: `/club/page/topdressing-record`
> 안내문구: `.info-box-text` (전문 일치 `checkText`)
> ⚠️ `[보기]` 버튼 및 `작업 경로` 컬럼은 2026-06-16 드리프트로 제거됨 → 4컬럼(No./캐디/시작시간/종료시간) AS-IS

### 1-1. 페이지 구조

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 컨테이너 | `.info-box-text` | BREC-01 | 4영역 구조 확인 시 기준 요소 |
| 콘텐츠 박스 (≥2) | `.contents-box` | BREC-01 | `count() >= 2` 검증 |
| 타이틀 "배토 기록 조회" | `getByText('배토 기록 조회', { exact: true }).first()` | BREC-02 | `toBeAttached()` |

### 1-2. 안내문구

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | BREC-03 | `checkText` 전문 일치 |

> **전문 일치 텍스트:**
> `캐디들이 태블릿 앱으로 배토모드를 통해 입력한 배토기록을 조회할 수 있습니다.`

### 1-3. 검색조건 (조회기간)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 날짜 입력 (시작) | `.datepicker-input` (nth(0)) | BREC-04 | `inputValue() != ''` 기본값 확인 |
| 날짜 입력 (종료) | `.datepicker-input` (nth(1)) | BREC-04 | `inputValue() != ''` 기본값 확인 |
| datepicker 전체 | `.datepicker-input` | BREC-04 | `count() >= 2` |
| [적용] 버튼 | `getByRole('button', { name: '적용', exact: true })` | BREC-04 | 비파괴(노출만) |
| [초기화] 버튼 | `getByRole('button', { name: '초기화' })` | BREC-04 | 비파괴(노출만) |

> ⚠️ **BREC-06 SKIP**: 조회기간 1년 초과 시 토스트 알럿 — `openAdmin` 자동 알림 핸들러(확인 버튼) 충돌로 달력 상호작용 불가

### 1-4. 검색기능 (작업자 선택)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 작업자 선택 드롭다운 | `VueSelect` (커스텀 클래스) | BREC-10 | `new VueSelect(admin).count() >= 1` |
| 기본값 "전체" | `.vs__selected` (filter `hasText: '전체'`) `.first()` | BREC-11 | `toBeVisible()` |

> ⚠️ **BREC-12 SKIP**: 캐디 선택 후 테이블 반영 — 데이터 의존(등록 활성 캐디 필요), 비파괴 구조 검증으로 갈음

```typescript
// 작업자 선택 VueSelect 드롭다운
const vueSelect = new VueSelect(admin);
expect(await vueSelect.count()).toBeGreaterThanOrEqual(1);

// 기본값 "전체" 확인
const selectedOption = admin.locator('.vs__selected').filter({ hasText: '전체' }).first();
await expect(selectedOption).toBeVisible();
```

### 1-5. 기록 조회 테이블

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 총 건수 표시 | `.contents-box` (filter `/총\s*\d+건/`) `.first()` | BREC-15 | `toBeVisible()` |
| 컬럼 'No.' | `getByRole('columnheader', { name: 'No.', exact: false }).first()` | BREC-16-1 | |
| 컬럼 '캐디' | `getByRole('columnheader', { name: '캐디', exact: false }).first()` | BREC-16-2 | |
| 컬럼 '시작시간' | `getByRole('columnheader', { name: '시작시간', exact: false }).first()` | BREC-16-3 | |
| 컬럼 '종료시간' | `getByRole('columnheader', { name: '종료시간', exact: false }).first()` | BREC-16-4 | |
| [보기] 버튼 부재 확인 | `getByRole('button', { name: '보기', exact: true })` | BREC-17 | `toHaveCount(0)` — 제거 확인 |

> ⚠️ **드리프트(2026-06-16)**: `작업 경로` 컬럼 및 행 `[보기]` 버튼 제거 → 4컬럼(No./캐디/시작시간/종료시간)으로 AS-IS 갱신
> ⚠️ **BREC-13**: 총 건수 vs 렌더 행 수 정합성 — `checkRowCountVsTotal()` 사용
> ⚠️ **BREC-14 SKIP**: 배토 기록 없음 안내문구 `"배토 기록이 없습니다."` — 데이터 의존(빈 상태 재현 불가, 비파괴)
> ⚠️ **BREC-18 SKIP**: 작업경로 보기 팝업(No.18~23) — `[보기]` 버튼·컬럼 제거(2026-06-16 드리프트) N/A

```typescript
// 총 건수 정규식 매칭
const totalCount = admin.locator('.contents-box').filter({ hasText: /총\s*\d+건/ }).first();
await expect(totalCount).toBeVisible();

// [보기] 버튼 제거 확인 (count = 0)
await expect(admin.getByRole('button', { name: '보기', exact: true })).toHaveCount(0);

// 컬럼 헤더 확인 예시
for (const col of ['No.', '캐디', '시작시간', '종료시간']) {
  await expect(admin.getByRole('columnheader', { name: col, exact: false }).first()).toBeVisible();
}
```

### 1-6. 페이지네이션

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 페이지네이션 컴포넌트 | `.paging-group, .pagination, [class*="paging"]` `.first()` | BREC-24 | `toBeAttached()` — 데이터 의존(20건 초과 시 노출) |

> ⚠️ **BREC-25 SKIP**: 페이지 번호 선택 시 리스트 이동 — 데이터 의존(20건 초과 필요), 비파괴 컴포넌트 존재 검증으로 갈음

---

## 2. 배토 통계 (BSTAT-01 ~ BSTAT-CALC-AVG)

> URL: `/club/page/topdressing-statistics`
> 안내문구: `.info-box-text` (전문 일치 `checkText`)
> ⚠️ 차트는 Highcharts(SVG) 아닌 **CANVAS** 기반
> ⚠️ 초기화/적용/내보내기/필터 전환은 조회(읽기) 동작 → 노출·활성만 검증(클릭 금지, 비파괴)
> ⚠️ 카드 라벨은 일별/월별 모드에 따라 접두(`일별 …`) 가변 → substring 매칭

### 2-1. 안내문구

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | BSTAT-01 | `checkText` 전문 일치 |

> **전문 일치 텍스트:**
> `배토 작업자 수, 작업 시간과 관련된 통계를 확인할 수 있습니다. 일별 또는 월별 기준으로 표와 그래프를 함께 확인할 수 있으며, 엑셀 변환도 가능합니다.`

### 2-2. 검색조건 (조회기간)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| datepicker 전체 (≥2) | `.datepicker-input` | BSTAT-02 | `count() >= 2` |
| [적용] 버튼 | `getByRole('button', { name: '적용', exact: true }).first()` | BSTAT-02 | 비파괴(노출만) |
| [초기화] 버튼 | `getByRole('button', { name: '초기화' }).first()` | BSTAT-02 | 비파괴(노출만) |

### 2-3. 필터 버튼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| [작업자] 버튼 | `getByRole('button', { name: '작업자', exact: true }).first()` | BSTAT-03-1 | 비파괴(노출만) |
| [작업시간] 버튼 | `getByRole('button', { name: '작업시간', exact: true }).first()` | BSTAT-03-2 | 비파괴(노출만) |
| [일별] 버튼 | `getByRole('button', { name: '일별', exact: true }).first()` | BSTAT-03-3 | 비파괴(노출만) |
| [월별] 버튼 | `getByRole('button', { name: '월별', exact: true }).first()` | BSTAT-03-4 | 비파괴(노출만) |

### 2-4. 필터 기본 활성 상태

| 요소 | Locator | TC ID | 활성 클래스 | 비고 |
|------|---------|-------|------------|------|
| [작업자] 활성 | `getByRole('button', { name: '작업자', exact: true }).first()` | BSTAT-04 | `button-outline-primary` | 기본 활성 |
| [일별] 활성 | `getByRole('button', { name: '일별', exact: true }).first()` | BSTAT-04 | `button-outline-primary` | 기본 활성 |
| [작업시간] 비활성 | `getByRole('button', { name: '작업시간', exact: true }).first()` | BSTAT-04 | `button-outline-default` | 기본 비활성 |
| [월별] 비활성 | `getByRole('button', { name: '월별', exact: true }).first()` | BSTAT-04 | `button-outline-default` | 기본 비활성 |

```typescript
// 필터 기본 활성 상태 확인
await expect(admin.getByRole('button', { name: '작업자', exact: true }).first()).toHaveClass(/button-outline-primary/);
await expect(admin.getByRole('button', { name: '일별', exact: true }).first()).toHaveClass(/button-outline-primary/);
await expect(admin.getByRole('button', { name: '작업시간', exact: true }).first()).toHaveClass(/button-outline-default/);
await expect(admin.getByRole('button', { name: '월별', exact: true }).first()).toHaveClass(/button-outline-default/);
```

### 2-5. 카드 요약 4종

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| '총 작업자 수' 카드 | `.card-label` (filter `hasText: '총 작업자 수'`) `.first()` | BSTAT-05-1 | 접두 가변 → substring 매칭 |
| '평균 작업자 수' 카드 | `.card-label` (filter `hasText: '평균 작업자 수'`) `.first()` | BSTAT-05-2 | 접두 가변 → substring 매칭 |
| '최대 작업자 수' 카드 | `.card-label` (filter `hasText: '최대 작업자 수'`) `.first()` | BSTAT-05-3 | 접두 가변 → substring 매칭 |
| '최소 작업자 수' 카드 | `.card-label` (filter `hasText: '최소 작업자 수'`) `.first()` | BSTAT-05-4 | 접두 가변 → substring 매칭 |

> ⚠️ 카드 라벨은 일별/월별 전환 시 `일별 총 작업자 수` 등 접두가 붙어 가변됨 → `hasText` substring 매칭 사용

```typescript
// 카드 요약 substring 매칭 예시
for (const label of ['총 작업자 수', '평균 작업자 수', '최대 작업자 수', '최소 작업자 수']) {
  await expect(admin.locator('.card-label').filter({ hasText: label }).first()).toBeVisible();
}
```

### 2-6. 그래프 영역

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 그래프 섹션 타이틀 | `getByText('통계 그래프', { exact: false }).first()` | BSTAT-06 | |
| 차트 canvas (≥1) | `canvas` | BSTAT-06 | `count() >= 1` — CANVAS 기반(Highcharts SVG 아님) |

```typescript
// 그래프 영역 + canvas 확인
await expect(admin.getByText('통계 그래프', { exact: false }).first()).toBeVisible();
expect(await admin.locator('canvas').count()).toBeGreaterThanOrEqual(1);
```

### 2-7. 통계표 컬럼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 컬럼 'No.' | `getByRole('columnheader', { name: 'No.', exact: false }).first()` | BSTAT-07-1 | |
| 컬럼 '날짜' | `getByRole('columnheader', { name: '날짜', exact: false }).first()` | BSTAT-07-2 | |
| 컬럼 '작업자 수' | `getByRole('columnheader', { name: '작업자 수', exact: false }).first()` | BSTAT-07-3 | |
| 컬럼 '작업시간 합계' | `getByRole('columnheader', { name: '작업시간 합계', exact: false }).first()` | BSTAT-07-4 | |
| 컬럼 '평균 작업시간' | `getByRole('columnheader', { name: '평균 작업시간', exact: false }).first()` | BSTAT-07-5 | |

### 2-8. 액션 버튼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| [내보내기] 버튼 | `getByRole('button', { name: '내보내기' }).first()` | BSTAT-08 | 비파괴(노출만, 클릭 금지) |

### 2-9. 계산 정합성 (BSTAT-CALC)

> ⚠️ 데이터 의존 — 통계표에 데이터 행이 존재할 때만 실행

| 검증 항목 | 산식 | TC ID | 허용 오차 |
|-----------|------|-------|-----------|
| 행별 평균 작업시간 | `평균 작업시간 = 작업시간 합계 / 작업자 수` | BSTAT-CALC | ±0.1 |
| 요약 총 작업자 수 | `총 작업자 수 = Σ(통계표 작업자 수)` | BSTAT-CALC-SUM | 정확 일치 |
| 요약 평균 작업자 수 | `평균 작업자 수 = 총 작업자 수 / 구간 수` | BSTAT-CALC-AVG | ±0.1 |

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 통계표 | `.table-overflow-item table, table` `.first()` | BSTAT-CALC | `DataGrid` 래퍼 사용 |
| '총 작업자 수' 카드 값 | `.summary-card, .stat-card, [class*="card"]` (filter `/총\s*작업자\s*수/`) `.first()` | BSTAT-CALC-SUM | `innerText()` 수치 추출 |
| '평균 작업자 수' 카드 값 | `.summary-card, .stat-card, [class*="card"]` (filter `/평균\s*작업자\s*수/`) `.first()` | BSTAT-CALC-AVG | `innerText()` 수치 추출 |

```typescript
// DataGrid 기반 통계표 파싱
const bsGrid = new DataGrid(admin.locator('.table-overflow-item table, table').first());
if (!(await bsGrid.isEmpty().catch(() => true))) {
  const rows = (await bsGrid.records()).map(rec => ({
    date:    pickCell(rec, /날짜/),
    workers: DataGrid.num(pickCell(rec, /작업자수/)),
    totalH:  DataGrid.num(pickCell(rec, /작업시간합계/)),
    avgH:    DataGrid.num(pickCell(rec, /평균작업시간/)),
  }));
}

// 카드 수치 추출 헬퍼
const cardNum = async (re: RegExp) =>
  DataGrid.num(
    await admin.locator('.summary-card, .stat-card, [class*="card"]')
      .filter({ hasText: re }).first().innerText().catch(() => '')
  );
const totalW = await cardNum(/총\s*작업자\s*수/);
const avgW   = await cardNum(/평균\s*작업자\s*수/);
```

---

## 공통 주의사항

| 항목 | 내용 |
|------|------|
| 초기 로딩 대기 | `admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 })` — 양 페이지 공통 |
| 비파괴 원칙 | `[초기화]`, `[적용]`, `[내보내기]`, 필터 버튼(`[작업자]`/`[작업시간]`/`[일별]`/`[월별]`) — 노출·활성 클래스 검증만, **클릭 금지** |
| 데이터 의존 TC | BREC-12(캐디 선택), BREC-14(빈 결과), BREC-25(페이지 이동), BSTAT-CALC 시리즈 — 테스트 환경 데이터 상태에 따라 실행 여부 결정 |
| SKIP TC | BREC-06(1년 초과 알럿), BREC-12, BREC-14, BREC-18(팝업), BREC-25 |
| 드리프트 기록 | 2026-06-16: `작업 경로` 컬럼 + `[보기]` 버튼 제거 — BREC-17로 부재 확인, BREC-18 N/A |
| VueSelect | `.vs__selected` (선택값 표시), `VueSelect` 커스텀 클래스 래퍼 사용 |
| 총 건수 정규식 | `/총\s*\d+건/` — 공백 포함 가변 형식 대응 |
