# 결함 후보: 작업 관리 > 작업 지시 — JS 런타임 예외

> ⚠️ **자동 생성 후보(사람 검토 필요)** · Course/ 스펙에 자동 merge 금지 · 세션 내 2회 재현 확인분.
> 원천: AI Exploratory Agent 탐색(비파괴). Finding `F001` · 생성 2026-09-16T06:58:07.134Z

| 항목 | 내용 |
|---|---|
| **Title** | 작업 관리 > 작업 지시 [보기] JS 런타임 예외 |
| **Feature** | 작업 관리 > 작업 지시 |
| **Rule** | `runtime-error` |
| **Risk(심각도)** | 높음(ANOMALY) |
| **ReproCount** | 2/2 (세션 내 재로그인 없이) |
| **연관 Jira** | (직접 연관 없음 — 과거결함 라벨 매칭 0) |

## Precondition
- 코스관리 PC(course-mng-td · 킹즈락) 로그인 세션(storageState) 유효.
- `작업 관리 > 작업 지시` 메뉴 진입 가능(gotoCourseMenu). 리스트/폼 기본 로드 완료.

## Sequence (재현 절차)
1. 작업 관리 > 작업 지시 진입
2. [보기] (modal)

## Expected
트리거 실행 시 콘솔/페이지 JS 예외 없이 대상(모달/상세)이 정상 렌더되어야 한다.

## Actual
- 전이 중 JS예외/5xx 발생 — [보기]
- **Evidence**: JS예외: Cannot set properties of undefined (setting 'isError')

## ReproDetail (2회 재실행)
1회: 재현(런타임 console 0·pageerr 1·4xx 0·5xx 0·reqfail 0·dialog 0 · JS예외: Cannot set properties of undefined (setting 'isError')) · 2회: 재현(런타임 console 0·pageerr 1·4xx 0·5xx 0·reqfail 0·dialog 0 · JS예외: Cannot set properties of undefined (setting 'isError'))

## Console / Runtime
```
JS예외: Cannot set properties of undefined (setting 'isError')
```

## Screenshot
(미수집)

## 추천 Regression Test
작업 관리 > 작업 지시 진입 → [보기] 클릭 → page.on('pageerror') 및 console error 수집이 0건임을 assert.

---
_이 후보는 탐색 산출물이며 검증 스펙이 아님. QA 검토 후 `Course/*.spec.ts`로 승격._
