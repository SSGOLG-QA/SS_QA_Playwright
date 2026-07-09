# 핸드오버 — 단체 라운드 스코어/결과집계 팝업 데이터 정합성 (2026-06-29)

> durable 상세는 `CLAUDE.md`(완료 항목 — 단체 라운드) + `locators/admin-round-group.md`에 반영됨. 이 문서는 인수인계 요약.
> 이전 핸드오버(06-26, 단체 라운드 자동화 + 인프라 버그)는 git 이력 참조.

## 1. 이번 작업 — 단체 라운드 팝업 노출 + 데이터 정합성 (GRND-11~18)
사용자 요청: ① 버튼 선택하여 팝업 노출 및 내용 확인 ② 스코어·결과집계/출력 팝업 내 데이터 정합성(점수·순위) 검증.

### A. 라이브 프로브로 팝업 구조 확정
- **스코어·결과집계 [보기]는 모달이 아니라 같은 컨텍스트 새 탭 풀페이지**(`window.open`):
  - 스코어 → `/club/RoundGroupScore/{id}` (스코어카드: Player·Tee·Course·전반홀1~9·전반·후반홀1~9·후반·합계·오버타수 합계)
  - 결과집계/출력 → `/club/RoundGroupRank/{id}` (순위표 + 시상내역 + Team Average)
- **셀 인덱스 재확정**(라이브): 스코어=**td8** / 진행상황=**td9**(버튼 없는 상태 텍스트 `라운드종료`/`경기중`) / 결과집계출력=**td10**.
- 진단 프로브 보존: `Admin/_probe-group-round-newtab.spec.ts`(새 탭 내용 덤프).

### B. 데이터 정합성 불변식 구현 (신규 `lib/domain/groupRound.ts`)
- 순수 함수: `groupScoreInvariants`·`rankOrderInvariants`·`teamAvgInvariants`·`inferPar`·`mean`·`round1`.
- 글루: `runGroupRoundPopups(admin, tableBox, rowN)`(`lib/suites.ts`) — `runGroupRound` 말미(GRND-10 뒤)에서 호출 → all-suite 자동 포함.
- 검증(`verifyInvariants` 재사용, tcRef 네임스페이스 `_SC`/`_RK`/`_AVG`로 GRND-01~10과 충돌 회피):
  - **스코어(GRND-13)**: 합계=전반+후반 / 합계−오버타수=Par(전원 일정, 킹즈락 72) / 합계≥0
  - **순위(GRND-15)**: 순위 1..N 연속 / 스코어 단조(상위=저타수, 좋은순)
  - **Team Average(GRND-16)**: 전체·남자·여자 평균 = mean(스코어) (소수1자리 반올림)
  - **시상(GRND-17)**: 최우수상 점수 = 최저 스코어 = 1위
  - **교차정합(GRND-18)**: 결과집계 순위표 스코어 = 스코어 팝업 합계(이름 조인)
- **비파괴**: 새 탭 열어 읽기만→닫기. 팝업 내 [수정하기]/[스코어 수정]/[상세 스코어 추가]/[인쇄] 절대 클릭 금지. 데이터 의존(라운드종료 행 우선·없으면 SKIP).

### C. 드리프트 반영 (13→14컬럼)
- 단체 리스트 테이블에 **'태블릿리더보드'(td3, ON/OFF) 컬럼 신설** → GRND-05 HEADERS 14컬럼으로 AS-IS 갱신 + `diff` 추적.

## 2. 현재 상태 (검증 완료)
- `Admin/group-round.spec.ts` **PASS 23/23**(GRND-01~18 + DATESEARCH, 21.7s). 정합성은 실데이터(스코어 4행·순위 4명)로 실제 수행(SKIP 아님).
- 실측 예: 여2 전반38+후반42=합계80, 오버8 → 80−8=72(Par). Team Avg 전체92.8=(80+83+99+109)/4, 남104, 여81.5. 순위 80<83<99<109.
- `npm run typecheck` **0 에러**.
- 리포트: `reports/group-round_report_2026-06-29T07-29-23.xlsx`.
- 인증 세션 유효(06-29 기준). 만료 시 `npm run auth`.

## 3. ⚠️ 인수자 주의
- **td7 그룹편집/핸디관리는 파괴적** — [설정] 클릭 시 그룹 삭제 confirm(`여성팀그룹을 삭제하시겠습니까?`)까지 도달 가능. **절대 클릭 금지**(노출만). 프로브 작성 중 취소(비파괴)로 확인함.
- 스코어/결과집계 팝업 정합성은 **라운드종료(데이터 완비) 행** 기준. 데이터 없거나 새 탭 미발생(window.open 차단) 시 해당 GRND `skip`(가짜 FAIL 방지).
- 순위표 컬럼 추출은 **content 휴리스틱**(td0=순위, 첫 4칸 중 M/F=성별, 그 다음=이름·스코어) — thead가 다단 헤더라 flat 인덱스 정렬이 불안정해서 채택. 데이터 레이아웃 크게 바뀌면 재확인 필요.
- 커밋 전 `npm run typecheck` 권장(`--list`는 transpile-only라 미임포트 못 잡음).
- 단일 계정 직렬 — 동시 실행 금지(중복 로그인 강제 로그아웃). 진입 플레이크 시 재실행(스크립트 값 오류 아님).

## 4. 다음 후보 (미착수)
- 단체팀 고도화(등록·설정·복사·그룹편집/핸디관리·시상내역 편집) — **별도 프로젝트로 잔존**(현재 노출만).
- [랭킹다운]/[스코어다운] **단체 선택 후 다운로드 실동작** 검증(선택 게이트 UI 메커니즘 파악 필요).
- 스코어 팝업 [총타수 표시↔오버타수 표시] 토글·[스코어순(좋은순)] 정렬 전환 후 재검증(현재 기본 뷰만).
- 홀별(1~9) 스코어 입력 완비 데이터 확보 시 `sum(홀) = 전반/후반` 홀 단위 정합성 추가.

## 5. 신규/변경 핵심 파일
- **신규**: `lib/domain/groupRound.ts`, `Admin/_probe-group-round-newtab.spec.ts`(진단)
- **변경**: `lib/suites.ts`(runGroupRoundPopups + GRND-05 14컬럼/drift + Locator import), `locators/admin-round-group.md`(셀 매핑표·팝업 구조·GRND-11~18), `CLAUDE.md`
