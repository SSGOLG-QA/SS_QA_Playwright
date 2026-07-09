# 코스 운영 관리 6종 (핀포지션 관리·이력·분석 / 코스분석 / 그린스피드 / 골프장소식) - UI 요소 & Locator

> URL 기반: `/club/page/<url-slug>` / 클럽: 킹즈락
> 분석일: 2026-06-23 / 기준: `lib/suites.ts` run*() 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID(tgv-N-*) 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 1. 핀 포지션 관리 (TC ID: PIN-01 ~ PIN-03)

> URL: `/club/page/course-analysis-pin-position` (코드 주석 미기재 — 관례 추정)
> 안내문구: `.info-box-text` (전문 일치 `checkText`)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | PIN-01 | 전문 일치 `checkText` |
| 컬럼 '코스명' | `getByRole('columnheader', {name:'코스명', exact:false}).first()` | PIN-02-1 | 테이블 헤더 |
| 컬럼 '홀' | `getByRole('columnheader', {name:'홀', exact:false}).first()` | PIN-02-2 | 테이블 헤더 |
| 컬럼 'PAR' | `getByRole('columnheader', {name:'PAR', exact:false}).first()` | PIN-02-3 | 테이블 헤더 |
| 컬럼 '야디지' | `getByRole('columnheader', {name:'야디지', exact:false}).first()` | PIN-02-4 | 테이블 헤더 |
| 컬럼 '그린' | `getByRole('columnheader', {name:'그린', exact:false}).first()` | PIN-02-5 | 테이블 헤더 |
| 컬럼 '핀 포지션' | `getByRole('columnheader', {name:'핀 포지션', exact:false}).first()` | PIN-02-6 | 테이블 헤더 |
| 컬럼 '선택' | `getByRole('columnheader', {name:'선택', exact:false}).first()` | PIN-02-7 | 테이블 헤더 |
| [전체 적용] 버튼 | `getByRole('button', {name:'전체 적용'}).first()` | PIN-03 | 비파괴(노출만) — 클릭 금지 |
| [선택 적용] 버튼 | `getByRole('button', {name:'선택 적용'}).first()` | PIN-03 | 비파괴(노출만) — 클릭 금지 |

**안내문구 전문:**
```
스마트스코어 스마트클럽 어플을 통하여 실시간 위치기반으로 핀 위치를 설정하여 태블릿에 현재 핀 위치를 표시할 수 있습니다. 그린을 선택하여 개별 홀, 전체 홀을 한 번에 이동할 수도 있습니다.
```

```typescript
// 핵심 로케이터 예시
const infoBox = admin.locator('.info-box-text').first();
await infoBox.waitFor({ state: 'visible', timeout: 10_000 });

// 테이블 컬럼 검증 (columnheader role)
const cols = ['코스명', '홀', 'PAR', '야디지', '그린', '핀 포지션', '선택'];
for (const c of cols) {
  await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible();
}

// 액션 버튼 — 비파괴(노출만)
await expect(admin.getByRole('button', { name: '전체 적용' }).first()).toBeVisible();
await expect(admin.getByRole('button', { name: '선택 적용' }).first()).toBeVisible();
```

---

## 2. 핀 포지션 변경이력 (TC ID: PINH-01 ~ PINH-03)

> URL: `/club/page/course-analysis-pin-history`
> 안내문구: `.info-box-text` (전문 일치 `checkText`)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | PINH-01 | 전문 일치 `checkText` |
| 조회기간 datepicker | `.datepicker-input` (count ≥ 2) | PINH-02 | 데이터 의존 아님 — 구조 검증 |
| [조회] 버튼 | `getByRole('button', {name:'조회'})` | PINH-02 | 비파괴(노출만) |
| [내보내기] 버튼 | `getByRole('button', {name:'내보내기'})` | PINH-02 | 비파괴(노출만) — 클릭 금지 |
| 컬럼 '코스명' | `getByRole('columnheader', {name:'코스명', exact:false}).first()` | PINH-03-1 | 테이블 헤더 |
| 컬럼 '홀 번호' | `getByRole('columnheader', {name:'홀 번호', exact:false}).first()` | PINH-03-2 | 테이블 헤더 |
| 컬럼 '변경일' | `getByRole('columnheader', {name:'변경일', exact:false}).first()` | PINH-03-3 | 테이블 헤더 |
| 컬럼 '변경시간' | `getByRole('columnheader', {name:'변경시간', exact:false}).first()` | PINH-03-4 | 테이블 헤더 |
| 컬럼 '이전 핀위치' | `getByRole('columnheader', {name:'이전 핀위치', exact:false}).first()` | PINH-03-5 | 테이블 헤더 |
| 컬럼 '변경 핀위치' | `getByRole('columnheader', {name:'변경 핀위치', exact:false}).first()` | PINH-03-6 | 테이블 헤더 |
| 컬럼 '작업자' | `getByRole('columnheader', {name:'작업자', exact:false}).first()` | PINH-03-7 | 테이블 헤더 |

**안내문구 전문:**
```
핀 포지션이 변경된 모든 이력을 확인할 수 있습니다. 각 홀별 변경된 시각과 이전 위치, 변경된 위치를 확인할 수 있으며, 변경한 작업자 확인이 가능합니다.
```

```typescript
// 핵심 로케이터 예시
const infoBox = admin.locator('.info-box-text').first();
await infoBox.waitFor({ state: 'visible', timeout: 10_000 });

// 조회기간 datepicker 2개 이상 존재 확인
expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2);

// 검색/내보내기 버튼 — 비파괴(노출만)
await expect(admin.getByRole('button', { name: '조회' })).toBeVisible();
await expect(admin.getByRole('button', { name: '내보내기' })).toBeVisible();

// 테이블 컬럼 검증
const cols = ['코스명', '홀 번호', '변경일', '변경시간', '이전 핀위치', '변경 핀위치', '작업자'];
for (const c of cols) {
  await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible();
}
```

---

## 3. 핀 포지션 분석 (TC ID: PINA-01 ~ PINA-03)

> URL: `/club/page/course-analysis-pin`
> 안내문구: `.info-box-text` (전문 일치 `checkText`)
> ⚠️ 드리프트(2026-06-17): `'SC평균'` → `'스코어'` 로 컬럼명 변경. 분석표 `<th>`가 `columnheader` role 미노출(복합 피벗표) — `th, [role=columnheader]` CSS+텍스트 매칭 사용

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | PINA-01 | 전문 일치 `checkText` |
| 조회기간 datepicker | `.datepicker-input` (count ≥ 2) | PINA-02 | 구조 검증 |
| [조회] 버튼 | `getByRole('button', {name:'조회'})` | PINA-02 | 비파괴(노출만) |
| 분석표 컬럼 '스코어' | `locator('th, [role=columnheader]').filter({hasText:'스코어'}).first()` | PINA-03-1 | ⚠️ 피벗표 — role 미노출, CSS 셀렉터 사용 |
| 분석표 컬럼 '오버파' | `locator('th, [role=columnheader]').filter({hasText:'오버파'}).first()` | PINA-03-2 | ⚠️ 피벗표 — CSS 셀렉터 사용 |
| 분석표 컬럼 '순위' | `locator('th, [role=columnheader]').filter({hasText:'순위'}).first()` | PINA-03-3 | ⚠️ 피벗표 — CSS 셀렉터 사용 |
| 분석표 컬럼 '라운드수' | `locator('th, [role=columnheader]').filter({hasText:'라운드수'}).first()` | PINA-03-4 | ⚠️ 피벗표 — CSS 셀렉터 사용 |
| 분석표 컬럼 '라운드율' | `locator('th, [role=columnheader]').filter({hasText:'라운드율'}).first()` | PINA-03-5 | ⚠️ 피벗표 — CSS 셀렉터 사용 |

**안내문구 전문:**
```
핀 위치에 따른 고객들의 평균 스코어를 통해 핀 위치별 난이도를 확인할 수 있습니다.
```

> ⚠️ **컬럼명 드리프트 주의**: 이전 버전의 `'SC평균'` 셀렉터는 무효. 반드시 `'스코어'` 사용.
> ⚠️ **피벗표 구조**: 이 페이지의 분석표는 복합 피벗 테이블로 `getByRole('columnheader')` 단독 사용 불가 — `th` 태그와 함께 복합 셀렉터 필수.

```typescript
// 핵심 로케이터 예시
const infoBox = admin.locator('.info-box-text').first();
await infoBox.waitFor({ state: 'visible', timeout: 10_000 });

// 조회기간 datepicker
expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2);
await expect(admin.getByRole('button', { name: '조회' })).toBeVisible();

// ⚠️ 피벗표 컬럼 — role=columnheader 미적용, th CSS+텍스트 매칭 필수
const analysisCols = ['스코어', '오버파', '순위', '라운드수', '라운드율'];
for (const c of analysisCols) {
  await expect(
    admin.locator('th, [role=columnheader]').filter({ hasText: c }).first()
  ).toBeVisible();
}
```

---

## 4. 코스 분석 (TC ID: CRS-01 ~ CRS-CALC)

> URL: `/club/page/course-analysis-detail`
> 안내문구: `.info-box-text` (전문 일치 `checkText`)
> ⚠️ `CRS-CALC`: 분석표 데이터 존재 시에만 실행 — 데이터 없을 경우 `skip` 처리

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | CRS-01 | 전문 일치 `checkText` |
| 조건 vue-select | `new VueSelect(admin)` (count ≥ 1) | CRS-02 | vue-select 컴포넌트 래퍼 사용 |
| [조회] 버튼 | `getByRole('button', {name:'조회'})` | CRS-02 | 비파괴(노출만) |
| 컬럼 '홀' | `getByRole('columnheader', {name:'홀', exact:false}).first()` | CRS-03-1 | 테이블 헤더 |
| 컬럼 '스코어' | `getByRole('columnheader', {name:'스코어', exact:false}).first()` | CRS-03-2 | 테이블 헤더 |
| 컬럼 '퍼트수' | `getByRole('columnheader', {name:'퍼트수', exact:false}).first()` | CRS-03-3 | 테이블 헤더 |
| 컬럼 '페어웨이안착률' | `getByRole('columnheader', {name:'페어웨이안착률', exact:false}).first()` | CRS-03-4 | 테이블 헤더 |
| 컬럼 '그린적중률' | `getByRole('columnheader', {name:'그린적중률', exact:false}).first()` | CRS-03-5 | 테이블 헤더 |
| 분석 차트(SVG) | `locator('svg')` (count ≥ 1) | CRS-04 | 데이터 의존 — SVG 렌더링 여부 |
| 분석표 계산 정합성 | `new CourseAnalysisPage(admin).rows()` | CRS-CALC | ⚠️ 데이터 의존 — 결과 0건 시 `skip` |

**안내문구 전문:**
```
골프장에서 플레이한 고객들의 스코어를 바탕으로 산출된 분석 자료를 통해 성별, 코스, 티잉 구역 별 평균 스코어와 퍼트수, 페어웨이 안착률, 그린 적중률을 확인할 수 있으며, 스마트스코어를 이용 중인 전국 골프장의 데이터와 비교하여 골프장의 난이도를 확인할 수 있습니다.
```

**계산 정합성 불변 조건 (`courseInvariants`):**
- 안착률/적중률 값 ∈ [0, 100]
- 퍼트수/스코어 값 ≥ 0

```typescript
// 핵심 로케이터 예시
const infoBox = admin.locator('.info-box-text').first();
await infoBox.waitFor({ state: 'visible', timeout: 10_000 });

// VueSelect 컴포넌트 (L3 래퍼)
expect(await new VueSelect(admin).count()).toBeGreaterThanOrEqual(1);
await expect(admin.getByRole('button', { name: '조회' })).toBeVisible();

// 테이블 컬럼
const cols = ['홀', '스코어', '퍼트수', '페어웨이안착률', '그린적중률'];
for (const c of cols) {
  await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible();
}

// 차트 SVG 존재 확인
expect(await admin.locator('svg').count()).toBeGreaterThanOrEqual(1);

// 계산 정합성 — 데이터 없으면 skip
const crsPage = new CourseAnalysisPage(admin);
if (!(await crsPage.isEmpty().catch(() => true))) {
  await verifyInvariants(admin, P, R, 'CRS-CALC', await crsPage.rows(), courseInvariants);
} else {
  skip({ ... }, '분석표 데이터 없음(조회 결과 0)');
}
```

---

## 5. 그린스피드 (TC ID: GRN-01 ~ GRN-02)

> URL: `/club/page/course-analysis-green-speed`
> 안내문구: `.info-box-text` (전문 일치 `checkText`)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | GRN-01 | 전문 일치 `checkText` |
| 그린스피드 입력 필드 | `getByPlaceholder('예) 2.6').first()` | GRN-02 | placeholder 텍스트 기반 |
| [수정] 버튼 | `getByRole('button', {name:'수정'}).first()` | GRN-02 | 비파괴(노출만) — 클릭 금지 |

**안내문구 전문:**
```
당일 그린 스피드를 골프장 방문고객에게 제공할 수 있는 메뉴 입니다. (스마트스코어App,태블릿 내 노출) 그린 스피드 입력 후 적용만 누르면 간단하게 저장이 됩니다. 그린스피드 Data를 관리하여 더 좋은 서비스를 제공할 수 있습니다.
```

> ℹ️ 노출 채널: 스마트스코어 App + 태블릿

```typescript
// 핵심 로케이터 예시
const infoBox = admin.locator('.info-box-text').first();
await infoBox.waitFor({ state: 'visible', timeout: 10_000 });

// 입력 필드 — placeholder 기반 접근
await expect(admin.getByPlaceholder('예) 2.6').first()).toBeVisible();

// [수정] 버튼 — 비파괴(노출만)
await expect(admin.getByRole('button', { name: '수정' }).first()).toBeVisible();
```

---

## 6. 골프장 소식 (TC ID: NEWS-01 ~ NEWS-03)

> URL: `/club/page/course-analysis-club-news`
> 안내문구: `.info-box-text` (전문 일치 `checkText`)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | NEWS-01 | 전문 일치 `checkText` |
| 컬럼 '순서' | `getByRole('columnheader', {name:'순서', exact:false}).first()` | NEWS-02-1 | 테이블 헤더 |
| 컬럼 '골프장소식' | `getByRole('columnheader', {name:'골프장소식', exact:false}).first()` | NEWS-02-2 | 테이블 헤더 |
| 컬럼 '노출기간' | `getByRole('columnheader', {name:'노출기간', exact:false}).first()` | NEWS-02-3 | 테이블 헤더 |
| 컬럼 '노출여부' | `getByRole('columnheader', {name:'노출여부', exact:false}).first()` | NEWS-02-4 | 테이블 헤더 |
| 컬럼 '작성자' | `getByRole('columnheader', {name:'작성자', exact:false}).first()` | NEWS-02-5 | 테이블 헤더 |
| [등록] 버튼 | `getByRole('button', {name:'등록', exact:true}).first()` | NEWS-03 | 비파괴(노출만) — 클릭 금지 |

**안내문구 전문:**
```
골프장의 소식을 방문고객에게 제공할 수 있는 메뉴 입니다. (스마트스코어App 노출) 방문고객에게 골프장의 다양한 소식을 제공해 보세요.
```

> ℹ️ 노출 채널: 스마트스코어 App 전용 (`태블릿` 미포함 — 그린스피드와 구별)

```typescript
// 핵심 로케이터 예시
const infoBox = admin.locator('.info-box-text').first();
await infoBox.waitFor({ state: 'visible', timeout: 10_000 });

// 테이블 컬럼 검증
const cols = ['순서', '골프장소식', '노출기간', '노출여부', '작성자'];
for (const c of cols) {
  await expect(admin.getByRole('columnheader', { name: c, exact: false }).first()).toBeVisible();
}

// [등록] 버튼 — exact:true 필수 (다른 버튼과 부분 일치 방지), 비파괴(노출만)
await expect(admin.getByRole('button', { name: '등록', exact: true }).first()).toBeVisible();
```

---

## 공통 패턴 요약

| 패턴 | Locator | 적용 메뉴 |
|------|---------|-----------|
| 페이지 로드 대기 | `.info-box-text` `waitFor({state:'visible', timeout:10_000})` | 전 메뉴 공통 |
| 안내문구 | `.info-box-text` | 전 메뉴 공통 |
| 날짜 검색 기간 | `.datepicker-input` (count ≥ 2) | 핀이력, 핀분석 |
| 피벗표 컬럼 헤더 | `locator('th, [role=columnheader]').filter({hasText: c})` | 핀분석 전용 |
| 일반 테이블 컬럼 헤더 | `getByRole('columnheader', {name: c, exact:false}).first()` | 핀관리, 핀이력, 코스분석, 골프장소식 |
| Vue Select 드롭다운 | `new VueSelect(admin)` (count ≥ 1) | 코스분석 |
| 분석 차트 | `locator('svg')` (count ≥ 1) | 코스분석 |
| Placeholder 입력 | `getByPlaceholder('예) 2.6').first()` | 그린스피드 |

### runCommonActions 공통 호출

모든 6개 메뉴에서 `runCommonActions(admin, P, R)` 호출. 이 함수는 페이지 공통 액션(페이지네이션, 정렬, 행 클릭 등)을 처리하며 별도 문서 참조.

---

## 주의사항 및 알려진 드리프트

| 항목 | 내용 | 영향 메뉴 |
|------|------|-----------|
| 컬럼명 드리프트 | `'SC평균'` → `'스코어'` (2026-06-17 기준) | 핀 포지션 분석 |
| 피벗표 role 미지원 | `columnheader` role 미부여 → `th` CSS 셀렉터 필수 | 핀 포지션 분석 |
| 데이터 의존 skip | 분석표 조회 결과 0건 시 CRS-CALC TC skip 처리 | 코스 분석 |
| 비파괴 버튼 | [전체 적용], [선택 적용], [수정], [등록], [내보내기] — 노출 확인만, 클릭 금지 | 핀관리, 그린스피드, 골프장소식, 핀이력 |
| `.first()` 필수 | 동일 role/name 버튼 복수 존재 가능 — 항상 `.first()` 또는 `.contents-box` 스코프 적용 | 전 메뉴 공통 |
