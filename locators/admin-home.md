# 경기관제 어드민 - UI 요소 & Playwright Locator 정의

> 사이트: https://td30.smartscore.kr/ss/admin/index.html
> 클럽명: 킹즈락
> 분석일: 2026-05-29
> 분석 범위: SNB(사이드 네비게이션) 전체 + HOME 페이지

---

## 🔍 사이트 구조 핵심 특성

| 특성 | 내용 | Locator 영향 |
|------|------|-------------|
| **아키텍처** | MPA (멀티페이지) — 각 메뉴가 `.html?act=` 별도 페이지 | URL 기반 네비게이션 검증 가능 |
| **iframe** | 없음 (단일 문서) | frame 처리 불필요 |
| **data-testid** | 전무 | 텍스트/href 의존 |
| **id** | SNB 전무 / HOME 팝업·입력엔 존재 | 영역별 전략 상이 |
| **class** | SNB는 `eval_menu`만, HOME은 의미있는 class 보유 | 영역별 전략 상이 |
| **대분류 메뉴** | `href="javascript:void(0)"` (펼침 토글) | 텍스트 클릭만, URL 검증 불가 |
| **하위 메뉴** | 실제 `.html` href 보유 | href 기반 식별 최적 |

---

## ⚠️ 중복 텍스트 — href로 구분 필수

| 중복 텍스트 | 구분 방법 |
|------------|----------|
| **코스분석** | 대분류 토글 `javascript:void(0)` vs 하위 `/course.html` |
| **코스** | `poll.html?key=course` vs `poll.html?key=green` (둘 다 "코스") |
| **캐디관리** | 대분류 토글 vs 스마트캐디 하위 `/sc_caddie.html` |

> `getByText('코스')` / `getByRole('link',{name:'코스'})` 는 strict mode 위반 → href CSS 필수

---

## 1. SNB (사이드 네비게이션) — 전체 메뉴 맵

### 권장 Locator 전략

- **대분류 (펼침 토글)**: `page.getByRole('link', { name: '...', exact: true })`
- **하위 메뉴 (1순위 권장)**: `page.locator('a[href="..."]')` — href가 가장 안정적
- **텍스트 고유 하위**: `page.getByRole('link', { name: '...' })`

### 전체 메뉴 href 맵

| 대분류 | 하위 메뉴 | href |
|--------|-----------|------|
| (단일) | HOME | `/ss/admin/index.html` |
| **계정 권한 관리** | 전체 사용자 계정 | `/ss/admin/account.html` |
| | 전체 권한 그룹 | `/ss/admin/permission.html` |
| **게시판** | FAQ | `/ss/admin/board.html?act=faq` |
| | Q&A | `/ss/admin/board.html` |
| | 버젼관리 | `/ss/admin/board.html?act=ver` |
| **캐디관리** | 전체캐디 | `/ss/admin/caddie.html` |
| | 캐디등록/수정/해지 | `/ss/admin/caddie.html?act=reg` |
| | 캐디실적 | `/ss/admin/caddie.html?act=record` |
| | 캐디평가 | `/ss/admin/caddie.html?act=score` |
| | 캐디주문실적 | `/ss/admin/caddie.html?act=caddie_order` |
| | 그늘집주문내역 | `/ss/admin/caddie.html?act=order_list` |
| **캐디피 관리** | 캐디피 설정 | `/ss/admin/caddiefee.html?act=setting` |
| | 캐디피 통계 | `/ss/admin/caddiefee.html?act=stat` |
| | 캐디피 결제내역 | `/ss/admin/caddiefee.html?act=payment` |
| | 캐디 자료 / 신고서 | `/ss/admin/caddiefee.html?act=doc` |
| **식음관리(F&B)** | 버전 업데이트 | `/ss/admin/tableorder.html?act=version` |
| | 그늘집 및 TOS 관리 | `/ss/admin/tableorder.html?act=snackbar` |
| | 식당 관리 | `/ss/admin/tableorder.html?act=restaurant` |
| | 상품 등록/관리 | `/ss/admin/tableorder.html?act=menu` |
| | 통계 | `/ss/admin/tableorder.html?act=stats` |
| **라운드관리** | 전체 라운드 | `/ss/admin/rounding.html` |
| | 단체 라운드 | `/ss/admin/rounding.html?act=group` |
| | 라운드 코스관리 | `/ss/admin/rounding.html?act=course` |
| | 태블릿 설정 | `/ss/admin/rounding.html?act=tablet_settings` |
| | 출력확인 | (href 없음 — 버튼/JS 동작) |
| | 배토기록조회 | `/ss/admin/rounding.html?act=topdressing` |
| | 배토 통계 | `/ss/admin/rounding.html?act=beto_calc` |
| **내장객관리** | 문자발송내역 | `/ss/admin/member.html?act=smslog` |
| **라이브관리** | 메시지관리 | `/ss/admin/member.html?act=live_msg` |
| | 경기진행관리 | `/ss/admin/member.html?act=live_self` |
| | 광고 관리 | `/ss/admin/member.html?act=ad_settings` |
| | 아이콘 관리 | `/ss/admin/member.html?act=icon_settings` |
| | 홀이벤트관리 | `/ss/admin/member.html?act=live_evt` |
| | 홀별정산관리 | `/ss/admin/member.html?act=hole_calc` |
| **코스분석** | 코스분석 | `/ss/admin/course.html` |
| | 핀포지션분석 | `/ss/admin/holepin.html?act=report` |
| | 핀포지션 변경이력 | `/ss/admin/holepin.html?act=change_history` |
| **고객평가 관리** | 코스 (`.eval_menu`) | `/ss/admin/poll.html?key=course` |
| | 식음료 (`.eval_menu`) | `/ss/admin/poll.html?key=food` |
| | 코스 (`.eval_menu`) | `/ss/admin/poll.html?key=green` |
| | 페어웨이 (`.eval_menu`) | `/ss/admin/poll.html?key=fairway` |
| | 직원 (`.eval_menu`) | `/ss/admin/poll.html?key=server` |
| | 서비스 (`.eval_menu`) | `/ss/admin/poll.html?key=service` |
| **관제관리** | 핀포지션관리 | `/ss/admin/holepin.html?act=mng` |
| | 홀맵 구역 관리 | `/ss/admin/holemap.html?act=mng` |
| | 진행시간 표준설정 | `/ss/admin/monitor.html?act=settime` |
| | 진행시간 실시간 | `/ss/admin/monitor.html?act=live_time` |
| | 진행시간 조회 | `/ss/admin/monitor.html?act=time_day` |
| | 진행시간 통계 | `/ss/admin/monitor.html?act=time_stat` |
| | 공지사항 | `/ss/admin/monitor.html?act=notice2` |
| | 메시지 기록 조회 | `/ss/admin/monitor.html?act=message_record` |
| | 라이브채팅 공지 조회 | `/ss/admin/monitor.html?act=livechat_notice_record` |
| **복지몰** | 복지몰 회원관리 | `/ss/admin/welfare.html` |
| **카트관리** | 전체카트 | `/ss/admin/cart.html` |
| **골프장 후기** | 후기 리스트 | `/ss/admin/review.html?act=list` |
| | 후기 통계 | `/ss/admin/review.html?act=analytics` |
| **웰컴 메시지** | 골프장소식 | `/ss/admin/welcome.html?act=notice` |
| | 그린스피드 | `/ss/admin/welcome.html?act=green_reg` |
| **스마트캐디** | 캘린더 | `/ss/admin/sc_calendar.html?act=notice_List` |
| | 매칭 관리 | `/ss/admin/sc_match.html?act=List` |
| | 캐디관리 | `/ss/admin/sc_caddie.html?act=List` |
| | 클럽정보관리 | `/ss/admin/sc_clubSetting.html?act=workInfo_List` |

> ※ 셀프체크는 대분류 토글(`javascript:void(0)`)만 존재

### Locator 예시

```typescript
// ── 대분류 펼치기 ──
page.getByRole('link', { name: '캐디관리', exact: true })

// ── 하위 메뉴 (href 기반 - 1순위 권장) ──
page.locator('a[href="/ss/admin/account.html"]')              // 전체 사용자 계정
page.locator('a[href="/ss/admin/caddie.html?act=reg"]')       // 캐디등록/수정/해지

// ── 중복 텍스트 '코스' — key로 구분 필수 ──
page.locator('a[href="/ss/admin/poll.html?key=course"]')      // 코스(고객평가)
page.locator('a[href="/ss/admin/poll.html?key=green"]')       // 코스(그린)

// ── 텍스트 고유 하위 메뉴 ──
page.getByRole('link', { name: '전체캐디' })
page.getByRole('link', { name: '핀포지션분석' })
```

### 권장 Helper 패턴 (메뉴 80개+ 대응)

```typescript
async function gotoMenu(page, parent: string, href: string) {
  await page.getByRole('link', { name: parent, exact: true }).click();
  await page.locator(`a[href="${href}"]`).click();
  await expect(page).toHaveURL(new RegExp(href.replace(/[?]/g, '\\?')));
}
```

---

## 2. HOME 페이지 (`index.html`)

> HOME 영역 요소는 SNB와 달리 의미있는 id/class를 보유

### 2-1. 헤더 — 클럽명

| 요소 | Locator | 방식 |
|------|---------|------|
| 클럽명 (킹즈락) | `page.getByRole('heading', { name: '킹즈락' })` | 1순위 (권장) |
| | `page.locator('h2.club-name')` | 3순위 CSS |

### 2-2. 📢 공지 팝업 (SMART CLUB ADMIN NOTICE)

| 요소 | Locator | 방식 | class |
|------|---------|------|-------|
| 공지 제목 | `page.getByRole('heading', { name: /옥공지/ })` | 1순위 | (h3) |
| **× 닫기 (우상단)** | `page.locator('.btn-top-close')` | 3순위 CSS | `btn-top-close btn-top` |
| 닫기 버튼 | `page.getByRole('button', { name: '닫기' })` | 1순위 | `btn-close` |
| 목록보기 | `page.locator('#btn-list')` | 3순위 id | `btn-list` |

> 🔧 **공지 팝업 닫기 권장 코드** (dashboard-admin.spec.ts STEP 10 수정용):
> ```typescript
> await adminPage.locator('.btn-top-close').click();
> // 또는
> await adminPage.getByRole('button', { name: '닫기' }).click();
> ```

### 2-3. 🔑 비밀번호 변경 레이어팝업

| 요소 | Locator | 방식 | 비고 |
|------|---------|------|------|
| 현재 비밀번호 | `page.locator('#InputMyCurPw')` | 3순위 id | label/placeholder/name 없음 → id 필수 |
| 새 비밀번호 | `page.locator('#InputMyNewPw')` | 3순위 id | |
| 새 비밀번호 확인 | `page.locator('#InputMyNewPw_Confirm')` | 3순위 id | |
| 변경 버튼 | `page.getByRole('button', { name: '변경' })` | 1순위 | `.btnChangeMyPw_proc` |
| 취소 버튼 | `page.getByRole('button', { name: '취소' })` | 1순위 | `.btnClose_LP_changeMypw` |

### 2-4. 📊 내장객 통계 테이블

```typescript
const statsTable = page.locator('table.table01');
```

컬럼 (8개): 날짜 / 총 내장객 / 유효 내장객 / 기존 SS회원 / 신규 SS회원 / 일일 SS회원 / SS회원 비율 / 출력 횟수

```typescript
// 특정 컬럼 헤더
page.locator('table.table01').getByRole('columnheader', { name: '총 내장객' })

// 특정 행 스코프 (날짜 기준)
const row = page.locator('table.table01 tbody tr').filter({ hasText: '2026-05-29' });
```

### 2-5. 안내 박스 (위젯)

| 요소 | Locator | 텍스트 |
|------|---------|--------|
| 서비스 제공 안내 | `page.locator('.box01')` | "현재 귀클럽에서는 스마트스코어 서비스가 제공중입니다." |
| 누적고객 안내 | `page.locator('.box02')` | (아래 가변 텍스트 참조) |
| SNB 컨테이너 | `page.locator('.navbox')` | 사이드 메뉴 전체 |

#### box02 — 누적고객 안내 (가변 텍스트)

**전체 문구:**
> "2026년 05월 29일 현재, SS회원으로 가입되어 귀클럽에서 라운드을 하였으므로, 귀클럽이 마케팅 목적으로 활용 가능한 누적고객은 총 7명입니다."

**가변 요소:**

| 항목 | 예시값 | 패턴 |
|------|--------|------|
| 날짜 | `2026년 05월 29일` | `\d{4}년 \d{2}월 \d{2}일` |
| 인원수 | `7명` | `\d+명` |

```typescript
// ── 1순위: 고정 문구로 박스 확인 (가변값 회피) ──
page.locator('.box02').filter({ hasText: '마케팅 목적으로 활용 가능한 누적고객은' })

// ── 전체 검증 (정규식 - 날짜/인원수 가변) ──
await expect(page.locator('.box02')).toHaveText(
  /\d{4}년 \d{2}월 \d{2}일 현재, SS회원으로 가입되어 귀클럽에서 라운드을 하였으므로, 귀클럽이 마케팅 목적으로 활용 가능한 누적고객은 총 \d+명입니다\./
);

// ── 누적고객 인원수만 추출 ──
const text = await page.locator('.box02').innerText();
const count = text.match(/누적고객은 총 (\d+)명/)?.[1];   // "7"
```

> ⚠️ **가변 텍스트 검증 원칙**: 고정값(`...7명입니다`)으로 단언하면 날짜·인원이 바뀔 때 깨짐. 불변 부분만 `hasText`로 확인하거나 가변 자리를 `\d+`로 치환.

---

## 3. 영역별 Locator 전략 요약

| 영역 | 최적 방식 | 이유 |
|------|----------|------|
| SNB 메뉴 | `a[href="..."]` (href CSS) | id/class 없음, 텍스트 중복 |
| 팝업 버튼 | `getByRole('button', {name})` | 텍스트 고유, 의미있는 class 보유 |
| password 입력 | `#id` (CSS id) | label/placeholder/name 전무 |
| 테이블 | `table.table01` + `getByRole('columnheader')` | class 보유 |
| 클럽명/제목 | `getByRole('heading')` | 시맨틱 명확 |
| 가변 텍스트 | 정규식 또는 부분 `hasText` | 날짜·수치 변동 대응 |

---

## 4. 개선 권고사항 (개발팀 전달용)

1. **data-testid 전무** — SNB 메뉴 80개+ 가 id/class 없이 href·텍스트에만 의존. 메뉴 구조 변경 시 테스트 취약
2. **중복 텍스트 메뉴** — "코스"(2개), "캐디관리"(2개), "코스분석"(2개)가 동일 텍스트로 존재 → href 없이는 식별 불가
3. **password 입력 라벨 미연결** — `#InputMyCurPw` 등에 `<label for>` 연결 없어 접근성 저하 + `getByLabel` 불가

### 권장 data-testid 예시

```html
<!-- SNB 메뉴 -->
<a href="/ss/admin/account.html" data-testid="menu-account">전체 사용자 계정</a>

<!-- 비밀번호 입력 -->
<input id="InputMyCurPw" data-testid="input-current-pw" type="password">

<!-- 통계 테이블 -->
<table class="table01" data-testid="table-visitor-stats">
```
