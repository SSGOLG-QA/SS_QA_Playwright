# 라운드관리 4메뉴 (리뉴얼 td17) - UI 요소 & Locator

> 단체라운드 / 라운드 설정 / 홀별정산관리 / 카트관리
> 분석일: 2026-05-29 / 환경: td17 리뉴얼 (SPA, `/club/page/...`)
> 공통: 설명 `.info-box-text`, 검색버튼 `.button-common.primary`, datepicker `.datepicker-input`

---

## 1. 단체 라운드 (`/club/page/round-group`)
> IA상 **범위제외**(단체팀 고도화 별도) — 참고용

| 요소 | Locator |
|------|---------|
| 설명 | `.info-box-text` ("대회 등의 단체라운드를 지원하는 기능...") |
| 단체팀명 검색 | `page.getByPlaceholder('단체팀명')` (`.search-type`) |
| 날짜 선택 | `page.locator('.datepicker-input')` (ph `날짜선택`) |
| 조회 | `page.getByRole('button', { name: '조회' })` |
| 랭킹다운 / 스코어다운 | `getByRole('button', { name: '랭킹다운' / '스코어다운' })` |
| 상단 액션 | 골프장 공통 시상내역 편집 / 관리자 웹뷰 / URL복사 |
| 행 액션 | 설정 / 보기 / 복사 / 등록 (행 스코프 필요) |

**테이블(14컬럼):** 날짜/단체명/행사명/태블릿 리더보드/첫팀 티업/막팀 티업/팀수·인원수/그룹편집·핸디관리/스코어/진행상황/결과집계·출력/리더보드 웹뷰/웹뷰 접속ID/행사관리자 인증키 (20행)

---

## 2. 라운드 설정 (`/club/page/round-course`)
> 4개 설정 섹션: 롱기/니어, 신페리오, 기준 홀 수, 홀 난이도

| 영역 | Locator | 비고 |
|------|---------|------|
| 설명 | `.info-box-text` | "코스별 롱기스트, 니어리스트..." |
| 섹션 타이틀 | `.sub-title-box` | 롱기스트/니어리스트, 신페리오 적용홀, 라운드 기준 홀 수 설정, 홀 난이도 설정 |
| 홀 토글 버튼 | `.hole-toggle-btn` (활성 `.active`) | "1\nPAR 4" 형태, 코스별 9홀 |
| 기준 홀 수 슬라이더 | `input[type="range"]` | 6/9/18홀 |
| 코스 체크박스 | `#cb1` / `#cb2` / `#cb3` (`.check-item`) | 코스별 |
| 홀 난이도 select | `.hole-level-select` | 옵션 "선택안함"~ (중복 난이도 불가) |
| 초기화 / 적용 | `getByRole('button', { name: '초기화' / '적용' })` | 섹션마다 존재 → 섹션 스코프 권장 |
| 랜덤선택 (신페리오) | `getByRole('button', { name: '랜덤선택' })` | |

```typescript
// 섹션별 초기화/적용 중복 → 섹션 컨테이너로 스코프
const longNear = page.locator('.contents-box').filter({ hasText: '롱기스트 / 니어리스트' });
await longNear.getByRole('button', { name: '적용' }).click();
// 홀 선택
await page.locator('.hole-toggle-btn').filter({ hasText: '7' }).first().click();
```

> 코스/홀 매트릭스 테이블: 헤더 `코스 1~9`, rowCount 3 (코스 3개), 여러 섹션에 반복

---

## 3. 홀별 정산 관리 (`/club/page/live-hole-calc`)
> TC #288~300 (관제어드민 상세시트)

| 영역 | Locator | 비고 |
|------|---------|------|
| 설명 | `.info-box-text` | "해당 기능을 활성화하면..." |
| **홀정산 요청 활성화 토글** | ⚠️ `#tgv-1-0` 금지(동적채번) → `.contents-box`("홀정산 요청 기능을 활성화") 내 `.toggle-switch input`, 조작은 `label` 클릭 | TC-289/290 ON/OFF |
| 토글 영역 저장 | `.sub-title-box`("홀별정산관리") 인접 `getByRole('button',{name:'저장'})` | |
| **정산 사유 직접입력** | `page.getByPlaceholder('직접입력')` (3개, `.active`) | TC-291~293, 최대 3개 |
| 사유 저장/초기화 | `getByRole('button', { name: '저장' / '초기화' })` | |
| 검색 조회일 | `.datepicker-input` ×2 (ph `YYYY.MM.DD`) | TC-294 |
| 내장객 검색 | `page.getByPlaceholder('내장객')` | TC-295 |
| 캐디명 검색 | `page.getByPlaceholder('캐디명')` | TC-296 |
| 검색 버튼 | `page.getByRole('button', { name: '검색' })` | |

**요청 현황 테이블:** No./정산 요청 시간/티타임/캐디명/고객명/플레이한 홀 수/정산 사유
- ⚠️ 검색폼('홀정산 요청 현황' 박스)과 **결과 테이블은 별도 `.contents-box`** — 테이블은 `.list-table-group`로 스코프
- 정렬 헤더: `.list-table-group .th-sortable` ×3 (정산 요청 시간 ▼, 티타임 ▼, 플레이한 홀 수 ▼)
- 빈 상태: `getByText('홀정산 기록이 없습니다')` (TC-297)
- 요청 팀 수: `getByText(/요청 팀 수 : \d+ 팀/)`

```typescript
// TC-289 토글 ON — id 동적채번이므로 활성화 섹션 + label 클릭
const act = page.locator('.contents-box').filter({ hasText: '홀정산 요청 기능을 활성화' });
await act.locator('.toggle-switch label').first().click();   // input은 숨김 → label 클릭
await expect(act.locator('.toggle-switch input[type="checkbox"]').first()).toBeChecked();
// TC-298 사유 4번째 추가 차단 — getByPlaceholder('직접입력') toHaveCount(3)
```

> ⚠️ `#tgv-N-0`의 N은 SPA 네비게이션마다 증가(단독 진입 시 1, 전체 스위트 진입 시 상이) → **절대 id 의존 금지**.

---

## 4. 카트 관리 (`/club/page/cart-all`)
> IA No.7 · 드라이브 상세 TC 미작성 → 구조 기반 자동화 (`runCartMgmt`, CART-02~10)

| 영역 | Locator | 비고 |
|------|---------|------|
| 설명 | `.info-box-text` | "골프장에서 운영 중인 카트를 관리하고 카트의 라운드 기록을 확인할 수 있습니다." (원문 일치 검증) |
| 사용 구분 필터 | `.vs__dropdown-toggle` / `.vs__search` (vue-select, 전체/사용/중지) | 네이티브 select 아님, 기본값 전체 |
| 적용 | `page.getByRole('button', { name: '적용' })` | 읽기전용(목록 갱신) |
| **카트추가** | `page.getByRole('button', { name: '카트추가' })` | 레이어팝업 — ⚠️ 비파괴(노출·활성만) |
| 행 - 라운드 기록 보기 | `row.getByRole('button', { name: '보기' })` | `.button-outline-primary` |
| 행 - 사용중지 | `row.getByRole('button', { name: '사용중지' })` | `.button-outline-danger` — ⚠️ 비파괴(노출만) |
| 테이블 | `.table-overflow-item table` (5컬럼 / 10행) | 단일 테이블 |
| 페이지네이션 | `.ellipsis` / `button.active` | 다중 페이지 시 … 노출 |

**테이블(5컬럼):** 카트번호 / 라운드 횟수 / 라운드 기록 / 상태 / 관리 (10행)
- 페이지네이션: `.active`, 숫자, `.ellipsis`(…), 최대 15

```typescript
// 행별 보기/사용중지 (행 스코프)
const row = page.locator('.table-overflow-item table tbody tr').filter({ hasText: '2호' });
await row.getByRole('button', { name: '보기' }).click();
```

---

## 공통 패턴 (라운드관리 리뉴얼)

| 요소 | Selector |
|------|----------|
| 설명 문구 | `.info-box-text` |
| 검색 실행 버튼 | `.button-common.primary` (조회/적용/검색) |
| 보조 버튼 | `.button-common.negative` (초기화 등) |
| 행 액션 | `.button-outline-primary`(보기/스코어) / `.button-outline-danger`(삭제/사용중지) |
| 날짜 | `.datepicker-input` |
| 테이블 | `.table-overflow-item table` |
| 정렬 헤더 | `.th-sortable` |
| 섹션 타이틀 | `.sub-title-box` |
| 토글 | `input[type=checkbox]` (id `tgv-*` 등) |

---

## ⚠️ 참고
- **단체라운드**: IA 범위제외 (단체팀 고도화 별도 프로젝트)
- **검색 버튼 명칭**: 화면마다 상이 (단체라운드=조회 / 홀별정산=검색 / 전체라운드·카트=적용) → TC의 [적용]과 불일치 가능, 화면별 확인
- **라운드 설정**: 초기화/적용 버튼이 섹션마다 중복 → 반드시 섹션 스코프
