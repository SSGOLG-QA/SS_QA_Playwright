# 결함 후보: 장비 관리 > 장비 총괄 — 모달 표준 닫기 불가(하드내비 필요)

> ⚠️ **자동 생성 후보(사람 검토 필요)** · Course/ 스펙에 자동 merge 금지 · 세션 내 2회 재현 확인분.
> 원천: AI Exploratory Agent 탐색(비파괴). Finding `F002` · 생성 2026-09-16T06:58:07.136Z

| 항목 | 내용 |
|---|---|
| **Title** | 장비 관리 > 장비 총괄 [장비등록] 모달 표준 닫기 불가(하드내비 필요) |
| **Feature** | 장비 관리 > 장비 총괄 |
| **Rule** | `modal-not-closeable` |
| **Risk(심각도)** | 중간(NEEDS_REVIEW) |
| **ReproCount** | 2/2 (세션 내 재로그인 없이) |
| **연관 Jira** | [QA-15338](https://smartscoretech.atlassian.net/browse/QA-15338), [QA-15491](https://smartscoretech.atlassian.net/browse/QA-15491), [QA-15507](https://smartscoretech.atlassian.net/browse/QA-15507) |

## Precondition
- 코스관리 PC(course-mng-td · 킹즈락) 로그인 세션(storageState) 유효.
- `장비 관리 > 장비 총괄` 메뉴 진입 가능(gotoCourseMenu). 리스트/폼 기본 로드 완료.

## Sequence (재현 절차)
1. 장비 관리 > 장비 총괄 진입
2. [장비등록] 열기
3. 닫기 시도(취소/X/Escape) 실패

## Expected
모달은 표준 닫기(취소/닫기/X/Escape)로 닫혀야 하며 하드내비 없이 원 화면으로 복귀해야 한다.

## Actual
- [장비등록] 모달이 표준 닫기(취소/닫기/X/Escape/확인)로 안 닫힘 — 하드내비로만 복구
- **Evidence**: 표준 닫기(취소/X/Escape/확인) 실패 → page.goto 하드내비로만 복구

## ReproDetail (2회 재실행)
1회: 재현(kind=modal · 표준닫기후 모달잔존=true) · 2회: 재현(kind=modal · 표준닫기후 모달잔존=true)

## Console / Runtime
(런타임 이상 규칙 아님 — 콘솔 로그 N/A)

## Screenshot
(미수집)

## 추천 Regression Test
장비 관리 > 장비 총괄 진입 → [장비등록] 모달 열기 → 취소/Escape → expect(모달 미노출) & 하드내비 불필요 assert.

---
_이 후보는 탐색 산출물이며 검증 스펙이 아님. QA 검토 후 `Course/*.spec.ts`로 승격._
