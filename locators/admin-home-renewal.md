# 경기관제 어드민 (리뉴얼) - HOME UI 요소 & TC 매핑 & Locator

> 사이트: https://td17.smartscore.kr/club/page/home
> 클럽명: 킹즈락 / 타이틀: "경기관제 - SMARTSCORE"
> TC: HOME #1~10
> 분석일: 2026-05-29
> ⚠️ **SPA 구조** — 경로 `/club/page/...`, SNB는 `href` 없이 **클릭 기반 라우팅**. 버튼 다수가 `<button>`이 아닌 `<div>` → role보다 **텍스트/클래스 기반** Locator 권장

---

## 1. GNB (헤더 — 공통)

| 요소 | Locator | 방식 | 비고 |
|------|---------|------|------|
| 타이틀 "경기관제" | `page.getByRole('heading', { level: 1, name: '경기관제' })` | 1순위 | `<h1>` |
| 골프장명 "킹즈락" | `page.locator('h3', { hasText: '킹즈락' })` | 3순위 | `<h3>` |
| 언어 선택(트리거) | `page.locator('.title', { hasText: '한국어' })` | 3순위 CSS | 드롭다운 |
| 언어 항목 | `page.locator('.slot-item')` (예: hasText '한국어'/'English') | 3순위 | `<div>` |
| 언어 목록 컨테이너 | `.slot-list-box` | | |
| 프로필 버튼 | `page.locator('.profile-img')` | 3순위 CSS | `<div>`("전") |

```typescript
// TC-3 언어 변경
await page.locator('.title', { hasText: '한국어' }).click();
await page.locator('.slot-item', { hasText: 'English' }).click();

// TC-4 프로필 → 마이페이지 팝업 (.profile-layer)
await page.locator('.profile-img').click();
const layer = page.locator('.profile-layer');
// 확정 필드: 이름(.container.fw-700 "전영신") / 아이디 / 부서 / 이메일 / 로그아웃
//   레이블 .fc-blue400, 값 .flex1.break-word, 로그아웃("로그아웃 >")
// ⚠️ QA 발견: TC 명시 '휴대폰' 필드가 실제 팝업에 미노출 (결함 후보)
```

## 2. SNB (사이드 — 공통)

> 구조: `.depth-1`(대메뉴) > `.depth-1-title`(타이틀) / `.depth-2`(하위 컨테이너) > 하위 항목(클래스·href 없음)
> 펼침 토글: `.snb-toggle__switchbtn`(전체), `.depth-2-toggle__switchbtn1~12`(대메뉴별)

| 동작 | Locator |
|------|---------|
| 대메뉴 펼치기 | `page.locator('.depth-1-title', { hasText: '라운드관리' })` |
| 하위 메뉴 클릭 | `page.locator('.depth-2 a', { hasText: '전체라운드' })` (확정: `<a>` href 없음) |

```typescript
// 권장: 대메뉴 펼친 뒤 하위 클릭
await page.locator('.depth-1-title', { hasText: '배토 관리' }).click();
await page.getByText('배토 통계', { exact: true }).click();
```

### 리뉴얼 SNB 실제 구조 (td17 확인)

| 대메뉴 | 하위 메뉴 |
|--------|-----------|
| **Home** | (단일) |
| **라운드관리** | 내장 현황 / 내장 통계 / 전체라운드 / 단체라운드 / 라운드 설정 / 홀별정산관리 / 카트관리 |
| **대회** | 대회관리 |
| **관제관리** | 관제팝업 / 아이콘 관리 / 메시지 기록 조회 / 라이브채팅 공지 조회 / 카트 이동경로 확인 |
| **태블릿 운영 관리** | 태블릿 기능 설정 / 메시지 관리 페이지 / 홀 이벤트 관리 |
| **홀맵 관리** | 홀맵 구역 관리 / 카트패스 진입여부 설정 / 티샷 유의 거리 설정 / 홀맵 미리보기 |
| **코스 운영 관리** | 핀 포지션 관리 / 핀포지션 변경이력 / 핀 포지션 분석 / (코스 분석 / 그린 스피드 / 골프장 소식) |
| **경기진행관리** | (진행시간 표준/실시간/조회/통계) |
| **캐디관리** | (캐디 리스트 / 캐디 등록 관리 / 캐디 실적) |
| **배토 관리** | 배토 기록 조회 / 배토 통계 |

### ⚠️ IA 개편안 vs 실제 td17 명칭 불일치 (확인 필요)

| IA 계획(변경안) | 실제 td17 | 비고 |
|----------------|-----------|------|
| 메시지 기기 조회 | **메시지 기록 조회** | 리네임 미적용 |
| 홀맵 구역 설정 | **홀맵 구역 관리** | 리네임 미적용 |
| 전체 라운드 / 단체 라운드 | 전체라운드 / 단체라운드 | 띄어쓰기 |
| 메시지 관리 | 메시지 관리 페이지 | 명칭 차이 |
| 핀 포지션 변경이력 | 핀포지션 변경이력 | 띄어쓰기 |

## 3. 메인 (공지 영역)

| 요소 | Locator | 비고 |
|------|---------|------|
| 공지 상세 카드 | `.contents-box.column` | 제목+본문 |
| 공지 본문 | `.notice-content` | 제목/날짜/본문 텍스트 |
| 공지 리스트 카드 | `.contents-box.column.pb-32` | "공지사항" |
| 공지 리스트 항목 | `.notice-list-item` (활성 `.notice-list-item.active`) | 제목+날짜 |
| 공지 아이콘 | `.ico-color-notice` | |
| 공지 제목 | `.contents-box .fw-700.fs-24` | "솔루션 업데이트 2" |
| 공지 일시 | `.contents-box span.fc-767676` | "2024.02.26 18:21" |
| **이전 버튼** | `button.btn-nav:has(i.ico-circle-arrow-prev)` | 최신글일 때 `disabled` |
| **다음 버튼** | `button.btn-nav:has(i.ico-circle-arrow-next)` | (확정) |

```typescript
// TC-5/9 공지 본문 노출
await expect(page.locator('.notice-content')).toBeVisible();

// TC-6 공지 리스트 활성 항목
await expect(page.locator('.notice-list-item.active')).toBeVisible();

// 특정 공지 선택
await page.locator('.notice-list-item', { hasText: '옥공지입니다' }).click();
```

---

## HOME TC ↔ 자동화 매핑 (#1~10)

| TC | 내용 | 자동화 | Locator / 비고 |
|----|------|--------|----------------|
| 1 | 홈 진입: 헤더+공지+SNB 접힘 | 🟢 | 각 영역 toBeVisible / SNB depth-2 접힘 상태 |
| 2 | GNB: 타이틀·골프장명·언어·프로필 | 🟢 | h1 / h3 / `.title` / `.profile-img` |
| 3 | 언어 드롭다운 선택 → 변경 | 🟢 | `.slot-item` 클릭 후 변경 확인 |
| 4 | 프로필 → 마이페이지 팝업 + 로그아웃 | 🟢 | `.profile-layer` (이름/아이디/부서/이메일/로그아웃 확정) ⚠️ '휴대폰' 필드 미노출(결함 후보) |
| 5 | 메인: 최신 공지(제목+본문) | 🟢 | `.notice-content` |
| 6 | 공지 제목: 좌/우 버튼·제목·일시 | 🟡 | 이전/다음 버튼 DOM 확인 필요 |
| 7 | 이전/다음 버튼 → 글 전환 | 🟡 | 버튼 셀렉터 확정 후 |
| 8 | 공지 수정 일시 표시 | 🟢 | `.notice-content` 내 일시 |
| 9 | 공지 본문 영역 | 🟢 | `.notice-content` |
| 10 | 공지 수정 반영 | 🔴 | 데이터 수정 의존 |

**요약: 🟢 ~5개 자동화 적합 / 🟡 ~4개 (팝업·이동버튼 DOM 추가 확인) / 🔴 1개**

---

## ⚠️ 추가 확인 필요 (스크립트 작성 전)

1. **공지 이전/다음 버튼** — `<button>`이 아니라서 미수집. 화면의 `< >` 화살표 클래스 확인 필요
2. **마이페이지 팝업** (TC-4) — 프로필 클릭 시 DOM 미수집
3. **SNB 하위 항목 셀렉터** — 클래스/href 없음. depth-2 내 텍스트 기반 클릭으로 접근 (요소 타입 확인 권장)
4. **경로 체계** — 리뉴얼은 `/club/page/...` SPA. URL 직접 이동보다 **SNB 클릭 네비게이션** 권장

---

## 📌 구버전(admin-home.md) 대비

| | 구버전(td30) | 리뉴얼(td17) |
|---|---|---|
| 경로 | `/ss/admin/*.html` | `/club/page/...` (SPA) |
| SNB | href 기반 | 클릭 라우팅(href 없음) |
| 클래스 | 거의 없음 | `.depth-1-title`, `.notice-list-item` 등 BEM-ish |
| 공지 | (팝업) | 홈 메인에 상시 노출(`.notice-content` + 리스트) |
