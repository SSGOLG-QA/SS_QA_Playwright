# 경기관제 어드민 - 전체 라운드 UI 요소 & Playwright Locator 정의

> 사이트: https://td30.smartscore.kr/ss/admin/rounding.html
> 메뉴 경로: 라운드관리 > 전체 라운드
> 클럽명: 킹즈락
> 분석일: 2026-05-29
> 페이지 구성: 검색 필터 + 결과 테이블(20행) + 행별 액션 + 다수 팝업

---

## 페이지 구조 개요

| 영역 | 특성 |
|------|------|
| 검색 필터 | input에 label/placeholder 없음 → `name` 속성이 유일 식별자 |
| 결과 테이블 | `table.table02`, 14컬럼, 페이지당 20행 |
| 행별 액션 | `href="javascript:함수('idx')"` — idx 가변 → 함수명 매칭 + 행 스코프 필수 |
| 행별 입력 | `team_name`(중복 다수), `CART_SEL_{idx}`(동적 id) |
| 팝업 | 진행시간 수정 / 메모 / 공통 팝업(공지·비번·alert) |

---

## 1. 🔍 검색 필터 영역

| 요소 | Locator | 방식 | 속성 |
|------|---------|------|------|
| 날짜(시작) | `page.locator('#dateS')` | 3순위 id | `name=sch_from`, datepicker |
| 회원이름 | `page.locator('input[name="user_name"]')` | 3순위 name | |
| 캐디명 | `page.locator('input[name="caddie_name"]')` | 3순위 name | |
| 디바이스 | `page.locator('input[name="dev_idx"]')` | 3순위 name | |
| 단체명 | `page.locator('input[name="src_team"]')` | 3순위 name | |
| 카트번호 | `page.locator('input[name="src_cart_no"]')` | 3순위 name | |
| 검색 버튼 | `page.getByRole('button', { name: '검색', exact: true })` | 1순위 | `.srch-btn.bt01` |
| Clear 버튼 | `page.getByRole('button', { name: 'Clear' })` | 1순위 | `.clear-btn.bt02` |
| 진행시간 다운 | `page.getByRole('button', { name: '진행시간 다운' })` | 1순위 | `.down-btn.bt02` |

> ⚠️ 검색 input은 `placeholder`·`label`·`id`(dateS 제외)가 모두 없어 `name`이 유일한 안정 식별자.
> `getByLabel`/`getByPlaceholder` 불가.

```typescript
// 검색 실행 예시
await page.locator('#dateS').fill('2026-05-29');
await page.locator('input[name="user_name"]').fill('홍길동');
await page.getByRole('button', { name: '검색', exact: true }).click();
```

---

## 2. 📊 결과 테이블 (`table.table02`)

```typescript
const roundTable = page.locator('table.table02');
const rows = roundTable.locator('tbody tr');   // 페이지당 20행
```

**컬럼 (14개):**
순번 / 날짜·디바이스 / 티타임·R/N / 코스 / 캐디(카트) / 진행시간 / 내장객 / 단체명 / 스코어카드 / 사진 / 클럽체크 / 확인서 / 배터리 잔량 / 배터리 경고

```typescript
// 특정 컬럼 헤더
page.locator('table.table02').getByRole('columnheader', { name: '내장객' })
```

---

## 3. 🎯 행별 액션 — `javascript:함수()` href 패턴 ⭐

행 액션은 모두 `href="javascript:함수명('라운드idx')"` 형태.
idx는 가변이므로 `href*=함수명`으로 매칭 + 행 스코프가 핵심.

| 액션 | Locator (행 스코프) | 함수 |
|------|---------------------|------|
| 스코어카드 보기 | `row.locator('a[href*="showScoreCard"]')` | `showScoreCard(idx)` |
| 스코어카드 삭제 | `row.locator('a[href*="removeScoreCard"]')` | `removeScoreCard(idx)` |
| 클럽체크 | `row.locator('a[href*="showClubCheck"]')` | `showClubCheck(idx)` |
| 확인서 | `row.locator('a[href*="showClubConfirmation"]')` | `showClubConfirmation(idx)` |
| 업로드 결과(순번) | `row.locator('a[href*="showUploadResult"]')` | `showUploadResult(idx)` |
| 재업로드(실패건) | `row.locator('a[href*="reUpload"]')` | `reUpload(idx)`, `.up-fail` |
| 캐디 메모 | `row.locator('a.caddie-memo')` | `viewMemo(idx, name)` |
| 카트선택 열기 | `row.locator('.btnOpenCartSel')` | `(15)` 형태 표시 |

```typescript
// 첫 행의 스코어카드 열기
const firstRow = page.locator('table.table02 tbody tr').first();
await firstRow.locator('a[href*="showScoreCard"]').click();

// 특정 라운드 idx로 직접 타겟 (idx를 알 때)
page.locator('a[href*="showScoreCard(\'145040055\')"]')

// 업로드 실패 건만 필터링
page.locator('table.table02 tbody tr').filter({ has: page.locator('.up-fail') })
```

---

## 4. 🛒 행별 입력 요소

| 요소 | Locator | 방식 | 비고 |
|------|---------|------|------|
| 카트 선택 | `page.locator('[id^="CART_SEL_"]')` | 3순위 동적 id | `CART_SEL_{idx}`, `.selCart` |
| 단체명 입력 | `row.locator('input[name="team_name"]')` | 행 스코프 필수 | 20개+ 중복 |

카트 옵션: `--`, `1호`, `2호`, `1`, `2`, `3`, `4`, `5` ...

```typescript
const firstRow = page.locator('table.table02 tbody tr').first();
await firstRow.locator('.selCart').selectOption('1호');

// ⚠️ team_name은 행마다 동일 name → 반드시 행 스코프
await firstRow.locator('input[name="team_name"]').fill('우리팀');
```

---

## 5. ⏱️ 진행시간 수정 팝업 (시작/종료 시각)

OUT/IN × 시작/종료 × 시·분·초 = 12개 SELECT (옵션 00~59)

| 구분 | 시 | 분 | 초 |
|------|-----|-----|-----|
| OUT 시작 | `select[name="ost"]` | `select[name="osm"]` | `select[name="oss"]` |
| OUT 종료 | `select[name="oet"]` | `select[name="oem"]` | `select[name="oes"]` |
| IN 시작 | `select[name="ist"]` | `select[name="ism"]` | `select[name="iss"]` |
| IN 종료 | `select[name="iet"]` | `select[name="iem"]` | `select[name="ies"]` |

```typescript
await page.locator('select[name="ost"]').selectOption('07');   // OUT 시작 시
page.locator('.mem-time-save')      // 저장
page.locator('.mem-time-cancel')    // 취소
```

---

## 6. 📝 메모 팝업

| 요소 | Locator |
|------|---------|
| 저장 | `page.locator('.mem-save')` |
| 취소 | `page.locator('.mem-cancel')` |

---

## 7. 📄 페이지네이션

```typescript
// 현재 페이지 (활성)
page.locator('.active')                       // [1]
// 특정 페이지 이동 (href 기반)
page.locator('a[href*="_tpage=2"]')           // 2페이지
page.getByRole('link', { name: '다음' })      // 다음
```

페이지 이동 URL 패턴: `/ss/admin/rounding.html?_tpage=2&date=&srch=&srcd=&srdv=&src_team=&src_cart_no=`

---

## 8. 🔁 공통 팝업 (전 페이지 공통)

| 팝업 | Locator | 비고 |
|------|---------|------|
| 공지 닫기 (×) | `page.locator('.btn-top-close')` | 우상단 |
| 공지 닫기 (버튼) | `page.getByRole('button', { name: '닫기' })` | `.btn-close` |
| 비밀번호 변경 | `#InputMyCurPw` / `#InputMyNewPw` / `#InputMyNewPw_Confirm` | id 기반 |
| 비밀번호 변경 실행 | `page.getByRole('button', { name: '변경' })` | `.btnChangeMyPw_proc` |
| alert 확인 | `page.locator('#alert_cancel')` | `.popup_button_ok` |
| 캐디정보 확인 | `page.locator('.caddie_info_confirm')` | |

---

## 9. Locator 전략 요약

| 영역 | 최적 방식 | 핵심 주의 |
|------|----------|----------|
| 검색 필터 | `input[name="..."]` | label/placeholder 전무 |
| 검색/Clear 버튼 | `getByRole('button')` 또는 `.srch-btn` | "검색" 텍스트 컨테이너 중복 주의 |
| 행별 액션 | `row.locator('a[href*="함수명"]')` | idx 가변 → 함수명 매칭 + 행 스코프 |
| 동적 id | `[id^="CART_SEL_"]` | idx 접미사 |
| 중복 input | `row.locator('input[name="team_name"]')` | 반드시 행 스코프 |
| 시각 SELECT | `select[name="ost"]` 등 | name 명확 |

> ⚠️ **strict mode 핵심**: `team_name`(20개+), `selCart`, 행 액션 버튼이 행마다 반복.
> `page.locator(...)` 직접 호출 시 strict 위반 → 반드시 `tbody tr` 행으로 스코프를 좁힌 뒤 하위 요소 탐색.

---

## 10. 권장 Helper 패턴

```typescript
// 검색 실행
async function searchRounds(page, opts: {
  dateFrom?: string; userName?: string; caddieName?: string; team?: string; cartNo?: string;
}) {
  if (opts.dateFrom)   await page.locator('#dateS').fill(opts.dateFrom);
  if (opts.userName)   await page.locator('input[name="user_name"]').fill(opts.userName);
  if (opts.caddieName) await page.locator('input[name="caddie_name"]').fill(opts.caddieName);
  if (opts.team)       await page.locator('input[name="src_team"]').fill(opts.team);
  if (opts.cartNo)     await page.locator('input[name="src_cart_no"]').fill(opts.cartNo);
  await page.getByRole('button', { name: '검색', exact: true }).click();
}

// 행별 액션 (n번째 행)
function rowAction(page, rowIndex: number, fn: string) {
  return page.locator('table.table02 tbody tr').nth(rowIndex).locator(`a[href*="${fn}"]`);
}
// 사용: await rowAction(page, 0, 'showScoreCard').click();
```

---

## 11. 개선 권고사항 (개발팀 전달용)

1. **검색 input 식별자 부족** — `placeholder`/`label`이 없어 `name`에만 의존. 접근성 저하 + 테스트 취약
2. **행별 input name 중복** — `team_name`이 20개+ 동일 name으로 존재 → 행 스코프 없이 식별 불가
3. **행 액션이 inline `javascript:` href** — idx가 href에 박혀있어 동적. `data-round-idx` 속성 분리 권장
4. **카트 select 동적 id** — `CART_SEL_{idx}` 패턴, prefix 매칭 외 방법 없음

### 권장 data-testid 예시

```html
<!-- 검색 필터 -->
<input name="user_name" data-testid="search-user-name">

<!-- 행 (라운드 idx 속성화) -->
<tr data-round-idx="145040055">
  <a data-testid="btn-scorecard" href="...">스코어</a>
</tr>
```
