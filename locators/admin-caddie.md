# 캐디 관리 3종 (캐디 리스트 · 등록 관리 · 실적) - UI 요소 & Locator

> URL: `/club/page/caddie-list` · `/club/page/caddie-register` · `/club/page/caddie-performance` / 클럽: 킹즈락
> 분석일: 2026-06-24 / 기준: `lib/suites.ts` runCaddieList / runCaddieRegister / runCaddiePerformance 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID(tgv-N-*) 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 1. 캐디 리스트 (TC ID: CADL-01 ~ CADL-06)

> URL: `/club/page/caddie-list`
> 안내문구: `CaddieListPage` PageObject → `page.info()` (전문 일치 `checkText`)
> ⚠️ 그래프·통계카드·필터는 데이터 의존 — count ≥ 기준값으로 검증

### 1-1. 안내문구

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `page.info()` (CaddieListPage 내부 구현) | CADL-01 | 전문 일치 `checkText` / 기대값: `'골프장에 등록되어 있는 캐디 현황을 확인할 수 있습니다.'` |

### 1-2. 그래프 카드 & 차트

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 그래프 카드 (하우스·활동·회원 비율) | `page.graphCards()` | CADL-02 | `count() ≥ 3` / 데이터 의존 |
| 차트 canvas | `page.canvas()` | CADL-02 | `count() ≥ 1` / 데이터 의존 |

```typescript
// 그래프 카드 3종 이상 + canvas 1개 이상 노출 확인
expect(await page.graphCards().count()).toBeGreaterThanOrEqual(3);
expect(await page.canvas().count()).toBeGreaterThanOrEqual(1);
```

### 1-3. 통계 카드

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 통계 카드 (총 등록 캐디/활동 캐디/운영 비율 등) | `page.statCards()` | CADL-03 | `count() ≥ 1` / 데이터 의존 |

```typescript
expect(await page.statCards().count()).toBeGreaterThanOrEqual(1);
```

### 1-4. 필터 영역

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 필터 컨테이너 | `page.filter` | CADL-04 | `count() ≥ 1` |
| 활동 상태 vue-select | `page.filter` 내 vue-select 구현 | CADL-04 | CaddieListPage 내부 구현 |
| 캐디명 입력 | `page.nameSearch()` | CADL-04 | `toBeVisible()` |
| [적용] 버튼 | `page.applyBtn().first()` | CADL-04 | `toBeVisible()` / 비파괴(클릭 금지) |
| [초기화] 버튼 | CaddieListPage 내부 구현 | CADL-04 | 비파괴(클릭 금지) |

```typescript
expect(await page.filter.count()).toBeGreaterThanOrEqual(1);
await expect(page.nameSearch()).toBeVisible();
await expect(page.applyBtn().first()).toBeVisible();
```

### 1-5. 테이블 컬럼

> ⚠️ 드리프트(2026-06-17): '회원추천' 컬럼 제거 + '구분'·'등록일'·'해지일' 추가 → 현재 12컬럼 (AS-IS)
> 헤더 목록: `page.headers()` 로 취득 후 `hasCol()` 정확 일치 검증

| 컬럼명 | TC ID | 비고 |
|--------|-------|------|
| No | CADL-05-1 | |
| 성명 | CADL-05-2 | |
| 구분 | CADL-05-3 | ✨ 2026-06-17 신규 추가 |
| 성별 | CADL-05-4 | |
| 휴대폰 | CADL-05-5 | |
| 카트번호 | CADL-05-6 | |
| 태블릿 No. | CADL-05-7 | |
| 배터리 | CADL-05-8 | |
| 등록일 | CADL-05-9 | ✨ 2026-06-17 신규 추가 |
| 해지일 | CADL-05-10 | ✨ 2026-06-17 신규 추가 |
| 라운드기록 | CADL-05-11 | |
| 그늘집주문 | CADL-05-12 | |
| ~~회원추천~~ | ~~CADL-05-x~~ | ❌ 2026-06-17 제거됨 |

```typescript
// 헤더 배열 취득 후 정확 일치 검증
const cadlHeaders = await page.headers();
// hasCol(cadlHeaders, '성명') → true 여부 확인
expect(hasCol(cadlHeaders, '구분'), `컬럼 '구분' 정확 일치 (실제: ${cadlHeaders.join('/')})`).toBeTruthy();
```

### 1-6. 액션 버튼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| [관제 적용] 버튼 | `page.controlApplyBtn()` | CADL-06 | `toBeVisible()` / 비파괴(클릭 금지) |

```typescript
await expect(page.controlApplyBtn()).toBeVisible();
```

---

## 2. 캐디 등록 관리 (TC ID: CADR-01 ~ CADR-05)

> URL: `/club/page/caddie-register`
> 안내문구: `admin.locator('.info-box-text')` (전문 일치 `checkText`)
> ⚠️ 드리프트(2026-06-17): 구분·성별 radio(`.check-item`) → select(`placeholder '선택'`) 변경, 자격취득일 컬럼 추가

### 2-1. 안내문구

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `admin.locator('.info-box-text')` | CADR-01 | 전문 일치 `checkText` / 기대값: `'캐디를 등록하거나 등록된 캐디 정보를 수정, 삭제할 수 있습니다.'` |

```typescript
// 안내문구 로드 대기
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
const infoBox = admin.locator('.info-box-text');
```

### 2-2. 탭

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 탭 컨테이너 (캐디 등록 관리 / 캐디 수정·해지) | — | CADR-02 | 탭 2종 노출 확인 |
| [캐디 수정/해지] 탭 | `admin.getByText('캐디 수정/해지', { exact: false }).first()` | CADR-02 | `toBeVisible()` |

```typescript
await expect(admin.getByText('캐디 수정/해지', { exact: false }).first()).toBeVisible();
```

### 2-3. 등록 폼

> ⚠️ 드리프트(2026-06-17): 구분·성별이 radio(`.check-item`) → select(`placeholder '선택'`)로 변경
> ⚠️ 날짜 형식 불일치: 자격취득일 datepicker는 `YYYY-MM-DD`(대시) — 타 화면 `YYYY.MM.DD`(점)와 상이, QA 확인 요망

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 성명 입력 | `admin.getByPlaceholder('성명').first()` | CADR-03 | `toBeVisible()` |
| 휴대폰 입력 | `admin.getByPlaceholder('휴대폰').first()` | CADR-03 | `toBeVisible()` |
| 구분 select | `admin.getByPlaceholder('선택')` | CADR-03 | `count() ≥ 1` / ✨ radio → select 변경(2026-06-17) |
| 성별 select | `admin.getByPlaceholder('선택')` | CADR-03 | 구분과 동일 placeholder 공유 / ✨ radio → select 변경(2026-06-17) |
| 자격취득일 datepicker | datepicker 내부 구현 | CADR-03 | ✨ 신규 추가(2026-06-17) / 형식: `YYYY-MM-DD` |

```typescript
await expect(admin.getByPlaceholder('성명').first()).toBeVisible();
await expect(admin.getByPlaceholder('휴대폰').first()).toBeVisible();
// 구분·성별 select — placeholder '선택' 공유, count ≥ 1 검증
expect(await admin.getByPlaceholder('선택').count()).toBeGreaterThanOrEqual(1);
```

### 2-4. 버튼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| [입력란 추가] 버튼 | `admin.getByRole('button', { name: '입력란 추가' })` | CADR-04 | `toBeVisible()` / 비파괴(클릭 금지) |
| [저장] 버튼 | `admin.getByRole('button', { name: '저장' })` | CADR-04 | `toBeVisible()` / 비파괴(클릭 금지) |

```typescript
await expect(admin.getByRole('button', { name: '입력란 추가' })).toBeVisible();
await expect(admin.getByRole('button', { name: '저장' })).toBeVisible();
```

### 2-5. 테이블 컬럼

> ⚠️ 자격취득일 컬럼 신규 추가(2026-06-17 드리프트)
> Locator 패턴: `admin.getByRole('columnheader', { name: '컬럼명', exact: false }).first()`

| 컬럼명 | TC ID | 비고 |
|--------|-------|------|
| 성명 | CADR-05-1 | |
| 구분 | CADR-05-2 | |
| 성별 | CADR-05-3 | |
| 휴대폰 | CADR-05-4 | |
| 자격취득일 | CADR-05-5 | ✨ 2026-06-17 신규 추가 |
| 카트번호 | CADR-05-6 | |
| 태블릿 No. | CADR-05-7 | |
| 배터리 | CADR-05-8 | |
| 관리 | CADR-05-9 | |

```typescript
// 컬럼헤더 노출 검증 패턴
await expect(admin.getByRole('columnheader', { name: '자격취득일', exact: false }).first()).toBeVisible();
await expect(admin.getByRole('columnheader', { name: '관리', exact: false }).first()).toBeVisible();
```

---

## 3. 캐디 실적 (TC ID: CADP-01 ~ CADP-CALC)

> URL: `/club/page/caddie-performance`
> 안내문구: `admin.locator('.info-box-text')` (전문 일치 `checkText`)
> ⚠️ 안내문구 개정(2026-06, QA-14896): '애사심' 포함 구문 → 현재 문구로 변경(AS-IS 반영)

### 3-1. 안내문구

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `admin.locator('.info-box-text')` | CADP-01 | 전문 일치 `checkText` |

> 기대값(전문):
> `'스마트스코어 태블릿을 통해 스마트스코어 앱으로 사용자 등록을 하여, 스마트스코어와 골프장의 발전에 기여한 내역을 확인할 수 있습니다.'`
>
> ~~이전 문구~~: '애사심' 포함 구문 (QA-14896으로 기획과 상이 기록됨, 현 AS-IS 반영)

```typescript
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
const infoBox = admin.locator('.info-box-text');
```

### 3-2. 검색 영역

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 조회기간 datepicker | `admin.locator('.datepicker-input')` | CADP-02 | `count() ≥ 2` (시작일·종료일) |
| [조회] 버튼 | `admin.getByRole('button', { name: '조회' })` | CADP-02 | `toBeVisible()` / 비파괴(클릭 금지) |
| [내보내기] 버튼 | `admin.getByRole('button', { name: '내보내기' })` | CADP-02 | `toBeVisible()` / 비파괴(클릭 금지) |

```typescript
expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2);
await expect(admin.getByRole('button', { name: '조회' })).toBeVisible();
await expect(admin.getByRole('button', { name: '내보내기' })).toBeVisible();
```

### 3-3. 테이블 컬럼

> Locator 패턴: `admin.getByRole('columnheader', { name: '컬럼명', exact: false }).first()`

| 컬럼명 | TC ID | 비고 |
|--------|-------|------|
| 캐디명 | CADP-03-1 | |
| 신규회원 추천수 | CADP-03-2 | |
| 유효 내장객수 | CADP-03-3 | SS비율 계산 분모 |
| SS회원수 | CADP-03-4 | SS비율 계산 분자 |
| SS비율 | CADP-03-5 | 계산 정합성 검증 대상 |

```typescript
await expect(admin.getByRole('columnheader', { name: 'SS비율', exact: false }).first()).toBeVisible();
```

### 3-4. SS비율 계산 정합성 검증

> ⚠️ 데이터 의존 — 테이블이 비어있으면 자동 SKIP
> 계산식: `SS비율(%) = SS회원수 / 유효 내장객수 × 100`
> 데이터가 있는 행만 자동 추론, 모호 시 SKIP

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 테이블 컨테이너 | `admin.locator('.table-overflow-item table, table').first()` | CADP-CALC | `DataGrid` 래퍼 사용 |
| SS비율 셀 | `pickCell(rec, /SS비율/)` → `DataGrid.pct()` | CADP-CALC | 퍼센트 파싱 |
| SS회원수 셀 | `pickCell(rec, /SS회원수/)` → `DataGrid.num()` | CADP-CALC | 숫자 파싱 |
| 유효 내장객수 셀 | `pickCell(rec, /유효내장객수/)` → `DataGrid.num()` | CADP-CALC | 숫자 파싱 / 분모(0이면 NaN 처리) |

```typescript
// DataGrid 래퍼로 테이블 접근
const cadpGrid = new DataGrid(admin.locator('.table-overflow-item table, table').first());

// 데이터 있을 때만 정합성 검증
if (!(await cadpGrid.isEmpty().catch(() => true))) {
  const rows = (await cadpGrid.records()).map(rec => ({
    ratio: DataGrid.pct(pickCell(rec, /SS비율/)),
    ss:    DataGrid.num(pickCell(rec, /SS회원수/)),
    valid: DataGrid.num(pickCell(rec, /유효내장객수/)),
  }));
  // SS비율 = SS회원수 / 유효내장객수 × 100
  await lockOrSkipFormula(admin, P, R, 'CADP-CALC', 'SS비율', rows, r => r.ratio,
    [{ label: 'SS회원수 / 유효내장객수', calc: r => (Number.isFinite(r.ss) && r.valid > 0 ? (r.ss / r.valid) * 100 : NaN) }]);
}
```

---

## 드리프트 요약 (구조 변경 이력)

| 화면 | 변경 전 (TO-BE 기획) | 변경 후 (AS-IS 현재) | 날짜 | 참조 |
|------|---------------------|---------------------|------|------|
| 캐디 리스트 > 테이블 | '회원추천' 컬럼 포함 (11컬럼) | '회원추천' 제거 + '구분'·'등록일'·'해지일' 추가 (12컬럼) | 2026-06-17 | CADL-05 |
| 캐디 등록 관리 > 등록 폼 | 구분·성별: radio(`.check-item`) | 구분·성별: select(`placeholder '선택'`) + 자격취득일 추가 | 2026-06-17 | CADR-03 |
| 캐디 등록 관리 > 등록 폼 | 날짜 형식 `YYYY.MM.DD`(점, 타 화면 일관) | 자격취득일 datepicker `YYYY-MM-DD`(대시) — 불일치 QA 확인 요망 | 2026-06-17 | CADR-03 |
| 캐디 실적 > 안내문구 | '애사심' 포함 구문 | 현재 문구로 개정 (QA-14896 기획과 상이 기록) | 2026-06 | CADP-01 |

---

## 공통 패턴 참고

```typescript
// 페이지 로드 대기 (캐디 등록 관리·실적 공통)
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

// columnheader 검증 패턴 (등록 관리·실적 공통)
await expect(admin.getByRole('columnheader', { name: '컬럼명', exact: false }).first()).toBeVisible();

// button 검증 패턴
await expect(admin.getByRole('button', { name: '버튼명' })).toBeVisible();
// 중복 버튼 시 .contents-box 스코프 사용 필수
await expect(admin.locator('.contents-box').getByRole('button', { name: '버튼명' }).first()).toBeVisible();
```

> 비파괴 대상 버튼 목록: [관제 적용], [적용], [초기화], [입력란 추가], [저장], [조회], [내보내기]
> 모두 `toBeVisible()` 노출 확인만 수행, 실제 클릭 금지.
