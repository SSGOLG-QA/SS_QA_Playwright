# 고객 평가 관리 4종 (고객평가 · 캐디평가 · 후기리스트 · 후기통계) - UI 요소 & Locator

> URL: `/club/page/<url-slug>` / 클럽: 킹즈락
> 분석일: 2026-06-24 / 기준: `lib/suites.ts` run*() 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID(tgv-N-*) 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 1. 고객 평가 (TC ID 범위: CEVAL-01 ~ CEVAL-03-4)

> URL: `/club/page/customer-evaluation`
> 안내문구: `.info-box-text` (전문 일치)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | CEVAL-01 | 전문 일치 `checkText` — "식음, 그린, 페어웨이 등 항목별 고객 평가 현황을 확인할 수 있습니다." |
| 조회기간 datepicker (1) | `.datepicker-input` (index 0) | CEVAL-02 | `count() >= 2` 검증 |
| 조회기간 datepicker (2) | `.datepicker-input` (index 1) | CEVAL-02 | `count() >= 2` 검증 |
| 조건 선택 | vue-select 컴포넌트 | CEVAL-02 | 클래스 `.vue-select` 또는 `.v-select` — 비파괴(노출만) |
| [적용] 버튼 | `getByRole('button', { name: '적용', exact: true })` | CEVAL-02 | 비파괴(노출·활성만) |
| [내보내기] 버튼 | `getByRole('button', { name: '내보내기' })` | CEVAL-02 | 비파괴(노출·활성만) |
| 컬럼 '기간' | `getByRole('columnheader', { name: '기간', exact: false }).first()` | CEVAL-03-1 | |
| 컬럼 '평균 평점' | `getByRole('columnheader', { name: '평균 평점', exact: false }).first()` | CEVAL-03-2 | |
| 컬럼 '총 평가 수' | `getByRole('columnheader', { name: '총 평가 수', exact: false }).first()` | CEVAL-03-3 | |
| 컬럼 '평가팀수' | `getByRole('columnheader', { name: '평가팀수', exact: false }).first()` | CEVAL-03-4 | |
| 현황 테이블 정렬 | — | CEVAL-43 | ⚠️ 1차 QA FAIL (QA-14893): 평균평점 내림차순 기본 정렬 미작동 — 수동 확인 필요. 데이터 의존 → 자동화 스킵(`diff` 기록) |

```typescript
// 핵심 로케이터 예시 — 고객 평가
const infoBox = admin.locator('.info-box-text');
await infoBox.first().waitFor({ state: 'visible', timeout: 10_000 });

const datepickers = admin.locator('.datepicker-input');
// count >= 2 검증
expect(await datepickers.count()).toBeGreaterThanOrEqual(2);

const applyBtn   = admin.getByRole('button', { name: '적용', exact: true });
const exportBtn  = admin.getByRole('button', { name: '내보내기' });

const colAvgRating = admin.getByRole('columnheader', { name: '평균 평점', exact: false }).first();
```

---

## 2. 캐디 평가 (TC ID 범위: CDEV-01 ~ CDEV-03-6)

> URL: `/club/page/caddie-evaluation`
> 안내문구: `.info-box-text` (전문 일치)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | CDEV-01 | 전문 일치 `checkText` — "캐디에 대한 고객들의 평가를 확인할 수 있습니다. 캐디 평가는 고객이 키오스크에서 스코어카드 출력 시, 평가가 가능합니다." |
| 조회기간 datepicker (1) | `.datepicker-input` (index 0) | CDEV-02 | `count() >= 2` 검증 |
| 조회기간 datepicker (2) | `.datepicker-input` (index 1) | CDEV-02 | `count() >= 2` 검증 |
| [적용] 버튼 | `getByRole('button', { name: '적용', exact: true })` | CDEV-02 | 비파괴(노출·활성만) |
| 컬럼 '태블릿 No.' | `getByRole('columnheader', { name: '태블릿 No.', exact: false }).first()` | CDEV-03-1 | |
| 컬럼 '캐디명' | `getByRole('columnheader', { name: '캐디명', exact: false }).first()` | CDEV-03-2 | |
| 컬럼 '평균 평점' | `getByRole('columnheader', { name: '평균 평점', exact: false }).first()` | CDEV-03-3 | |
| 컬럼 '총점' | `getByRole('columnheader', { name: '총점', exact: false }).first()` | CDEV-03-4 | |
| 컬럼 '총 평가 수' | `getByRole('columnheader', { name: '총 평가 수', exact: false }).first()` | CDEV-03-5 | |
| 컬럼 '평가팀수' | `getByRole('columnheader', { name: '평가팀수', exact: false }).first()` | CDEV-03-6 | |

```typescript
// 핵심 로케이터 예시 — 캐디 평가
const infoBox = admin.locator('.info-box-text');
await infoBox.first().waitFor({ state: 'visible', timeout: 10_000 });

expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2);
await expect(admin.getByRole('button', { name: '적용', exact: true })).toBeVisible();

// 캐디 평가 전용 컬럼 — '태블릿 No.'는 마침표 포함, exact: false 권장
const colTabletNo = admin.getByRole('columnheader', { name: '태블릿 No.', exact: false }).first();
const colCaddieName = admin.getByRole('columnheader', { name: '캐디명', exact: false }).first();
```

---

## 3. 후기 리스트 (TC ID 범위: RVL-01 ~ RVL-04, RVL-84)

> URL: `/club/page/review-list`
> 안내문구: `.info-box-text` (전문 일치)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | RVL-01 | 전문 일치 `checkText` — "라운드를 마친 고객이 스마트스코어앱에 등록한 후기를 관리할 수 있습니다. 후기에 대한 답변을 등록할 수 있고 숨기고자 하는 후기를 숨길 수 있습니다." |
| [1개월] 기간 버튼 | `getByRole('button', { name: '1개월' })` | RVL-02 | 기간 단축버튼 대표. 동일 패턴으로 '1주일' 등 존재 가능 |
| 조회기간 datepicker (1) | `.datepicker-input` (index 0) | RVL-02 | `count() >= 2` 검증 |
| 조회기간 datepicker (2) | `.datepicker-input` (index 1) | RVL-02 | `count() >= 2` 검증 |
| [적용] 버튼 | `getByRole('button', { name: '적용', exact: true })` | RVL-02 | 비파괴(노출·활성만) |
| 컬럼 '작성일시' | `getByRole('columnheader', { name: '작성일시', exact: false }).first()` | RVL-03-1 | |
| 컬럼 '내용' | `getByRole('columnheader', { name: '내용', exact: false }).first()` | RVL-03-2 | |
| 컬럼 '작성자' | `getByRole('columnheader', { name: '작성자', exact: false }).first()` | RVL-03-3 | |
| 컬럼 '전체평점' | `getByRole('columnheader', { name: '전체평점', exact: false }).first()` | RVL-03-4 | |
| 컬럼 '공감' | `getByRole('columnheader', { name: '공감', exact: false }).first()` | RVL-03-5 | |
| 컬럼 '비공감' | `getByRole('columnheader', { name: '비공감', exact: false }).first()` | RVL-03-6 | |
| 컬럼 '답변상태' | `getByRole('columnheader', { name: '답변상태', exact: false }).first()` | RVL-03-7 | |
| [숨김처리] 버튼 | `getByRole('button', { name: /숨김\s*처리/ })` | RVL-04 | ⚠️ 정규식 사용 필수 — 라벨이 '숨김 처리'→'숨김처리'로 변경됨(2026-06-05). 비파괴(노출·활성만) |
| [내보내기] 버튼 | `getByRole('button', { name: '내보내기' })` | RVL-04 | 비파괴(노출·활성만) |
| 골프장 의견 등록 팝업 > [의견등록] | — | RVL-84 | ⚠️ SKIP — 1차 QA FAIL (QA-14889): 답변내용 입력 요구 토스트 발생(등록 미완료). 파괴적 동작 → 비파괴 원칙상 자동화 제외 |

```typescript
// 핵심 로케이터 예시 — 후기 리스트
const infoBox = admin.locator('.info-box-text');
await infoBox.first().waitFor({ state: 'visible', timeout: 10_000 });

// 기간 단축버튼
await expect(admin.getByRole('button', { name: '1개월' })).toBeVisible();

expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2);
await expect(admin.getByRole('button', { name: '적용', exact: true })).toBeVisible();

// ⚠️ 버튼 라벨 변경 이력 대비 — 정규식 필수
const hideBtn = admin.getByRole('button', { name: /숨김\s*처리/ });
await expect(hideBtn).toBeVisible(); // 클릭 금지(비파괴)

const exportBtn = admin.getByRole('button', { name: '내보내기' });
await expect(exportBtn).toBeVisible(); // 클릭 금지(비파괴)
```

---

## 4. 후기 통계 (TC ID 범위: RVS-01 ~ RVS-04, RVS-CALC, RVS-RATING)

> URL: `/club/page/review-statistics`
> 안내문구: `.info-box-text` (전문 일치)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `.info-box-text` | RVS-01 | 전문 일치 `checkText` — "스마트스코어 앱에서 고객들이 평가한 후기 통계룰 통하여 개선사항 파악 및 고객 만족도를 향상 시킬 수 있습니다. 기간 별 조회 및 엑셀 다운로드가 가능합니다" |
| 안내문구 오타 | `.info-box-text` | RVS-01 (`diff`) | ⚠️ 오타 의심 — '후기 통계**룰** 통하여'(룰→를) + 문장 끝 마침표 누락. `diff` 기록, QA 확인 요망(2026-06-19 발견) |
| 기간 단축버튼 | `getByRole('button', { name: '...' })` | RVS-02 | '1주일'/'1개월' 등 — 노출 검증. 코드에서 name 미특정, 패턴 참조 |
| 조회기간 datepicker (1) | `.datepicker-input` (index 0) | RVS-02 | `count() >= 2` 검증 |
| 조회기간 datepicker (2) | `.datepicker-input` (index 1) | RVS-02 | `count() >= 2` 검증 |
| [조회] 버튼 | `getByRole('button', { name: '조회' })` | RVS-02 | 비파괴(노출·활성만) |
| [내보내기] 버튼 | `getByRole('button', { name: '내보내기' })` | RVS-02 / RVS-112 | ⚠️ 2차 QA FAIL (QA-14989, TC No.112): 전체 내역 아닌 현재 페이지만 다운로드. 비파괴(노출·활성만) — 수정 완료 여부 확인 필요(2026-06-22 기준 미fix) |
| 컬럼 '순서' | `getByRole('columnheader', { name: '순서', exact: true }).first()` | RVS-03-1 | `exact: true` |
| 컬럼 '날짜' | `getByRole('columnheader', { name: '날짜', exact: true }).first()` | RVS-03-2 | `exact: true` |
| 컬럼 '등록후기 수' | `getByRole('columnheader', { name: '등록후기 수', exact: true }).first()` | RVS-03-3 | `exact: true` |
| 컬럼 '전체' | `getByRole('columnheader', { name: '전체', exact: true }).first()` | RVS-03-4 | `exact: true` — '전체평점' 아님 주의 |
| 컬럼 '코스' | `getByRole('columnheader', { name: '코스', exact: true }).first()` | RVS-03-5 | `exact: true` |
| 컬럼 '그린' | `getByRole('columnheader', { name: '그린', exact: true }).first()` | RVS-03-6 | `exact: true` |
| 컬럼 '서비스' | `getByRole('columnheader', { name: '서비스', exact: true }).first()` | RVS-03-7 | `exact: true` |
| 컬럼 '진행' | `getByRole('columnheader', { name: '진행', exact: true }).first()` | RVS-03-8 | `exact: true` |
| 컬럼 '식음료' | `getByRole('columnheader', { name: '식음료', exact: true }).first()` | RVS-03-9 | `exact: true` |
| 후기 통계 차트(SVG) | `admin.locator('svg')` | RVS-04 | `count() >= 1` — 데이터 의존. SVG 1개 이상 존재 여부만 검증 |
| 통계표 계산 정합성 | `ReviewStatsPage` (L3 POM) | RVS-CALC | ⚠️ 데이터 의존 — 조회기간 내 후기 0건 시 자동 SKIP. 건수/평점 ≥ 0, '전체' 평점이 5항목 평균인지 자동 추론(`verifyInvariants`) |
| '전체' 평점 공식 잠금 | `ReviewStatsPage.rows()` | RVS-RATING | ⚠️ 데이터 의존 — `lockOrSkipFormula` 로 `OVERALL_RATING_CANDIDATES` 후보 중 실제 공식 추론. 데이터 없을 시 SKIP |

```typescript
// 핵심 로케이터 예시 — 후기 통계
const infoBox = admin.locator('.info-box-text');
await infoBox.first().waitFor({ state: 'visible', timeout: 10_000 });

expect(await admin.locator('.datepicker-input').count()).toBeGreaterThanOrEqual(2);
await expect(admin.getByRole('button', { name: '조회' })).toBeVisible();

// 통계표 컬럼 — 후기 통계는 exact: true 사용(다른 메뉴와 상이)
const colOverall = admin.getByRole('columnheader', { name: '전체', exact: true }).first();
const colCourse  = admin.getByRole('columnheader', { name: '코스',  exact: true }).first();
const colGreen   = admin.getByRole('columnheader', { name: '그린',  exact: true }).first();

// SVG 차트 존재 검증
expect(await admin.locator('svg').count()).toBeGreaterThanOrEqual(1);

// L3 POM — 계산 정합성 (데이터 의존)
const rvsPage = new ReviewStatsPage(admin);
if (!(await rvsPage.isEmpty().catch(() => true))) {
  const rvsRows = await rvsPage.rows();
  await verifyInvariants(admin, P, R, 'RVS-CALC', rvsRows, reviewInvariants);
  await lockOrSkipFormula(admin, P, R, 'RVS-RATING', "'전체' 평점", rvsRows, r => r.overall, OVERALL_RATING_CANDIDATES);
}
```

---

## 공통 사항

### 페이지 진입 대기 패턴 (전 메뉴 공통)

```typescript
// 모든 run*() 함수 최초 실행 시 동일 패턴 적용
await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
// .catch(() => {}) — 안내문구 미존재 시에도 후속 TC 계속 진행
```

### 공통 액션 (`runCommonActions`)

```typescript
// 4개 메뉴 모두 마지막에 runCommonActions(admin, P, R) 호출
// 공통 TC(페이지네이션, 컬럼 정렬 토글, 행 클릭 등) 포함 — suites.ts runCommonActions() 참조
await runCommonActions(admin, P, R);
```

### QA FAIL / 주요 이슈 요약

| 이슈 ID | 메뉴 | TC ID | 내용 | 상태 |
|---------|------|-------|------|------|
| QA-14893 | 고객 평가 | CEVAL-43 | 현황 테이블 평균평점 내림차순 기본 정렬 미작동 | 1차 FAIL — 수동 확인 필요 |
| QA-14889 | 후기 리스트 | RVL-84 | 골프장 의견 등록 팝업 — [의견등록] 클릭 시 토스트 오류(등록 미완료) | 1차 FAIL — 파괴적 동작 제외 |
| QA-14989 | 후기 통계 | RVS-112 | [내보내기] 전체 내역 아닌 현재 페이지만 다운로드 | 2차 FAIL — 2026-06-22 기준 미fix |

### 메뉴별 `exact` 옵션 차이 주의

| 메뉴 | columnheader `exact` | 비고 |
|------|----------------------|------|
| 고객 평가 | `false` | 부분 일치 |
| 캐디 평가 | `false` | 부분 일치 |
| 후기 리스트 | `false` | 부분 일치 |
| 후기 통계 | `true` | **완전 일치** — '전체' 등 짧은 라벨 충돌 방지 |
