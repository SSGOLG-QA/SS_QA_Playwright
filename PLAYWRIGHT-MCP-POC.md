# Playwright MCP PoC — 드리프트 탐색·스펙 드래프트 가속 (선작성)

> **상태: 선작성(dormant). 계정 풀(`ACCOUNT_COUNT`) 확보 후 라이브 실증 예정.**
> 적용 범위 판단: MCP = "탐색·드리프트 프로브 + 스펙 드래프트" **가속기**. 회귀 실행·exceljs 리포트·계산 정합성·비파괴 규율은 **기존 harness가 계속 핵심**(MCP가 대체하지 않음).

## 무엇인가
`@playwright/mcp`(Microsoft)는 LLM(Claude Code)이 **라이브 브라우저를 직접 구동**(navigate/click/snapshot)하게 하는 MCP 서버다. 회귀 스위트 생성기가 아니라 **실시간 탐색 도구**. 우리 워크플로의 throwaway `Admin/_probe-*.spec.ts`(현재 UI 덤프용 일회성 스펙) 왕복을 라이브 탐색으로 대체하는 것이 1차 실익.

## 선결조건 (라이브 실증 전 필수)
1. **전용 탐색 계정 1개** — 기본 storageState = `auth/.auth/admin-1.json`(계정 풀 인덱스 1). MCP 브라우저는 또 하나의 라이브 세션이라, **테스트 세션과 같은 계정이면 중복 로그인 강제 로그아웃**이 발생한다. 계정 풀(`$env:ACCOUNT_COUNT="N"; npm run auth`)로 `admin-1.json`을 만든 뒤 사용.
2. **세션 유효** — `admin-1.json`은 수일 내 만료 → 만료 시 재인증.
3. (옵션) 계정 풀 없이 오늘 당장 한 번 시험하려면: `PW_MCP_STORAGE=auth/.auth/admin.json` 로 계정0을 가리키게 한다. **단 그 시각엔 같은 계정으로 어떤 테스트도 실행 금지**(중복 로그인 충돌).

> ⚠️ `admin-1.json`이 없으면 MCP 서버는 기동하지 못한다(의도된 dormant 상태). 계정 확보 시 자동 활성.

## 설정 근거 (`.mcp.json` 플래그)
| 플래그 | 이유 |
|---|---|
| `--storage-state=${PW_MCP_STORAGE:-auth/.auth/admin-1.json}` | 저장 세션 로드 → 로그인 브리지 생략하고 `/club/page/...` 직행(`--no-deps` 스펙과 동일). 기본=전용 계정, env로 override 가능 |
| `--isolated` | 세션을 메모리에만 시드(파일에 안 씀) → storageState 파일 **비파괴**, 매 기동 클린 상태 |
| `--allowed-origins=td17;sv1td4` | td17/대시보드 외 이동 차단(가드레일). ⚠ 사이트 **내부** 클릭(저장/삭제)은 못 막음 → 비파괴는 에이전트 규율로 보장 |
| `--save-trace` + `--output-dir=./mcp-out` | 탐색 trace 보존(`mcp-out/`, gitignore됨) |
| `--viewport-size=1920,1080` | 어드민이 최대화 전제 → 기본 1280×720 클리핑 방지 |

## 사용 시나리오 (1차 PoC = 드리프트 1메뉴)
1. Claude Code 재시작 → `playwright` MCP 서버 인식.
2. 자연어: "관제관리 > 아이콘 관리 열고 현재 라벨·요소 스냅샷 떠줘" → Claude가 라이브 구동·snapshot.
3. Claude가 기대값(suite)과 대조 → **AS-IS diff 초안** 제시.
4. 확정된 변경은 **결정적 스펙으로 결정화 → 기존 harness 실행 → exceljs 리포트**(산출물은 그대로).

## 경계 (MCP가 하지 않는 것)
- 구조화 PASS/FAIL/diff/IA 리포트 생성 ✗ (harness 담당)
- 계산 정합성 오라클(독립 재계산) ✗
- 비파괴 강제 ✗ (도메인 제한만, 클릭 규율은 에이전트)
- 결정적 회귀(비결정·고비용) ✗ → 탐색/초안 전용

## 관련
- 병렬 계정 풀: [CLAUDE.md](CLAUDE.md) "병렬 실행(계정 풀)" + `playwright.config.ts`(`ACCOUNT_COUNT`/`accountStorage`).
- 드리프트 워크플로: CLAUDE.md "드리프트 검출 워크플로" — MCP가 probe 스펙 단계를 대체/보완.
