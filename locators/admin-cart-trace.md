# 관제관리 > 카트 이동경로 확인 (리뉴얼 td17) - UI 요소 & Locator

> URL: `/club/page/live-cart-trace` / 클럽: 킹즈락
> 분석일: 2026-06-04 (`analysis/관제관리_카트_이동경로_확인.json` 기준)
> IA 스코프: 관제 관리 하위 — **진입 가능(구현)**. 드라이브 상세 TC 미작성 → **구조 기반 제한 검증**
> 성격: **카트 이동경로 재생(replay)·추적 지도 도구** (관제팝업류 모니터링 도구와 유사). 지도/SVG/슬라이더 인터랙션은 검증 제외.
> ⚠️ 헤더 GNB = `관제 어드민`(리뉴얼). 어드민 도달 판정은 URL+SNB.

---

## 🔴 화면 차원 이슈 (기획-구현 차이로 기록)
- **UI 전체 미한글화**: `Ok` / `Clear` / `Prev` / `Next` / `Auto Start` / `Auto Stop` / `Caddie` 등 **영문 노출**. 타 리뉴얼 화면은 한글 → 미한글화(미완성/개발도구 의심).
- **날짜 형식 불일치**: 조회일 placeholder `YYYY-MM-DD`(대시) — 타 화면은 `YYYY.MM.DD`(점).
- **vue-select 라벨 미설정**: 드롭다운 placeholder가 `---`, `null`.

---

## 1. 필터 (조회 조건)
| 요소 | Locator | 비고 |
|------|---------|------|
| 조회일 | `.datepicker-input` (ph `YYYY-MM-DD`) | 🔴 대시 형식 |
| 캐디 선택 | `.vs__search`(ph `Caddie`) / `.vs__dropdown-toggle` | vue-select. 🔴 영문 placeholder |
| 기타 드롭다운 ×2 | `.vs__search`(ph `---`, `null`) | 라벨 미설정 |

---

## 2. 지도 영역
| 요소 | Locator | 비고 |
|------|---------|------|
| 지도 컨테이너 | `.map-box` | 홀 번호 마커(1~20, 55~57) 포함 |
| 경로/마커 SVG | `svg` (×4) | 경로 시각화 — **렌더 상호작용 검증 제외**, 존재만 |

---

## 3. 재생 컨트롤 (`.contents-box`)
> 박스 텍스트: "0.1 / Ok / Clear / Prev / Next / Auto Start / Auto Stop"
> ⚠️ **비파괴**: 재생 컨트롤은 클릭 시 재생/상태 변경 → **노출만 검증, 클릭 금지**.

| 요소 | Locator | 비고 |
|------|---------|------|
| 속도값 | 텍스트 `0.1` (재생 배속 추정) | |
| Ok | `getByRole('button',{name:'Ok'})` / `.button-common.primary` | |
| Clear | `getByRole('button',{name:'Clear'})` / `.button-common.negative` | |
| Prev / Next | `getByRole('button',{name:'Prev'\|'Next'})` | |
| Auto Start / Auto Stop | `getByRole('button',{name:'Auto Start'\|'Auto Stop'})` | |

---

## 4. 재생 상태 표시
| 요소 | Locator | 비고 |
|------|---------|------|
| 재생 슬라이더 | `.path-slider` (input[type=range]) | 경로 위치 — 조작 검증 제외, 노출만 |
| 슬라이더 값 | `.slider-val-box` (현재 "-") | |
| 시각 | `.time-box` (현재 "-") | |
| 가속/정확도 | `.acc-box` (현재 "-") | |

---

## 검증 항목 (CARTTRACE-01~) — 구조 기반 제한 (`runCartTrace`)
| ID | 항목 | 검증 |
|----|------|------|
| CARTTRACE-01 | 조회일 datepicker 노출 | `.datepicker-input` visible |
| CARTTRACE-02 | 캐디/조건 vue-select 노출(≥1) | `.vs__dropdown-toggle` ≥1 |
| CARTTRACE-03 | 지도 컨테이너(`.map-box`) 노출 | visible |
| CARTTRACE-04 | 재생 컨트롤 버튼 노출(Ok/Clear/Prev/Next/Auto Start/Auto Stop) | 6개 visible(클릭 금지·비파괴) |
| CARTTRACE-05 | 재생 슬라이더(`.path-slider`) 노출 | visible |
| CARTTRACE-06 | 재생 상태 박스(slider-val/time/acc) 노출 | visible |
| (차이) | 영문 미한글화 / 날짜형식 YYYY-MM-DD | `diff()` → 기획-구현 차이 |

> ⚠️ 데이터 의존(홀 마커·SVG 경로·캐디 목록)은 존재(`≥1`)로만 검증, 고정값 금지.
