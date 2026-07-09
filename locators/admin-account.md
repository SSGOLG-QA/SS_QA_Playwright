# 계정 관리 3종 (계정리스트 · 계정권한관리 · 계정관리인리스트) - UI 요소 & Locator

> URL: `/club/page/account-list` · `/club/page/account-permission` · `/club/page/account-admin-list(미구현)`
> 분석일: 2026-06-23 / 기준: lib/suites.ts runAccount*() 역문서화
> 비파괴 원칙: 저장/적용/삭제 등 데이터 변경 동작은 노출·활성 검증만(클릭 금지)
> ⚠️ 동적 ID(tgv-N-*) 금지 — 섹션 컨테이너 스코프 후 label/button 접근. 중복 버튼은 `.contents-box` 스코프 필수.

---

## 1. 계정 리스트 (ACL-01 ~ ACL-04)

> URL: `/club/page/account-list` *(코드 주석 추정)*
> 안내문구: `AccountListPage.info()` → `.info-box-text` 계열 (전문 일치 `checkText`)

### 1-1. 안내 문구

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `page.info()` (`AccountListPage` PageObject 메서드) | ACL-01 | 전문 일치 `checkText` |

**전문 일치 기대값:**
```
골프장에 등록된 계정들을 관리할 수 있습니다. 계정의 활성/중지, 패스워드 변경. 로그아웃 등 계정 상태에 대한 변경이 가능합니다.
```

---

### 1-2. 검색 영역

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 이름 검색 input | `page.nameSearch()` (`AccountListPage` PageObject 메서드) | ACL-02 | 노출 확인 |
| [적용] 버튼 | `page.applyBtn().first()` (`AccountListPage` PageObject 메서드) | ACL-02 | 비파괴(노출만), `.first()` 필수(중복 가능) |
| 계정 상태 드롭다운 | `vue-select` 계열 (PageObject 내부) | — | ⚠️ 드리프트: 옵션명이 기획서와 상이(TC No.5) |

> ⚠️ **드리프트 기록 (JIRA 미등록)**
> - `${R}_4b`: 검색 영역 버튼명 `[검색]` → `[적용]`으로 구현(기획서와 상이)
> - `${R}_5`: 계정 상태 드롭다운 옵션명이 기획서와 상이

```typescript
// AccountListPage PageObject 핵심 메서드 참조
const page = new AccountListPage(admin);
await page.ready();                          // 페이지 로드 대기
const nameInput = page.nameSearch();         // 이름 검색 input
const applyButton = page.applyBtn().first(); // [적용] 버튼 (첫 번째)
```

---

### 1-3. 테이블 컬럼

| 요소 | 기대 컬럼명 | TC ID | 비고 |
|------|-------------|-------|------|
| 컬럼 'No.' | `No.` | ACL-03-1 | `page.headers()` 반환값에서 `hasCol()` 검증 |
| 컬럼 '계정 상태' | `계정 상태` | ACL-03-2 | 동일 |
| 컬럼 '부서' | `부서` | ACL-03-3 | 동일 |
| 컬럼 '이름' | `이름` | ACL-03-4 | 동일 |
| 컬럼 'ID' | `ID` | ACL-03-5 | 동일 |
| 컬럼 '연락처' | `연락처` | ACL-03-6 | 동일 |
| 컬럼 '권한' | `권한` | ACL-03-7 | 동일 |

```typescript
// 컬럼 헤더 검증 패턴 (AccountListPage)
const acHeaders = await page.headers(); // 전체 컬럼명 배열 반환
// hasCol(acHeaders, '이름') 형태로 포함 여부 확인
```

> ⚠️ **드리프트 기록 (JIRA 미등록)**
> - `${R}_2`: 타이틀이 기획서와 상이(확인 필요)
> - `${R}_13`: 카드 요약(전체/활성/비활성) 수치가 검색 조건 변경 후 미갱신 — **버그 의심**

---

### 1-4. 행 액션 버튼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| [권한변경] 버튼 | `page.rowAction('권한변경')` (`AccountListPage` PageObject 메서드) | ACL-04-1 | 비파괴(노출만, 클릭 금지) |
| [로그아웃] 버튼 | `admin.getByRole('button', { name: '로그아웃' }).first()` | ACL-04-3 | ⚠️ 데이터 의존 — 현재 로그인된 계정 행에만 노출 |

> ⚠️ **드리프트 기록 (2026-06-17, JIRA 등록됨)**
> - `${R}_4`: `[패스워드 변경]` 버튼이 리스트 행 액션에서 **제거됨** (AS-IS: 권한변경만 노출)
> - 기획 원안: `[권한변경]` + `[패스워드 변경]` → 현 구현: `[권한변경]`만

> ⚠️ **드리프트 기록 (JIRA 미등록)**
> - `${R}_28`: 권한변경 팝업 내 버튼명이 기획서와 상이

```typescript
// 행 액션 버튼 로케이터 패턴
const permissionChangeBtn = page.rowAction('권한변경'); // PageObject 래핑
await expect(permissionChangeBtn).toBeVisible();         // 비파괴(노출만)

// [로그아웃] — 데이터 의존, 조건부 실행
const logoutCount = await admin.getByRole('button', { name: '로그아웃' }).count().catch(() => 0);
if (logoutCount > 0) {
  await expect(admin.getByRole('button', { name: '로그아웃' }).first()).toBeVisible();
} else {
  // skip() — 현재 로그인된 계정 없음, TC No.23 사전조건 미충족
}
```

---

## 2. 계정 권한 관리 (APM-01 ~ APM-03)

> URL: `/club/page/account-permission` *(코드 주석 명시)*
> 안내문구: `admin.locator('.info-box-text')` (전문 일치 `checkText`)

### 2-1. 안내 문구

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 안내문구 | `admin.locator('.info-box-text')` | APM-01 | 전문 일치 `checkText`, `.first()` 암묵 |

**전문 일치 기대값:**
```
등록된 계정에 부여할 권한을 세부적으로 설정할 수 있습니다. 권한 그룹을 추가하여 그룹을 생성할 수 있고, 권한 그룹을 선택하여 관리자 페이지에 노출시킬 항목을 설정할 수 있습니다.
```

> 페이지 로드 대기:
> ```typescript
> await admin.locator('.info-box-text').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
> ```

---

### 2-2. 액션 버튼

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| [권한 그룹 복사] 버튼 | `admin.getByRole('button', { name: '권한 그룹 복사', exact: true }).first()` | APM-02-1 | 비파괴(노출만) |
| [권한 그룹 추가] 버튼 | `admin.getByRole('button', { name: '권한 그룹 추가', exact: true }).first()` | APM-02-2 | 비파괴(노출만) |
| [권한 적용] 버튼 | `admin.getByRole('button', { name: '권한 적용', exact: true }).first()` | APM-02-3 | 비파괴(노출만, 클릭 시 권한 저장 → 파괴적) |

```typescript
// 액션 버튼 로케이터 패턴 (exact: true 필수)
const copyGroupBtn  = admin.getByRole('button', { name: '권한 그룹 복사', exact: true }).first();
const addGroupBtn   = admin.getByRole('button', { name: '권한 그룹 추가', exact: true }).first();
const applyPermBtn  = admin.getByRole('button', { name: '권한 적용',    exact: true }).first();
// 모두 비파괴 — toBeVisible() 만 검증
```

---

### 2-3. 권한 목록 테이블

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 컬럼헤더 '권한 명칭' | `admin.getByRole('columnheader', { name: '권한 명칭', exact: false }).first()` | APM-03 | 부분 일치(`exact: false`) |
| 컬럼헤더 '기능 명칭' | `admin.getByRole('columnheader', { name: '기능 명칭', exact: false }).first()` | APM-03 | 부분 일치(`exact: false`) |

```typescript
// 테이블 컬럼헤더 노출 검증
await expect(admin.getByRole('columnheader', { name: '권한 명칭', exact: false }).first()).toBeVisible();
await expect(admin.getByRole('columnheader', { name: '기능 명칭', exact: false }).first()).toBeVisible();
```

---

### 2-4. 접근 서비스 영역

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| 하위메뉴 체크박스 해제 버튼 | *(기획서 버튼명 확인 필요)* | — | ⚠️ 드리프트: 현 구현 `[전체]`로 노출(기획서와 상이) |

> ⚠️ **드리프트 기록 (TC No.61, JIRA 미등록)**
> - `${R}_61`: 하위메뉴 체크박스 해제 상태 버튼명이 `[전체]`로 구현 — 기획서와 상이

---

## 3. 계정 관리인 리스트 (TC 없음 / 미구현)

> URL: 미정 (`/club/page/account-admin-list` 추정)
> ⚠️ **SNB 미구현(링크 없음)** — 진입 불가. 모든 TC `noTC` 처리.
> TC 작성 담당: 강나연 / 기준일: 2026-06-23 (작성 진행중)

| 요소 | Locator | TC ID | 비고 |
|------|---------|-------|------|
| SNB 메뉴 링크 | *(미구현)* | — | SNB에 링크 없음 → 페이지 진입 불가 |
| 전체 UI 요소 | *(미정)* | — | 구현 완료 후 `check` / `checkText` TC 추가 예정 |

> **드리프트 기록:**
> - IA 변경표 53번 신규 추가 메뉴
> - SNB 미노출(미구현) — 구현 완료 후 재검증 및 로케이터 문서 업데이트 필요

```typescript
// 현재 구현 상태 — noTC 추적
noTC(
  '계정 관리 > 계정 관리인 리스트',
  '',
  'SNB 미구현(링크 없음) — TC 작성 진행중(강나연, 2026-06-23). 구현 완료 후 재검증 필요'
);
```

---

## 부록: PageObject 메서드 요약 (AccountListPage)

> `AccountListPage` (`lib/pages/AccountListPage.ts` 추정) — 계정 리스트 전용 L3 PageObject

| 메서드 | 반환 타입 | 설명 |
|--------|-----------|------|
| `ready()` | `Promise<void>` | 페이지 초기 로드 완료 대기 |
| `info()` | `Locator` | 안내문구 로케이터 |
| `nameSearch()` | `Locator` | 이름 검색 input 로케이터 |
| `applyBtn()` | `Locator` | [적용] 버튼 로케이터 (`.first()` 권장) |
| `headers()` | `Promise<string[]>` | 테이블 전체 컬럼명 배열 반환 |
| `rowAction(name: string)` | `Locator` | 행 액션 버튼 로케이터 (예: `'권한변경'`) |

---

## 드리프트 전체 요약

| 경로 | 기획(TO-BE) | 현 구현(AS-IS) | 참조 | 상태 |
|------|-------------|----------------|------|------|
| 계정 리스트 > 설명 영역 > 타이틀 | 기획서 타이틀 | 현 구현 타이틀 상이 | `${R}_2` | JIRA 미등록 |
| 계정 리스트 > 검색 영역 > 버튼명 | 기획서 검색 버튼명 | `[적용]`으로 구현 | `${R}_4b` | JIRA 미등록 |
| 계정 리스트 > 검색 영역 > 계정 상태 옵션명 | 기획서 옵션명 | 구현 옵션명 상이 | `${R}_5` | JIRA 미등록 |
| 계정 리스트 > 카드 요약 > 검색 미반영 | 검색 조건 변경 시 수치 갱신 | 전체/활성/비활성 미갱신 | `${R}_13` | **버그 의심**, JIRA 미등록 |
| 계정 리스트 > 행 액션 | `[권한변경]` + `[패스워드 변경]` | `[권한변경]`만 노출 | `${R}_4` | 2026-06-17 변경 확정 |
| 계정 리스트 > 권한변경 팝업 > 버튼명 | 기획서 팝업 버튼명 | 구현 버튼명 상이 | `${R}_28` | JIRA 미등록 |
| 계정 권한 관리 > 접근 서비스 > 하위메뉴 해제 버튼명 | 기획서 버튼명 | `[전체]`로 구현 | `${R}_61` | JIRA 미등록 |
| 계정 관리인 리스트 (전체) | SNB 링크 + 화면 구현 | SNB 미노출(미구현) | IA 변경표 53번 | TC 작성 진행중(강나연) |
