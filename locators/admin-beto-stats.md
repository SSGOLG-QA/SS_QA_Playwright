# 배토 통계 (리뉴얼) - UI 요소 & TC 매핑 & Playwright Locator

> 사이트: https://td17.smartscore.kr/ss/admin/rounding.html?act=beto_calc
> 메뉴: 배토 관리 > 배토 통계 (IA #39, ✚ 신규)
> TC: 배토 관리 시트 #27~58 (총 32개)
> 분석일: 2026-05-29
> 특징: **BEM 클래스(`beto-*`) 사용** → 셀렉터 안정적, 자동화 적합도 높음

---

## ⚠️ TC vs 실제 화면 불일치 (확인 필요 — 잠재 결함 가능)

| 항목 | TC 문서 | 실제 td17 | 비고 |
|------|---------|----------|------|
| 검색 버튼 | `[초기화]` \| `[적용]` | `[조회]` \| `[엑셀변환]` | **[초기화] 버튼 미존재**, [적용]→[조회] |
| 조회기간 기본값 | 전월 1일 ~ 전월 말일 | 2026-05-01 ~ 2026-05-29 (당월 1일~당일) | **기본값 상이** |
| 표 내보내기 | `[내보내기]` | `[엑셀변환]` | 명칭 상이 |
| 표 타이틀 | "작업자 통계 표" | "작업자 통계표" | 띄어쓰기 |

> 위 항목은 결함 후보 또는 TC 갱신 대상. QA 확인 필요.

---

## UI 요소 & Locator 정의

### 1. 설명 영역

| 요소 | Locator | 방식 |
|------|---------|------|
| 타이틀 "배토 통계" | `page.locator('h2.beto-stats__title')` | 3순위 CSS |
| | `page.getByRole('heading', { name: '배토 통계', exact: true })` | 1순위 |
| 안내 문구 | `page.locator('.beto-stats__desc')` | 3순위 CSS |

```typescript
// TC-29 안내문구 검증
await expect(page.locator('.beto-stats__desc'))
  .toContainText('배토 작업자 수, 작업 시간과 관련된 통계');
```

### 2. 검색 조건 영역

| 요소 | Locator | 방식 | 비고 |
|------|---------|------|------|
| 시작일 | `page.locator('.beto-filter__date').first()` | 3순위 CSS | `input[type=date]` |
| 종료일 | `page.locator('.beto-filter__date').nth(1)` | 3순위 CSS | `input[type=date]` |
| 기간 구분(~) | `.beto-filter__sep` | 3순위 | |
| **작업자 탭** | `page.getByRole('button', { name: '작업자', exact: true })` | 1순위 | `.beto-tab` |
| **작업시간 탭** | `page.getByRole('button', { name: '작업시간' })` | 1순위 | `.beto-tab` |
| **일별 탭** | `page.getByRole('button', { name: '일별', exact: true })` | 1순위 | `.beto-tab` |
| **월별 탭** | `page.getByRole('button', { name: '월별' })` | 1순위 | `.beto-tab` |
| 조회 버튼 | `page.getByRole('button', { name: '조회' })` | 1순위 | `.beto-btn--search` |
| 엑셀변환 버튼 | `page.getByRole('button', { name: '엑셀변환' })` | 1순위 | `.beto-btn--excel` |

> **활성 탭 검증**: `.beto-tab.is-active` (선택된 탭에 `is-active` 클래스)
> ```typescript
> await expect(page.getByRole('button', { name: '작업자', exact: true })).toHaveClass(/is-active/);
> ```

> ⚠️ `input[type=date]`은 `fill('2026-05-01')` 로 설정 (네이티브 date picker).

### 3. 카드 요약 영역 (4개 카드)

```typescript
const cards = page.locator('.beto-card');   // 총/평균/최대/최소
```

| 카드 | label | 예시값 |
|------|-------|--------|
| 카드1 | 일별 총 작업자 수 | 37명 (7개 구간 기준 누적) |
| 카드2 | 일별 평균 작업자 수 | 5.3명 |
| 카드3 | 최대 작업자 수 | (날짜 포함) |
| 카드4 | 최소 작업자 수 | (날짜 포함) |

```typescript
// 특정 카드 → 값 검증 (label로 스코프)
const totalCard = page.locator('.beto-card').filter({ hasText: '일별 총 작업자 수' });
await expect(totalCard.locator('.beto-card__value')).toHaveText(/\d+명/);

// TC-39 no result → 0명
// await expect(totalCard.locator('.beto-card__value')).toHaveText('0명');
```

| 카드 내부 요소 | Locator |
|---------------|---------|
| 아이콘 | `.beto-card__accent` |
| 레이블 | `.beto-card__label` |
| 값 | `.beto-card__value` |
| 보조설명 | `.beto-card__sub` |

### 4. 작업자 통계 그래프 영역

| 요소 | Locator | 비고 |
|------|---------|------|
| 섹션 타이틀 | `page.getByRole('heading', { name: '작업자 통계 그래프' })` | `.beto-section__title` |
| 그래프 래퍼 | `page.locator('.beto-chart-wrap')` | |
| 차트 | `page.locator('.highcharts-container')` | **Highcharts(SVG)** |

```typescript
// TC-44 그래프 노출 확인 (존재만 검증 — 값 정합성은 자동화 부적합)
await expect(page.locator('.beto-chart-wrap .highcharts-container')).toBeVisible();

// TC-45 no result → "통계 데이터가 없습니다." 문구
// await expect(page.getByText('통계 데이터가 없습니다')).toBeVisible();
```

> ⚠️ 차트 값(막대 높이 등) 정합성 검증은 Highcharts SVG 의존 → 자동화 부적합. **노출 여부만** 검증 권장.

### 5. 작업자 통계표 영역

| 요소 | Locator | 비고 |
|------|---------|------|
| 섹션 타이틀 | `page.getByRole('heading', { name: '작업자 통계표' })` | `.beto-section__title` |
| 테이블 | `page.locator('table.beto-table')` | rowCount 7 |
| 정렬 가능 헤더 | `.beto-table .sortable` | 클릭 정렬 |

**컬럼 (5개):** No. / 일자 / 작업자 수 / 작업시간 합계 / 평균 작업시간 (TC-53 일치 ✓)

```typescript
const table = page.locator('table.beto-table');
const rows = table.locator('tbody tr');   // 7행

// TC-53 컬럼 검증
await expect(table.getByRole('columnheader', { name: /일자/ })).toBeVisible();
await expect(table.getByRole('columnheader', { name: /작업자 수/ })).toBeVisible();

// 정렬 (일자 헤더 클릭)
await page.locator('.beto-table .sortable', { hasText: '일자' }).click();
```

---

## TC ↔ 자동화 매핑 (32개)

| TC | 내용 | 자동화 | Locator |
|----|------|--------|---------|
| 27 | 페이지 5개 영역 노출 | 🟢 | 각 영역 toBeVisible |
| 28 | 타이틀 "배토 통계" | 🟢 | `.beto-stats__title` |
| 29 | 안내문구 | 🟢 | `.beto-stats__desc` |
| 30 | 검색조건 영역 노출 | 🟢 | 날짜/탭/버튼 |
| 31 | 조회기간 기본값 | 🟡 | **TC와 불일치 — 확인 필요** |
| 32 | 1년 초과 오류 | 🟡 | 기준 미확정("??") |
| 33 | 필터버튼 노출/기본값 | 🟢 | `.beto-tab.is-active` |
| 34 | 버튼 선택 눌림처리 | 🟢 | `toHaveClass(/is-active/)` |
| 35 | 초기화 | 🔴 | **[초기화] 버튼 미존재** |
| 36,37 | 적용/조회 → 결과 반영 | 🟢 | `.beto-btn--search` |
| 38 | 카드 4종 노출 | 🟢 | `.beto-card` |
| 39 | no result → 0명 | 🟡 | 데이터 세팅 필요 |
| 40~43 | 카드 탭 조합별 | 🟢 | 탭 클릭 + 카드값 |
| 44 | 그래프 영역 노출 | 🟢 | `.beto-chart-wrap` |
| 45 | 그래프 no result 문구 | 🟡 | 데이터 세팅 |
| 46~49 | 그래프 탭별 레이블 | 🟢(레이블)/🔴(값) | 레이블만 |
| 50 | 표 영역 노출 | 🟢 | `.beto-table` |
| 51 | 표 no result 문구 | 🟡 | 데이터 세팅 |
| 52 | 엑셀변환(내보내기) | 🟡 | 다운로드 트리거 |
| 53 | 표 컬럼 5종 | 🟢 | columnheader |
| 54~57 | 표 탭 조합별 + 소수점반올림 | 🟢 | 탭+표 검증 |
| 58 | 실시간 업데이트 | 🔴 | 라이브 데이터 |

**요약: 🟢 ~20개 자동화 적합 / 🟡 ~7개 조건부 / 🔴 ~3개 부적합 / 확인필요 3건**

---

## 권장 헬퍼 패턴

```typescript
// 필터 탭 선택 (작업자|작업시간, 일별|월별)
async function setBetoFilter(page, target: '작업자'|'작업시간', unit: '일별'|'월별') {
  await page.getByRole('button', { name: target, exact: true }).click();
  await page.getByRole('button', { name: unit, exact: true }).click();
  await page.getByRole('button', { name: '조회' }).click();
}

// 기간 설정
async function setBetoPeriod(page, from: string, to: string) {
  await page.locator('.beto-filter__date').first().fill(from);
  await page.locator('.beto-filter__date').nth(1).fill(to);
  await page.getByRole('button', { name: '조회' }).click();
}
```

---

## 셀렉터 요약 (빠른 참조)

| 요소 | Selector |
|------|----------|
| 타이틀 | `.beto-stats__title` |
| 안내문구 | `.beto-stats__desc` |
| 시작/종료일 | `.beto-filter__date` (first/nth(1)) |
| 필터 탭 | `.beto-tab` (활성: `.is-active`) |
| 조회 버튼 | `.beto-btn--search` |
| 엑셀변환 | `.beto-btn--excel` |
| 카드 | `.beto-card` (값: `.beto-card__value`) |
| 그래프 | `.beto-chart-wrap .highcharts-container` |
| 표 | `table.beto-table` |
| 정렬 헤더 | `.beto-table .sortable` |
| 섹션 타이틀 | `.beto-section__title` |
