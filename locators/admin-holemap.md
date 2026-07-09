# 홀맵 관리 4종 (구역 설정 · 카트패스 · 티샷 유의거리 · 미리보기) - UI 요소 & Locator

> URL 기반 경로: `/club/page/holemap-*` / 클럽: 킹즈락
> 분석일: 2026-06-24 / 기준: lib/suites.ts run*() 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID(tgv-N-*) 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 1. 홀맵 구역 설정 (TC ID: HMZ-01 ~ HMZ-54)

> URL: `/club/page/holemap-zone` (추정 — 소스 주석 미명시, PageObject `HolemapZonePage` 기준)
> 안내문구: `HolemapZonePage.info()` 반환 locator — **전문 일치** (`checkText`)
> ⚠️ VueSelect 기반 필터 사용 — 동적 드롭다운, `.vs__*` 클래스 스코프 필수
> ⚠️ HMZ-54: 지도/캔버스 드래그 인터랙션 — **자동화 범위 제외(skip)**, QA-14970 추적 중

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `page.info()` (HolemapZonePage 메서드) | HMZ-01 | 전문 일치 `checkText` / 기대값: `'페어웨이 진입 알림 설정과 코스별 허용 상태를 관리하고, 홀맵 구역 데이터를 조회할 수 있습니다.'` |
| 필터 (코스/홀 VueSelect) | `page.filter` (HolemapZonePage 프로퍼티) | HMZ-02 | `count() ≥ 1` — 데이터 의존 |
| [적용] 버튼 | `page.applyBtn()` (HolemapZonePage 메서드) | HMZ-02 | 비파괴(노출만) |
| [구역 관리] 버튼 | `page.zoneManageBtn()` (HolemapZonePage 메서드) | HMZ-02 | 비파괴(노출만) |
| 테이블 컬럼 'No' | `page.headers()` → `hasCol(headers, 'No')` | HMZ-03-1 | DataGrid 헤더 배열 검사 |
| 테이블 컬럼 '코스' | `page.headers()` → `hasCol(headers, '코스')` | HMZ-03-2 | DataGrid 헤더 배열 검사 |
| 테이블 컬럼 '홀' | `page.headers()` → `hasCol(headers, '홀')` | HMZ-03-3 | DataGrid 헤더 배열 검사 |
| 테이블 컬럼 'PAR' | `page.headers()` → `hasCol(headers, 'PAR')` | HMZ-03-4 | DataGrid 헤더 배열 검사 |
| 테이블 컬럼 '야디지' | `page.headers()` → `hasCol(headers, '야디지')` | HMZ-03-5 | DataGrid 헤더 배열 검사 |
| 테이블 컬럼 '위험구역' | `page.headers()` → `hasCol(headers, '위험구역')` | HMZ-03-6 | DataGrid 헤더 배열 검사 |
| 테이블 컬럼 'OB구역' | `page.headers()` → `hasCol(headers, 'OB구역')` | HMZ-03-7 | DataGrid 헤더 배열 검사 |
| 테이블 컬럼 '패널티구역' | `page.headers()` → `hasCol(headers, '패널티구역')` | HMZ-03-8 | DataGrid 헤더 배열 검사 |
| 테이블 컬럼 '관리' | `page.headers()` → `hasCol(headers, '관리')` | HMZ-03-9 | DataGrid 헤더 배열 검사 |
| 거리표시 지점 드래그 | 지도/캔버스 인터랙션 | HMZ-54 | ⛔ **skip** — 2차 QA FAIL (QA-14970): 자동화 범위 제외 |

```typescript
// HolemapZonePage 기반 핵심 로케이터
const page = new HolemapZonePage(admin);
await page.ready();

// 안내문구 검증
const infoLocator = page.info();

// 필터 개수 확인 (VueSelect, 데이터 의존)
const filterCount = await page.filter.count();
expect(filterCount).toBeGreaterThanOrEqual(1);

// 버튼 노출 확인 (비파괴)
await expect(page.applyBtn()).toBeVisible();
await expect(page.zoneManageBtn()).toBeVisible();

// 테이블 헤더 전체 조회 후 컬럼명 검사
const hmzHeaders = await page.headers();
// hasCol(hmzHeaders, '코스') → true 이어야 함
```

> **전문 일치 기대값 (HMZ-01)**
> ```
> 페어웨이 진입 알림 설정과 코스별 허용 상태를 관리하고, 홀맵 구역 데이터를 조회할 수 있습니다.
> ```

---

## 2. 카트패스 진입여부 설정 (TC ID: HMCE-01 ~ HMCE-04)

> URL: `/club/page/holemap-cart-entrance`
> 안내문구: `.info-box-text` — **전문 일치** (`checkText`)
> ⚠️ 코스 탭은 클럽 구성(South/East/West)에 따라 표시 항목 상이 — 데이터 의존

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `admin.locator('.info-box-text')` | HMCE-01 | 전문 일치 `checkText` / 기대값: `'코스를 선택한 뒤 홀 별로 페어웨이 카트패스 진입 가능 여부를 설정합니다.'` |
| 코스 탭 'South' | `admin.locator('.tab-group').getByText('South', { exact: false }).first()` | HMCE-02 | 부분 일치 — 탭 라벨 포함 여부 확인 |
| 코스 탭 'West' | `admin.locator('.tab-group').getByText('West', { exact: false }).first()` | HMCE-02 | 부분 일치 — 탭 라벨 포함 여부 확인 |
| 홀별 checkbox | `admin.locator('.contents-box input[type="checkbox"]')` | HMCE-03 | `count() ≥ 1` — 데이터 의존 |
| [전체 허용] 버튼 | `admin.getByRole('button', { name: '전체 허용', exact: true }).first()` | HMCE-04-1 | 비파괴(노출만) |
| [전체 제한] 버튼 | `admin.getByRole('button', { name: '전체 제한', exact: true }).first()` | HMCE-04-2 | 비파괴(노출만) |
| [홀별 설정 저장] 버튼 | `admin.getByRole('button', { name: '홀별 설정 저장', exact: true }).first()` | HMCE-04-3 | 비파괴(노출만) — 저장 클릭 금지 |

```typescript
// 카트패스 진입여부 설정 핵심 로케이터
// 페이지 로드 대기
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

// 안내문구
const infoBox = admin.locator('.info-box-text');

// 코스 탭 (부분 일치 — 'South Course' 등 포함 케이스 대응)
const tabSouth = admin.locator('.tab-group').getByText('South', { exact: false }).first();
const tabWest  = admin.locator('.tab-group').getByText('West',  { exact: false }).first();

// 홀별 checkbox (.contents-box 스코프 — 중복 방지)
const checkboxes = admin.locator('.contents-box input[type="checkbox"]');
expect(await checkboxes.count()).toBeGreaterThanOrEqual(1);

// 버튼 (비파괴 — 노출만 확인)
const btnAllow  = admin.getByRole('button', { name: '전체 허용',     exact: true }).first();
const btnReject = admin.getByRole('button', { name: '전체 제한',     exact: true }).first();
const btnSave   = admin.getByRole('button', { name: '홀별 설정 저장', exact: true }).first();
await expect(btnAllow).toBeVisible();
await expect(btnReject).toBeVisible();
await expect(btnSave).toBeVisible();
```

> **전문 일치 기대값 (HMCE-01)**
> ```
> 코스를 선택한 뒤 홀 별로 페어웨이 카트패스 진입 가능 여부를 설정합니다.
> ```

---

## 3. 티샷 유의 거리 설정 (TC ID: HMTS-01 ~ HMTS-04)

> URL: `/club/page/holemap-teeshot-distance`
> 안내문구: `.info-box-text` — **전문 일치** (`checkText`)
> ⚠️ 파4 이상 홀에만 적용 — 홀 구성에 따라 입력 행 수 상이(데이터 의존)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `admin.locator('.info-box-text')` | HMTS-01 | 전문 일치 `checkText` / 기대값 아래 참조 |
| 코스 탭 'South' | `admin.locator('.tab-group').getByText('South', { exact: false }).first()` | HMTS-02 | 부분 일치 — 탭 존재 여부 확인 |
| 홀별 거리 입력 (placeholder) | `admin.getByPlaceholder('미입력').first()` | HMTS-03-1 | 데이터 의존 — placeholder `'미입력'` 기준 |
| 홀별 사용여부 checkbox | `admin.locator('.contents-box input[type="checkbox"]')` | HMTS-03-2 | `count() ≥ 1` — 데이터 의존 / `.contents-box` 스코프 필수 |
| '사용여부' 컬럼 라벨 | `admin.locator('.contents-box').getByText('사용여부', { exact: true }).first()` | HMTS-03-3 | `.contents-box` 스코프 — 전문 일치 |
| [저장] 버튼 | `admin.getByRole('button', { name: '저장', exact: true }).first()` | HMTS-04 | 비파괴(노출만) — 저장 클릭 금지 |
| [초기화] 버튼 | `admin.getByRole('button', { name: '초기화' }).first()` | HMTS-04 | 비파괴(노출만) — 초기화 클릭 금지 |

```typescript
// 티샷 유의 거리 설정 핵심 로케이터
// 페이지 로드 대기
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

// 안내문구
const infoBox = admin.locator('.info-box-text');

// 코스 탭
const tabSouth = admin.locator('.tab-group').getByText('South', { exact: false }).first();

// 거리 입력 필드 — placeholder '미입력' 로케이터
const distanceInput = admin.getByPlaceholder('미입력').first();
await expect(distanceInput).toBeVisible();

// 사용여부 checkbox (.contents-box 스코프 — 페이지 내 다른 checkbox 혼입 방지)
const usageCheckboxes = admin.locator('.contents-box input[type="checkbox"]');
expect(await usageCheckboxes.count()).toBeGreaterThanOrEqual(1);

// '사용여부' 라벨 — 전문 일치, .contents-box 스코프
const usageLabel = admin.locator('.contents-box').getByText('사용여부', { exact: true }).first();
await expect(usageLabel).toBeVisible();

// 버튼 (비파괴)
const btnSave  = admin.getByRole('button', { name: '저장',  exact: true }).first();
const btnReset = admin.getByRole('button', { name: '초기화' }).first();
await expect(btnSave).toBeVisible();
await expect(btnReset).toBeVisible();
```

> **전문 일치 기대값 (HMTS-01)**
> ```
> 파4 이상 홀에서 티박스 진입 시점 기준, 설정한 거리 이내에 앞 카트가 위치하는 경우 태블릿에 티샷 유의 안내문구를 노출합니다. 상단 코스를 선택하여 홀 별 기준거리를 관리할 수 있습니다.
> ```

---

## 4. 홀맵 미리보기 (TC ID: HMP-01 ~ HMP-03)

> URL: `/club/page/holemap-preview`
> 안내문구: `.info-box-text` — **전문 일치** (`checkText`)
> ⚠️ SVG 렌더링은 시각 도구(비파괴) — 지도 인터랙션(드래그/클릭) 자동화 범위 제외
> ⚠️ VueSelect 개수(`≥ 2`) — 코스/홀 각각 1개, 데이터 로드 후 count 확인

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `admin.locator('.info-box-text')` | HMP-01 | 전문 일치 `checkText` / 기대값 아래 참조 |
| 미리보기 조건 VueSelect (코스/홀) | `new VueSelect(admin)` | HMP-02 | `count() ≥ 2` — VueSelect PageObject 사용, 데이터 의존 |
| 미리보기 SVG 영역 | `admin.locator('svg')` | HMP-03 | `count() ≥ 1` — 홀맵 렌더링 영역, 비파괴(노출만) |
| 투명도 슬라이더 | `admin.locator('.opacity-slider').first()` | HMP-03 | 비파괴(노출만) — 슬라이더 조작 금지 |
| 미리보기 요약 패널 | `admin.locator('.preview-summary').first()` | HMP-03 | 비파괴(노출만) — 구역/카트패스/티샷 설정 요약 표시 영역 |

```typescript
// 홀맵 미리보기 핵심 로케이터
// 페이지 로드 대기
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

// 안내문구
const infoBox = admin.locator('.info-box-text');

// 미리보기 조건 VueSelect (코스/홀) — VueSelect PageObject
const vueSelects = new VueSelect(admin);
expect(await vueSelects.count()).toBeGreaterThanOrEqual(2);

// SVG 미리보기 영역 (비파괴 — 노출만)
const svgArea = admin.locator('svg');
expect(await svgArea.count()).toBeGreaterThanOrEqual(1);

// 투명도 슬라이더 (비파괴 — 노출만, 조작 금지)
const opacitySlider = admin.locator('.opacity-slider').first();
await expect(opacitySlider).toBeVisible();

// 미리보기 요약 (비파괴 — 노출만)
const previewSummary = admin.locator('.preview-summary').first();
await expect(previewSummary).toBeVisible();
```

> **전문 일치 기대값 (HMP-01)**
> ```
> 홀맵 구역설정, 카트패스 진입여부 설정, 티샷 유의거리 설정을 기준으로 태블릿에 실제로 보이는 홀 화면을 미리 확인합니다.
> ```

---

## 공통 사항

### 페이지 로드 대기 패턴

모든 홀맵 관리 하위 메뉴(카트패스·티샷·미리보기)는 동일한 로드 대기 패턴 사용:

```typescript
// 공통 로드 대기 — timeout 초과 시 catch로 무시(soft wait)
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
```

홀맵 구역 설정(`HolemapZonePage`)은 `page.ready()` 메서드로 대기:

```typescript
const page = new HolemapZonePage(admin);
await page.ready(); // PageObject 내부 로드 대기 로직
```

### runCommonActions 공통 검증

4개 메뉴 모두 `runCommonActions(admin, P, R)` 호출 — 공통 TC(접근 권한, 반응형, 빈 상태 등) 포함.
공통 TC 상세는 `runCommonActions` 별도 문서 참조.

### 비파괴 원칙 적용 대상 요약

| 메뉴 | 비파괴 대상 버튼/액션 |
|------|----------------------|
| 홀맵 구역 설정 | [적용], [구역 관리] |
| 카트패스 진입여부 설정 | [전체 허용], [전체 제한], [홀별 설정 저장] |
| 티샷 유의 거리 설정 | [저장], [초기화] |
| 홀맵 미리보기 | SVG 드래그, 투명도 슬라이더 조작 |

### skip 처리 항목

| TC ID | 사유 | 참조 |
|-------|------|------|
| HMZ-54 | 2차 QA FAIL — 마우스 드래그 시 플래그 위치 변경 안됨 / 지도 인터랙션 자동화 범위 제외 | QA-14970 |

### 데이터 의존 요소 목록

| 메뉴 | 요소 | 조건 |
|------|------|------|
| 홀맵 구역 설정 | 필터(VueSelect) | `count() ≥ 1` |
| 홀맵 구역 설정 | DataGrid 행 | 코스·홀 데이터 필요 |
| 카트패스 진입여부 설정 | 홀별 checkbox | `count() ≥ 1` |
| 티샷 유의 거리 설정 | 거리 입력 필드 | `placeholder='미입력'` 노출 |
| 티샷 유의 거리 설정 | 사용여부 checkbox | `count() ≥ 1` |
| 홀맵 미리보기 | VueSelect | `count() ≥ 2` |
| 홀맵 미리보기 | SVG 영역 | `count() ≥ 1` |
