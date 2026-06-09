# 관제관리 > 라이브채팅 공지 조회 (리뉴얼 td17) - UI 요소 & Locator

> URL: `/club/page/control-live-chat` / 클럽: 킹즈락
> 분석일: 2026-06-04 (`analysis/관제관리_라이브채팅_공지_조회.json` 기준)
> IA 스코프: 관제 관리 하위 — **진입 가능(구현)**. 드라이브 상세 TC 미작성 → **구조 기반 검증**(카트·아이콘 방식)
> ⚠️ 헤더 GNB = **`관제 어드민`**(리뉴얼). 어드민 도달 판정은 헤더 텍스트 대신 URL(`/club/`)+SNB(`.depth-1-title`).

---

## 화면 구성 (3영역)
1. **안내문구** (`.info-box-text`)
2. **검색 영역** (`.contents-box` — 조회일/공지내용 + 초기화·적용)
3. **결과 영역** (`.message-box` — 날짜그룹 + 시각 + 공지내용, **테이블 아님**)

---

## 1. 안내문구
| 요소 | Locator | 비고 |
|------|---------|------|
| 안내문구 | `.info-box-text` | checkText **원문 일치** 대상 |

> 원문: **"라이브채팅의 공지사항 기록을 조회할 수 있습니다. 단, 한달 이내의 공지사항만 보관됩니다."**
> ⚠️ "한달"(붙여쓰기) 원문 그대로 보존 — 검증 시 임의로 '한 달'로 바꾸지 말 것.

---

## 2. 검색 영역 (`.contents-box` 검색폼) — 2026-06-04 probe로 확정
| 요소 | Locator | 비고 |
|------|---------|------|
| 조회일 | `.datepicker-input` (ph `YYYY.MM.DD`) | **단일 1개**(기간 아님). `.datepicker-wrap` 내 label "조회일" + `.ico-calendar` |
| 공지내용 검색 | `.search-type` (ph `공지내용을 입력하세요`) | `.text-field-wrap` 내, `.ico-search` 버튼 동반. **getByPlaceholder('공지내용을 입력하세요')로 기능 식별** |
| 초기화 | `getByRole('button',{name:'초기화'})` / `.button-common.negative.xxsmall` | |
| 적용(조회) | `getByRole('button',{name:'적용'})` / `.button-common.primary.xxsmall` | 읽기(조회) 동작 — 클릭 가능(비파괴) |

> 🔴 **`출력률` = 라벨 오표기 확정**: 공지내용 검색 필드(`.search-type`, ph "공지내용을 입력하세요")의 `<label>`이 **"출력률"** 로 표기됨. 기능은 정상(공지내용 검색)이나 라벨이 무관한 "출력률"(print rate) → **라벨 오류 의심**. 기능 정상이므로 검증은 placeholder 기준 PASS + **기획-구현 차이 시트에 라벨 오류로 기록**(QA 확인 요망).

---

## 3. 결과 영역 (`.message-box`) — 채팅 버블형, probe로 확정
- **테이블 아님**(`tables: []`) → `.message-box` > `.item-content`(×N) 메시지 버블 리스트.
- 각 `.item-content` 구조:
  - `.item-date` — 날짜 그룹 헤더(그룹 첫 항목에만, 예 "2026.05.05(화)")
  - `.message-right` > `.msg-message-right`(공지내용) + `.msg-message-date`(시각 "16:34")

| 요소 | Locator | 비고 |
|------|---------|------|
| 결과 컨테이너 | `.message-box` | 데이터 의존 — 존재 또는 빈상태 |
| 메시지 항목 | `.message-box .item-content` (≥0) | 고정 count 금지 |
| 날짜 그룹 헤더 | `.item-content .item-date` | 그룹 첫 항목에만 노출 |
| 공지내용 | `.item-content .msg-message-right` | |
| 시각 | `.item-content .msg-message-date` (HH:mm) | |

> ⚠️ "한달 이내만 보관" → 과거 날짜 조회 시 결과 없음 가능 → **`≥0`/빈상태 허용**(고정 count 금지).

---

## 비파괴 / ⚠️ 주의
- `[적용]`/`[초기화]`는 **조회(읽기)** 동작 — 데이터 변경 아니므로 클릭 가능. 단 조회 검증은 **날짜만 채우고 적용** → 결과/빈상태 확인.
- 결과 건수·날짜는 **데이터 의존** → `≥1`/빈상태로 검증(고정값 금지).
- SNB/2뎁스 토글(`snb-toggle__switchbtn`, `depth-2-toggle__switchbtn1~12`)은 네비게이션 공통 chrome — 본 화면 검증 대상 아님.

---

## 검증 항목 (LIVECHAT-01~06) — 구조 기반 (`runLiveChatNotice`)
| ID | 항목 | 검증 |
|----|------|------|
| LIVECHAT-01 | 안내문구 원문 일치 | `checkText(.info-box-text)` |
| LIVECHAT-02 | 조회일 datepicker 노출 | `searchBox .datepicker-input` visible |
| LIVECHAT-03 | 공지내용 검색 input 노출 | `getByPlaceholder('공지내용을 입력하세요')` visible |
| LIVECHAT-04 | 초기화/적용 버튼 노출 | 두 버튼 visible(검색박스 스코프) |
| LIVECHAT-05 | 결과 영역(`.message-box`) 노출 | container visible |
| LIVECHAT-06 | 메시지 항목 구조(내용+시각) | `.msg-message-right` + `.msg-message-date` (데이터 無 시 SKIP) |
| (차이) | 검색 필드 라벨 `출력률` 오표기 | `diff()` → 기획-구현 차이 |

> ✅ probe(2026-06-04)로 `출력률`(라벨 오류)·datepicker(1개)·결과 항목 구조 모두 확정 완료.
