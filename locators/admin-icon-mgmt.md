# 관제관리 > 아이콘 관리 (리뉴얼 td17) - UI 요소 & Locator

> URL: `/club/page/live-icon` / 클럽: 킹즈락
> 분석일: 2026-06-01 / **재검증·갱신: 2026-06-04 (td17 리뉴얼 추가 배포 반영)**
> IA 스코프: `admin-snb-renewal.md` 기준 **아이콘 관리 → (라이브관리와 통합·이동) = 범위 포함**
> 공통: 기능설정/저장 `.button-common.primary`, 변경 `.button-common.negative`, 섹션 타이틀 `.sub-title-box`
>
> ⚠️ **2026-06-04 리뉴얼 변경점 (검증은 현 구현 AS-IS 기준, 기획 차이는 리포트 `기획-구현 차이` 시트에 기록)**
> - **헤더 GNB 타이틀**: `경기관제` → **`관제 어드민`** 변경 (h1). `openAdmin`·`auth.setup`은 헤더 텍스트 대신 URL(`/club/`)+SNB(`.depth-1-title`)로 도달 판정.
> - **안내문구 위치**: `.sub-title-box` 안 **`.desc-text`** (제목 `.sub-title`과 분리) → `checkText`는 `.desc-text` 스코프.
> - **컬럼명 공백**: `상세설명` → **`상세 설명`** → 공백무시 정규식(`/상세\s*설명/`)으로 매칭.
> - **[관제적용] 버튼 제거**: 기능 설정 섹션에 적용 버튼 없음(토글 즉시 반영/자동저장). (기획-구현 차이)
> - **아이콘명 편집 토글 의존**: "아이콘 관리" 기능 토글 **OFF → 카드 읽기전용**(`.icon-card-title`만, `.icon-card-input` 미렌더, 섹션 `저장` 비활성). ON 시 편집 가능. (기획-구현 차이)

---

## 1. 기능 설정 (`/club/page/live-icon` 상단)
> 설명: "관제지도 아이콘 시인성 향상 및 아이콘 관리 기능의 사용 여부를 설정합니다."

| 요소 | Locator | 비고 |
|------|---------|------|
| 섹션 타이틀 | `.sub-title-box` > `.sub-title`("기능 설정") | 제목과 설명이 분리됨 |
| 안내문구 | `.sub-title-box` > `.desc-text` | "관제지도 아이콘 시인성 향상 및 아이콘 관리 기능의 사용 여부를 설정합니다." |
| 테이블 | `headers: 기능명 / 상세 설명 / 설정` (rowCount 2) | ⚠️ '상세 설명'(공백) → 정규식 매칭 |
| 기능 토글 ×2 | ⚠️ `#tgv-1-0`, `#tgv-1-1` **금지(동적채번)** → 기능명 텍스트로 행 스코프 후 `label` 클릭 | 관제지도 아이콘 시인성 향상(ON) / 아이콘 관리(현재 OFF) |
| ~~관제적용~~ | **버튼 제거됨(2026-06-04)** — 토글 즉시 반영. 부재 확인(`getByRole('button',{name:'관제적용'}).toHaveCount(0)`) | (기획-구현 차이) |

```typescript
// 토글 ON — id 동적채번이므로 기능 행 + label 클릭, input으로 검증
const row = page.locator('.table-overflow-item tr').filter({ hasText: '관제지도 아이콘 시인성 향상' });
await row.locator('label').first().click();
await expect(row.locator('input[type="checkbox"]').first()).toBeChecked();
```

---

## 2. 사용중인 아이콘 (N개) — `.icon-card`
> 설명: "현재 관제 화면에 적용되는 아이콘 목록입니다. 우측 X 버튼으로 빠르게 제외할 수 있습니다."
> ⚠️ 개수는 데이터 의존(검증일 현재 12개) → 고정 count 금지, `≥1`로 검증.

| 요소 | Locator | 비고 |
|------|---------|------|
| 섹션 타이틀 | `.sub-title-box`("사용중인 아이콘") | "(N개)" 카운트 동반 |
| 아이콘 카드 | `.icon-card` (≥1) | `.icon-card-img` + `.icon-card-title` |
| 카드 제외(✕) | `.icon-card-x` | ⚠️ **비파괴** — 클릭 시 실제 제외, 노출·활성 검증만 |
| 아이콘명 입력 | `.icon-card-input` (text) | ⚠️ **"아이콘 관리" 토글 ON 시에만 렌더**. OFF면 미존재(읽기전용) |
| 아이콘명 표시 | `.icon-card-title` | 토글 OFF 시 읽기전용 노출(VIP3/첫팀/막팀/셀프/2인/3인/5인/작업/마샬/9홀 추가/교육/단체/주의 등) |
| 저장 | 섹션 스코프 `getByRole('button', { name: '저장' })` | ⚠️ 섹션 2·3 중복 → 스코프 필수. **토글 OFF 시 노출되나 비활성(disabled)**, ON 시 활성 |

```typescript
// 특정 아이콘 카드 (제목 스코프)
const vip = page.locator('.icon-card').filter({ hasText: 'VIP' });
await expect(vip.locator('.icon-card-x')).toBeVisible();   // ✕ 노출만 검증(비파괴)
// 아이콘명 입력
await page.getByPlaceholder('VIP').fill('VIP 고객');
```

---

## 3. 코스별 아이콘 색상
| 요소 | Locator | 비고 |
|------|---------|------|
| 테이블 | `headers: 코스 / 아이콘 색상` (rowCount 3) | South / East / West |
| 색상 변경 ×3 | 코스 행 스코프 `getByRole('button', { name: '변경' })` | `.button-common.negative.xxsmall` |
| 저장 | 섹션 스코프 `getByRole('button', { name: '저장' })` | |

```typescript
const south = page.locator('tr').filter({ hasText: 'South' });
await south.getByRole('button', { name: '변경' }).click();
```

---

## 4. 코스별 그늘집 위치
| 요소 | Locator | 비고 |
|------|---------|------|
| 테이블 | `headers: 코스 / 그늘집 위치` (rowCount 3) | South / East / West, 홀 1~9 |
| 홀 체크박스 | `#cb1` ~ `#cb27` (`.check-item`) | 9홀 × 3코스 = 27개, 고정 ID(사용 가능) |
| (관련 토글) | ⚠️ `#tgv-1-2` 금지(동적채번) | |

```typescript
// 코스 행 스코프 권장 (cb 번호 직접 의존 대신)
const east = page.locator('tr').filter({ hasText: 'East' });
await east.locator('.check-item').nth(2).check();   // East 3번 홀
```

---

## 공통 패턴 & ⚠️ 주의

| 요소 | Selector |
|------|----------|
| 섹션 타이틀 | `.sub-title-box.align-items-start` |
| 적용/저장 | `.button-common.primary` (관제적용/저장) |
| 변경 | `.button-common.negative` |
| 아이콘 카드 | `.icon-card` / `.icon-card-x` / `.icon-card-title` / `.icon-card-input` |
| 코스 테이블 | `.table-overflow-item` (코스 South/East/West) |
| 체크박스(홀) | `.check-item` (`#cb1`~`#cb27`) |

- ⚠️ **`#tgv-1-0/1/2` 동적채번** — SPA 네비게이션마다 N 증가. `홀별정산관리`와 동일 이슈, **절대 id 의존 금지** → 기능명 텍스트로 행 스코프 후 `label` 클릭.
- ⚠️ **`저장` 2개 / `변경` 3개 중복** — 반드시 섹션·행 스코프.
- ⚠️ **✕ / 저장은 파괴적 동작** — 노출·활성 검증만 (비파괴 원칙, `카트관리`와 동일). (관제적용 버튼은 2026-06-04 리뉴얼로 제거됨)
- `#cb1~#cb27`은 고정 ID지만 9×3 매핑 가독성 위해 코스 행 스코프 권장.
- SNB/2뎁스 토글(`snb-toggle__switchbtn`, `depth-2-toggle__switchbtn1~12`)은 네비게이션 공통 요소 — 본 화면 검증 대상 아님.
