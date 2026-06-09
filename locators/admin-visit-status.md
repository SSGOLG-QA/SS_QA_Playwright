# 내장 현황 (리뉴얼) - UI 요소 & TC 매핑 & Locator

> 사이트: https://td17.smartscore.kr/club/page/round-visit
> 메뉴: 라운드관리 > 내장 현황 (IA #2, ✚ 신규 — 기존 홈 항목 편입)
> TC: 라운드 관리 > 내장 현황 #1~17
> 분석일: 2026-05-29

---

## UI 요소 & Locator

### 1. 설명 영역

| 요소 | Locator | 비고 |
|------|---------|------|
| 안내 문구 | `page.locator('.info-box-text')` | "골프장에 방문한 일별 내장객수와...90일 동안의 기록만..." |
| 데이터 마케팅 바로가기 | `page.getByRole('button', { name: '데이터 마케팅 바로가기' })` | `.button-common.negative` |
| 도움말 버튼 | ⚠️ DOM 미캡처 (아이콘 추정) | TC-3 대상, 셀렉터 추가 확인 필요 |

### 2. 테이블

```typescript
const table = page.locator('.table-overflow-item table');   // .table-group.table-overflow-x 내부
const rows = table.locator('tbody tr');                       // 페이지당 10행
```

**확인된 컬럼 (9개):** 날짜 / 총 내장객 / 내장객 남/여 / 유효 내장객 / 기존 SS회원 / 신규 SS회원 / 일일 SS회원 / SS회원 비율 / 출력 횟수

> ⚠️ **QA 발견 후보**: TC-5는 **10컬럼(출력률 포함)** 을 명시하나, 실제 추출 헤더에는 **출력률 컬럼이 없음**(출력 횟수까지 9개) → 확인 필요

| 요소 | Locator |
|------|---------|
| 총 건수 | `page.getByText(/총 \d+건/)` ("총 26건") |
| 엑셀 다운로드(=TC의 내보내기) | `page.getByRole('button', { name: '엑셀파일 다운로드' })` (`.button-outline-primary`) |
| 컬럼 헤더 | `table.getByRole('columnheader', { name: '총 내장객' })` 등 |
| 페이지네이션 | `.active`(현재) / 숫자 버튼 |

---

## TC ↔ 자동화 매핑 (#1~17)

| TC | 내용 | 자동화 | Locator / 비고 |
|----|------|--------|----------------|
| 1 | 설명영역(데이터마케팅·도움말) + 테이블(내보내기) | 🟢/🟡 | 도움말 버튼 미확인 |
| 2 | 설명 문구 | 🟢 | `.info-box-text` toContainText |
| 3 | 도움말 버튼 → 툴팁 문구 | 🟡 | 도움말 셀렉터 확인 필요 |
| 4 | 데이터 마케팅 바로가기 → 새 탭 + 현재 화면 유지 | 🟢 | `context.waitForEvent('page')` |
| 5 | 테이블 컬럼 (10개) | 🟡 | **출력률 컬럼 미확인(결함 후보)** |
| 6 | 날짜 내림차순 + 90일 이내 | 🟢(정렬)/🟡(90일) | 첫 행 날짜 ≥ 다음 행 |
| 7 | 91일 이전 미노출 | 🔴 | 데이터 의존 |
| 8 | 총 내장객 표시 | 🟢 | 셀 노출 |
| 9 | 내장객 남/여 (남+여=총) | 🟡 | 데이터 합산 검증 |
| 10 | 유효 내장객 (회원+18홀완료) | 🔴 | 데이터 조건 의존 |
| 11~13 | 기존/신규/일일 SS회원 | 🟢(노출)/🟡(값) | |
| 14 | SS회원 비율 = (기존+신규)/유효×100 | 🟡 | 계산식 검증(데이터) |
| 15 | 출력 횟수 | 🟢 | 셀 노출 |
| 16 | 출력률 = 출력횟수/유효×100 | 🟡 | 출력률 컬럼·계산식(데이터) |
| 17 | 내보내기 → 엑셀 다운로드 | 🟡 | 다운로드 트리거 가능, 파일 검증 별도 |

**요약: 🟢 자동화 적합 ~7개 / 🟡 조건부 ~8개 / 🔴 데이터의존 2개**

---

## 🟢 자동화 가능 핵심 (스크립트 작성 시)

```typescript
// 설명 문구
await expect(page.locator('.info-box-text')).toContainText('일별 내장객수와');

// 테이블 컬럼 노출
const table = page.locator('.table-overflow-item table');
for (const col of ['날짜','총 내장객','유효 내장객','기존 SS회원','출력 횟수']) {
  await expect(table.getByRole('columnheader', { name: col })).toBeVisible();
}

// 날짜 내림차순 (첫 행 ≥ 둘째 행)
// 데이터 마케팅 바로가기 → 새 탭
const popup = context.waitForEvent('page');
await page.getByRole('button', { name: '데이터 마케팅 바로가기' }).click();
const dm = await popup;
expect(page.isClosed()).toBe(false);  // 현재 화면 유지

// 내보내기(엑셀) 다운로드
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: '엑셀파일 다운로드' }).click();
await dl;
```

---

## ⚠️ QA 발견 후보 (확인 필요)

| # | TC 기대 | 실제 td17 |
|---|---------|-----------|
| 1 | 테이블 **10컬럼(출력률 포함)** | **9컬럼**(출력 횟수까지) — 출력률 미노출 가능 |
| 2 | [도움말] 버튼 | DOM에 텍스트 버튼 미발견 (아이콘 추정) |
| 3 | [내보내기] | 실제 [엑셀파일 다운로드] (명칭 차이) |
