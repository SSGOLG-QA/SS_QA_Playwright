# 전체 라운드 (리뉴얼 td17) - UI 요소 & TC 매핑 & Locator

> 사이트: https://td17.smartscore.kr/club/page/round-all
> 메뉴: 라운드관리 > 전체라운드 / TC #54~167
> 분석일: 2026-05-29
> ⚠️ 구버전(`/ss/admin/rounding.html`, admin-rounding.md)과 완전히 다름. 본 문서가 td17 리뉴얼 기준

---

## 구버전 대비 핵심 차이 (개선됨 — 자동화 유리)

| 항목 | 구버전(td30) | 리뉴얼(td17) |
|------|-------------|--------------|
| 검색 input | `name` 속성만 | **placeholder 보유** (`내장객 입력` 등) → getByPlaceholder |
| 검색 버튼 | [검색]/[Clear] | **[적용]/[초기화]** (TC와 일치) |
| 행 액션 | `javascript:함수()` href | **버튼 텍스트** (스코어/삭제/보내기/클럽체크...) |
| 테이블 컬럼 | 14개 | **15개** (확인서 3종·캐디수첩 분리) |

---

## UI 요소 & Locator

### 1. 설명 영역
| 요소 | Locator |
|------|---------|
| 안내 문구 | `.info-box-text` ("태블릿에서 전송된 골프장의 모든 라운드가 기록되며...") |

### 2. 검색 영역 (placeholder 기반 — 1순위)
| 요소 | Locator |
|------|---------|
| 시작일 | `page.locator('.datepicker-input').first()` (ph `YYYY-MM-DD`) |
| 종료일 | `page.locator('.datepicker-input').nth(1)` |
| 내장객 | `page.getByPlaceholder('내장객 입력')` |
| 캐디명 | `page.getByPlaceholder('캐디명 입력')` |
| 디바이스 | `page.getByPlaceholder('디바이스 입력')` |
| 단체팀 | `page.getByPlaceholder('단체팀 입력')` |
| 카트번호 | `page.getByPlaceholder('카트번호 입력')` |
| 초기화 | `page.getByRole('button', { name: '초기화' })` |
| 적용 | `page.getByRole('button', { name: '적용' })` |

### 3. 결과 테이블
```typescript
const table = page.locator('.table-overflow-item table');   // 20행
const rows = table.locator('tbody tr');
```
**컬럼 (15개):** 순번 / 날짜·디바이스 / 티타임·R/N / 코스 / 캐디(카트) / 진행시간 / 내장객 / 단체명 / 스코어카드 / 사진/동영상 / 클럽체크 / 중대재해확인서 / 추가확인서 / 카트확인서 / 캐디수첩
- 총 건수: `page.getByText(/총 \d+건/)` ("총 245건")

### 4. 행별 액션 버튼 (텍스트 기반 + 행 스코프)
| 버튼 | Locator (행 스코프) | class |
|------|---------------------|-------|
| 스코어 | `row.getByRole('button', { name: '스코어' })` | `.button-outline-primary` |
| 삭제 | `row.getByRole('button', { name: '삭제' })` | `.button-outline-danger` |
| 보내기 | `row.getByRole('button', { name: '보내기' })` | `.button-outline-primary` |
| 클럽체크 | `row.getByRole('button', { name: '클럽체크' })` | |
| 중대재해확인서 | `row.getByRole('button', { name: '중대재해확인서' })` | |
| 캐디수첩 | `row.getByRole('button', { name: '캐디수첩' })` | |

```typescript
// ⚠️ 행마다 반복 → 반드시 행 스코프
const firstRow = page.locator('.table-overflow-item table tbody tr').first();
await firstRow.getByRole('button', { name: '스코어' }).click();
```

### 5. 페이지네이션 / 기타
| 요소 | Locator |
|------|---------|
| 현재 페이지 | `.active` |
| 페이지 이동 | 숫자 버튼 / `.ellipsis`(…) |
| 툴팁 닫기 | `.rnd-tooltip-close` (✕) |

---

## TC ↔ 자동화 매핑 (요약, #54~167)

| 그룹 | TC | 자동화 |
|------|-----|--------|
| 영역/문구/컬럼 노출 | 54~56,75~80 | 🟢 |
| 검색(조회일·5필드·복합·초기화) | 57~72 | 🟢 (placeholder 기반) |
| 조회일 경계/역순 | 61~64 | 🟡 |
| 진행시간·내장객·단체명 수정 팝업 | 87~97 | 🟢 |
| 스코어/삭제/Live 버튼 | 98~101 | 🟢(노출)/🟡(삭제 데이터영향) |
| 스코어카드 레이어팝업 상세 | 102~141 | 🟡 데이터의존 |
| 사진/확인서/캐디수첩 | 143~165 | 🟡 데이터의존 |
| 취소선/색상 | 166~167 | 🟢 CSS |

> 구버전 대비 **검색·행액션이 placeholder/버튼텍스트**라 🟢 비중 증가

---

## ⚠️ TC vs 실제 (리뉴얼) 차이
| 항목 | TC 문서 | 실제 td17 |
|------|---------|-----------|
| 컬럼 | 17개 (클럽사진·배터리잔량·배터리경고 포함) | **15개** (사진/동영상 통합, 배터리 컬럼 미확인) |
| 사진 | 사진 + 클럽사진 분리 | **사진/동영상** 통합 |
| 클럽사진 | 별도 컬럼 | **클럽체크** (명칭) |

> 배터리 잔량/경고 컬럼은 이 환경에서 미노출 — 가로 스크롤 끝 또는 데이터 의존 확인 필요
