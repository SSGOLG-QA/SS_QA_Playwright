# 핸드오버 — 자동화 범위 확장·개선 4종 (P4, 2026-08-05)

> durable 상세는 `CLAUDE.md`(**P4 자동화 범위 확장·개선** 섹션)에 반영됨. 이 문서는 인수인계 요약.
> 이전 핸드오버(06-29, 단체 라운드 팝업 정합성)는 git 이력 참조.

## 1. 이번 작업 — 커버리지 확장·개선 4 워크스트림
사용자 요청: "자동화 테스트 범위 확장·개선 검토" → 4개 착수(신규 메뉴보다 **검증의 깊이·층위·자동화**에 집중).

| # | 워크스트림 | 산출물 | 상태 |
|---|-----------|--------|------|
| P4-1 | **SKIP 투명화 감사** | `scripts/skipAudit.ts` + `npm run audit:skip` | ✅ 오프라인 완결·실행됨 |
| P4-2 | **API 계약 심화** | `lib/apiContract.ts` + `Admin/api-contract.spec.ts`(9화면) | ✅ 코드 완성 (실 API는 후속) |
| P4-3 | **UI 구조 드리프트 검출** | `Admin/ui-baseline.spec.ts` + `baselines/ui-structure.td17.json` | ✅ **baseline 캡처까지 완결** |
| P4-4 | **시각 회귀** | `Admin/visual-regression.spec.ts` | ✅ 코드 완성 (baseline은 CI 권장) |

전부 `npm run typecheck` 0 에러 + Playwright 수집 확인.

### 커밋 (origin/main push 완료)
- `a188cf2` 자동화 확장 4종 (SKIP·API·드리프트·시각)
- `3d1e564` UI baseline 캡처 + API/시각 단일 test 리팩터 + 라이브 발견
- (직전) `0cbae1b` MENU_LIST 누락 메뉴 3종

## 2. 라이브 실행 결과 & 2대 발견 (중요)
재인증(`npm run auth`, 수동 헤디드 로그인) 후 td17 라이브 실행에서:

### 발견 A — 세션 "재로그인 1회당 1런만 생존" (td17·td18 공통)
- 공유 QA 계정이 런 사이에 강제 로그아웃 → 다음 `openAdmin`이 로그인 페이지(`/ko/login`)로 빠짐.
- `admin` 픽스처는 **test 스코프** → test마다 재로그인. 화면당 개별 test면 **5~6 로그인 후 강제 로그아웃**(로그인 폭주).
- **대응**: api-contract·visual-regression을 **단일 test 전화면 순회**(all-suite 패턴)로 리팩터. 라이브 다중 실행은 **spec당 재인증 1회**.
- 메모: `~/.claude/.../memory/session-one-run-per-login.md`.

### 발견 B — 어드민 SPA는 부팅 시 데이터 프리페치/클라이언트 캐시
- 메뉴 진입 시 **데이터 API 네트워크가 뜨지 않음**(전 9화면 '데이터 API 0건', PASS 9/SKIP 9).
- 하네스는 **정상**(가짜 FAIL 0, 응답 없으면 깨끗이 SKIP). 진입-캡처 방식만으론 API 계약을 볼 수 없다는 아키텍처 사실.

## 3. 현재 상태
- **UI 드리프트 baseline**: `baselines/ui-structure.td17.json` — 44화면(헤더 393·버튼 238), 1회 로그인 2분. 이후 diff 모드로 라벨/컬럼/버튼 드리프트 자동 검출.
- **SKIP 감사**(오프라인): 총 79건 = LEGIT 21·ENV 8·**DATA 50**(잠재 커버리지 구멍)·OTHER 0. DATA 홀 집중처 = **대회/단체라운드 스코어·순위 불변식 20건**(채점 데이터 있을 때만 실행).
- 인증 세션: 이번 세션 종료 시점 만료 상태일 수 있음(1런당 1개). 라이브 필요 시 `npm run auth`.

## 4. ⚠️ 인수자 주의
- **라이브 스펙은 반드시 단일 test 전화면 순회**로 작성(화면당 개별 test 금지 — 로그인 폭주). 다중 baseline은 각각 앞에 `npm run auth`.
- **드리프트 diff 실행**: `npx playwright test --project=admin-chromium Admin/ui-baseline.spec.ts --no-deps`(기본 diff 모드, baseline 대비 제거=FAIL·추가=diff). baseline 갱신: `$env:UI_BASELINE="capture"` 붙여 실행.
- **API 실 검증은 후속 작업 필요**(발견 B). 캡처는 GET+POST 모두 수집하도록 이미 개선됨 — 트리거만 추가하면 됨.
- **시각 baseline은 CI 고정 러너 권장**(로컬↔CI 폰트/렌더 차이 오탐). 로컬 생성 시 `--update-snapshots`.
- 커밋 전 `npm run typecheck`(`--list`는 transpile-only라 미임포트 못 잡음).
- 원격 URL은 정식(`SS_QA_Playwright.git`)으로 갱신 완료.

## 5. 다음 후보 (미착수)
- **API refetch 트리거**(우선): `openAdmin`(부팅) 시점 startCapture로 프리페치 응답 수집, 또는 화면별 [조회]/`admin.reload()`로 refetch 유발 후 캡처(reload=비파괴). 그 뒤 discovery로 실 응답 구조 확인 → 화면별 `expectedKeys`/`countPath`/`countSel` 채우기.
- **시각 baseline CI 생성** + CI 워크플로(`playwright.yml`)에 ui-baseline·visual-regression·api-contract 편입.
- **SKIP DATA 홀 축소**: td18 채점 완료 대회 시드(파괴 가드) 확보 시 대회/단체라운드 불변식 20건을 실단언으로 전환.
- **드리프트 정기 자동화**: `npm run test:all && npm run drift:diff` + ui-baseline diff를 야간 스케줄(Windows 작업 스케줄러/CI cron).

## 6. 신규/변경 핵심 파일
- **신규**: `scripts/skipAudit.ts`, `Admin/ui-baseline.spec.ts`, `Admin/visual-regression.spec.ts`, `baselines/ui-structure.td17.json`
- **변경**: `lib/apiContract.ts`(GET+POST 수집·에러 envelope·fallbackAny), `Admin/api-contract.spec.ts`(9화면 단일 test), `package.json`(`audit:skip`), `CLAUDE.md`(P4 섹션)
