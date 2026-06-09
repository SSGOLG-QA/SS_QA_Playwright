# 내장 통계 (리뉴얼) - UI 요소 & TC 매핑 & Locator

> 사이트: https://td17.smartscore.kr/club/page/round-visit-statistics
> 메뉴: 라운드관리 > 내장 통계 / TC #18~53 (36개)
> 분석일: 2026-05-29

---

## UI 요소 & Locator

### 1. 설명 영역
| 요소 | Locator |
|------|---------|
| 안내 문구 | `page.locator('.info-box-text')` ("스마트스코어 회원이 내장하여...타겟마케팅") |
| 데이터 마케팅 바로가기 | `page.getByRole('button', { name: '데이터 마케팅 바로가기' })` (`.button-common.negative`) |

### 2. 검색(조회기간) 영역
| 요소 | Locator | 비고 |
|------|---------|------|
| 시작일 | `page.locator('.datepicker-input').first()` | ph `YYYY.MM.DD` |
| 종료일 | `page.locator('.datepicker-input').nth(1)` | |
| 초기화 | `page.getByRole('button', { name: '초기화' })` | |
| 조회 | `page.getByRole('button', { name: '조회' })` | ⚠️ TC는 [적용] |

### 3. 카드 요약 (3개)
```typescript
const cards = page.locator('.summary-card');   // label/value/days
```
| 카드 | label | value 예시 | days |
|------|-------|-----------|------|
| 1 | 총 스스회원 내장객 | 11명 | 조회기간 기준 합계 |
| 2 | 일평균 스스 회원수 | 0명 | **90일 평균** |
| 3 | 남성/여성 비중 | 67%/ 33% | 스스 회원 기준 |

```typescript
page.locator('.summary-card').filter({ hasText: '총 스스회원 내장객' }).locator('.summary-card__value')
```

### 4. 필터 버튼 (탭)
| 버튼 | Locator | 비고 |
|------|---------|------|
| 전체보기 | `page.getByRole('button', { name: '전체보기' })` | 기본 활성(`.primary`) |
| 성별만 보기 | `page.getByRole('button', { name: '성별만 보기' })` | |
| 연령만 보기 | `page.getByRole('button', { name: '연령만 보기' })` | ⚠️ TC는 [연령별만 보기] |

> 활성 버튼은 `.button-common.primary`, 비활성은 `.negative`

### 5. 일별 내장 통계 테이블
```typescript
const table = page.locator('.table-overflow-item table');   // 10행
```
**전체보기 컬럼:** 일자 / SS회원수 / 성별(남·여·기타) / 연령(~10·11~20·...·90~·기타) — 2단 헤더
- 섹션 타이틀: `.sub-title-box`("일별 내장 통계 테이블")
- 엑셀: `page.getByRole('button', { name: '엑셀파일 다운로드' })`

---

## TC ↔ 자동화 매핑 (#18~53)

| TC | 내용 | 자동화 |
|----|------|--------|
| 18,20 | 영역/설명 노출 | 🟢 |
| 20b | 데이터마케팅 → 새 탭 + 현재화면 유지 | 🟢 |
| 21,22 | 조회기간 기본값(30일)·데이트피커 | 🟢 |
| 23 | 적용/조회 → 카드·테이블 갱신 | 🟢 |
| 24~26 | 1년 경계(364/365/366→알럿) | 🟡 |
| 27 | 역순 알럿 | 🟡 (문구 미확정) |
| 28 | 초기화 → 기본값 | 🟢 |
| 29~33 | 카드 3종 + 계산식 | 🟢(노출)/🟡(계산값) |
| 34 | 성별 미입력 제외 | 🔴 데이터 |
| 35~39 | 필터 3버튼 + 탭전환 컬럼변경 + 값유지 | 🟢 |
| 40 | 테이블 안내 문구 | 🟢 |
| 41~48 | 컬럼 + 합산검증 | 🟢(컬럼)/🟡(합산) |
| 49 | no result 문구("통계 데이터가 없습니다") | 🟡 데이터 |
| 50~53 | 내보내기(탭별 컬럼) | 🟡 다운로드 |

**🟢 ~18 / 🟡 ~14 / 🔴 ~2**

---

## ⚠️ QA 발견 후보
| # | TC 기대 | 실제 td17 |
|---|---------|-----------|
| 1 | 검색 버튼 [적용] | **[조회]** |
| 2 | 필터 [연령별만 보기] | **[연령만 보기]** |
| 3 | 일평균 `n일 평균`(조회기간 일수) | **"90일 평균"** 고정 표기 (조회 30일인데) — 결함 후보 |
| 4 | [내보내기] | [엑셀파일 다운로드] |
