# 대시보드 UI 요소 & Playwright Locator 정의

> 사이트: https://sv1td4.smartscore.kr/ko/dashboard  
> 클럽명: 킹즈락  
> 분석일: 2026-05-21 (2026-05-29 실제 DOM 재확인)  
> 참고: data-testid 전무, id는 최상위 래퍼(app, container, scroll-contents)에만 존재. 대부분 텍스트/CSS class 기반 식별

---

## ⭐ 확인된 DOM 요약 (2026-05-29) + 인증 흐름 연결

> `[클라우드 사용해보기]` 도달 지점 = 이 대시보드.
> **경기관제 카드 > [어드민 가기]** → td17 어드민으로 진입 (auth.setup 인증 다리)

| 요소 | 확인된 Selector | 비고 |
|------|----------------|------|
| 페이지 타이틀 | `클라우드` | `toHaveTitle('클라우드')` |
| 인사말 | `h2.fs-24` ("전영신 님 안녕하세요!") | `getByRole('heading', { name: /님 안녕하세요/ })` |
| 클럽명 | `h3.fs-16.fw-500` ("킹즈락") | |
| 섹션 타이틀 | `h4.sub-title` ("스마트스코어 제공 서비스") | |
| 언어 선택 | `.select-btn` ("한국어") / 항목 `.slot-item`(활성 `.slot-item.active`) | |
| 프로필 | `.profile-img` ("전") | |
| 이용가이드 | `.button-guide` | `getByRole('button', { name: '이용가이드' })` |
| SNB 대시보드 | `a[href="/ko//dashboard"]` (`.depth-1-wrap`) | |
| SNB 계정설정 | `.depth-1-title`("계정설정") → `.depth-2.hidden`(계정관리/권한관리/마이페이지) | 클릭 시 펼침 |
| SNB 토글 | `.snb-toggle__switchbtn` (checkbox) | |
| 서브도메인 검색 | `input.form-control[placeholder="서브도메인 입력"]` | `getByPlaceholder('서브도메인 입력')` |
| 서비스 카드 그리드 | `.smart-admin-service-con` | |
| 개별 카드 | `.smart-admin-service` | filter({hasText}) 로 특정 |

### 서비스 카드 목록 (확인됨, 10종)
경기관제 / 데이터마케팅 / ERP / 테이블오더 / 셀프체크 / 대기호출 / 블랙박스 / 코스관리 / 무전기 / 카트내결제

### 카드 내 버튼 (확인됨)
| 카드 | 버튼 | Selector |
|------|------|----------|
| 경기관제 | 어드민 가기 / 관제 가기 / 그늘집 가기 | `.button-common.accent` |
| 대기호출 | 관리 / 뷰어 | `.button-common.accent` |
| 그 외 | 바로가기 | `.button-common.accent.full` |
| 전 카드 공통 | 더 알아보기 | `.badge-more` |

### 🔑 auth.setup 인증 다리 (경기관제 → 어드민)
```typescript
// 클라우드 대시보드 도달 후
const golfCard = page.locator('.smart-admin-service').filter({ hasText: '경기관제' });
await golfCard.getByRole('button', { name: '어드민 가기' }).click();
// → td17 어드민 진입 → 세션 저장
```

---

## 1. GNB (상단 헤더)

| UI 요소 | Playwright Locator | 방식 | 비고 |
|---------|-------------------|------|------|
| 로고 | `page.locator('header.header-bar img[alt="smartscore cloud"]')` | 3순위 CSS | alt 속성 활용 |
| 골프장명 (킹즈락) | `page.locator('h3.fs-16.fw-500')` | 3순위 CSS | 또는 `getByText('킹즈락')` |
| 언어 선택 버튼 | `page.locator('.select-btn')` | 3순위 CSS | 드롭다운 트리거 |
| 언어 목록 아이템 | `page.locator('.slot-list .slot-item').filter({ hasText: '한국어' })` | 3순위 CSS + 텍스트 필터 | 활성 항목은 `.slot-item.active` |
| 이용가이드 버튼 | `page.getByRole('button', { name: '이용가이드' })` | 1순위 getByRole | |

---

## 2. SNB (사이드 네비게이션)

| UI 요소 | Playwright Locator | 방식 | 비고 |
|---------|-------------------|------|------|
| SNB 토글 (접기/펼치기) | `page.locator('label.snb-toggle')` | 3순위 CSS | |
| 대시보드 메뉴 링크 | `page.locator('a[href="/ko//dashboard"]')` | 3순위 CSS | 또는 `getByText('대시보드')` |
| 계정설정 메뉴 | `page.locator('span.depth-1-title').filter({ hasText: '계정설정' })` | 3순위 CSS | 클릭 시 하위 메뉴 펼침 |
| 계정관리 서브메뉴 | `page.getByRole('link', { name: '계정관리' })` | 1순위 getByRole | |
| 권한관리 서브메뉴 | `page.getByRole('link', { name: '권한관리' })` | 1순위 getByRole | |
| 마이페이지 서브메뉴 | `page.getByRole('link', { name: '마이페이지' })` | 1순위 getByRole | |
| 지원센터 전화번호 | `page.getByText('1877-7281')` | 1순위 getByText | |

---

## 3. 대시보드 메인 컨텐츠

| UI 요소 | Playwright Locator | 방식 | 비고 |
|---------|-------------------|------|------|
| 인사말 헤딩 | `page.getByRole('heading', { name: /님 안녕하세요/ })` | 1순위 getByRole | 사용자명 포함 정규식 권장 |
| 최고 관리자 텍스트 | `page.getByText('최고 관리자')` | 1순위 getByText | |
| 골프장 로고 이미지 | `page.locator('img[alt="club"]')` | 3순위 CSS | |

---

## 4. 서비스 필터 영역

| UI 요소 | Playwright Locator | 방식 | 비고 |
|---------|-------------------|------|------|
| 섹션 타이틀 | `page.locator('h4.sub-title')` | 3순위 CSS | 텍스트: "스마트스코어 제공 서비스" |
| 서브도메인 검색 입력창 | `page.getByPlaceholder('서브도메인 입력')` | 1순위 getByPlaceholder | `<input class="form-control">` |
| 검색창 초기화 버튼 | `page.locator('img[alt="delete"]')` | 3순위 CSS | 텍스트 없는 아이콘 버튼 |
| 이용중 필터 텍스트 | `page.locator('p.fc-grey400').filter({ hasText: '이용중' })` | 3순위 CSS | |
| 이용중 토글 스위치 | `page.locator('label.toggle-button input[type="checkbox"]')` | 3순위 CSS | label 내부 checkbox |

---

## 5. 서비스 카드 (공통 패턴)

- 카드 그리드 컨테이너: `.smart-admin-service-con`
- 개별 카드: `.smart-admin-service`

```typescript
// 특정 서비스 카드 스코프 설정 (권장 패턴)
const card = page.locator('.smart-admin-service').filter({ hasText: '경기관제' });
```

| 서비스 카드 | Locator |
|------------|---------|
| 경기관제 | `page.locator('.smart-admin-service').filter({ hasText: '경기관제' })` |
| 데이터마케팅 | `page.locator('.smart-admin-service').filter({ hasText: '데이터마케팅' })` |
| ERP | `page.locator('.smart-admin-service').filter({ hasText: 'ERP' })` |
| 테이블오더 | `page.locator('.smart-admin-service').filter({ hasText: '테이블오더' })` |
| 셀프체크 | `page.locator('.smart-admin-service').filter({ hasText: '셀프체크' })` |
| 대기호출 | `page.locator('.smart-admin-service').filter({ hasText: '대기호출' })` |
| 블랙박스 | `page.locator('.smart-admin-service').filter({ hasText: '블랙박스' })` |
| 코스관리 | `page.locator('.smart-admin-service').filter({ hasText: '코스관리' })` |
| 무전기 | `page.locator('.smart-admin-service').filter({ hasText: '무전기' })` |
| 카트내결제 | `page.locator('.smart-admin-service').filter({ hasText: '카트내결제' })` |

---

## 6. 서비스 카드 내 버튼

| 버튼 | Playwright Locator | 방식 | className |
|------|-------------------|------|-----------|
| 더 알아보기 (각 카드) | `card.getByRole('button', { name: '더 알아보기' })` | 1순위 + 카드 스코프 | `.badge-more.ml-8` |
| 이용중 배지 | `card.getByText('이용중')` | 1순위 + 카드 스코프 | |
| 어드민 가기 (경기관제) | `card.getByRole('button', { name: '어드민 가기' })` | 1순위 getByRole | `.button-common.accent` |
| 관제 가기 (경기관제) | `card.getByRole('button', { name: '관제 가기' })` | 1순위 getByRole | `.button-common.accent` |
| 그늘집 가기 (경기관제) | `card.getByRole('button', { name: '그늘집 가기' })` | 1순위 getByRole | `.button-common.accent` |
| 바로가기 (일반) | `card.getByRole('button', { name: '바로가기' })` | 1순위 getByRole | `.button-common.accent.full` |
| 관리 (대기호출) | `card.getByRole('button', { name: '관리' })` | 1순위 getByRole | |
| 뷰어 (대기호출) | `card.getByRole('button', { name: '뷰어' })` | 1순위 getByRole | |

---

## 7. 개선 권고사항 (개발팀 전달용)

### 현재 문제점

1. **data-testid 전무** — 모든 요소에 `data-testid`가 없어 텍스트/CSS에 의존. 서비스명·버튼 텍스트 변경 시 테스트가 즉시 깨짐
2. **중복 버튼 텍스트** — "더 알아보기", "바로가기"가 카드마다 동일 텍스트로 반복 → 반드시 부모 카드 스코프(`.filter`)로 좁혀야 함
3. **개별 카드 id 부재** — 서비스 카드에 id 없음, CSS class에만 의존

### 권장 data-testid 예시

```html
<!-- 서비스 카드 -->
<div class="smart-admin-service" data-testid="service-card-golf-control">

<!-- 버튼 -->
<button data-testid="btn-golf-control-admin">어드민 가기</button>

<!-- 입력창 -->
<input data-testid="input-subdomain-filter" placeholder="서브도메인 입력">
```
