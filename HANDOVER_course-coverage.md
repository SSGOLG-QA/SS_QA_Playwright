# 코스관리 커버리지 체계 — 세션 인수인계 (2026-08-20)

> 코스관리(course-mng-td) 자동화 **커버리지 트리 체계** 구축 + 취약영역 보강 세션의 인수인계.
> 대상: `https://course-mng-td.smartscore.kr`(킹즈락, td 테스트환경). 전부 **비파괴**.

## 1. 목적
"화면별 세부 구성요소(문구·placeholder·datepicker·드롭·버튼·테이블·달력·차트·이미지…)가 **모두 테스트 커버되는지**를 트리로 파악하고, 취약 영역을 데이터로 짚어 보강." + 화면 밖 전환(모달/팝업/페이지)과 그 대상 커버리지까지.

## 2. 핵심 산출물
| 파일 | 내용 |
|---|---|
| `reports/course-coverage-tree_*.html` | **인터랙티브 트리**(대메뉴>소메뉴>탭>kind>구성요소 × 커버여부 × 카테고리 + 전환 서브트리 + 미포착 감사). 검색·카테고리 필터·미커버만. |
| `reports/course-coverage-notes.xlsx` | **의견 기입(round-trip)** — '의견' 컬럼(연노랑) 편집→재생성 시 ID 매칭 유지. **'요약' 시트**(메뉴별 컴포넌트/커버/미커버). 현재 의견 138건 보존 중. |
| `baselines/course-components.<sub>.json` | 구성요소 인벤토리(분모). |
| `baselines/course-components-audit.<sub>.json` | **미포착 감사**(완전성 검증). |
| `baselines/course-transitions.<sub>.json` | Phase B/C 전환맵(트리거→모달/팝업/페이지+대상 구성요소). |
| `baselines/course-coverage-manifest.json` | 설계 매핑(분자, level/tcId) — 리포트 매칭과 union. |

## 3. 커버리지 체계 (Phase)
- **Phase A**: 기본 화면 구성요소(위젯 단위 — 테이블+컬럼·달력·차트·이미지·섹션 각 1개, 데이터 인스턴스 제외 / 컨트롤·텍스트).
- **Phase A+**: 탭별 콘텐츠(탭 클릭 후 **델타**만 귀속 — 공통요소 중복 방지).
- **Phase B**: 화면 밖 전환(열기형 트리거 비파괴 클릭 → 모달/새탭/페이지 분류).
- **Phase C**: 전환 대상 내부 구성요소 카탈로그 + 커버 여부.
- **미포착 감사**: 캡처 후 본문 텍스트/인터랙티브 중 안 잡힌 후보 리포트 = 완전성 수치 증명(현재 **0**).
- **4 카테고리**(메뉴 기반): 코스현황=지도시각화 / 예산·비용=숫자계산 / 폼컨트롤·CRUD=등록수정 / 그 외=화면기본.

## 4. 도구 (npm scripts)
```bash
# 인벤토리/전환/감사 (라이브, 세션 필요)
npm run course:inventory          # Phase A/A+ 인벤토리 + 미포착 감사
npm run course:transition-map     # Phase B/C 전환맵 (단독 세션 권장)
# 취약영역 4대 보강 (라이브)
npm run course:budget-cost-columns  # 숫자계산 (예산/비용 컬럼+합계)
npm run course:visual-controls      # 지도시각화 (코스현황 시각 컨트롤)
npm run course:modal-controls       # 전환 대상 폼 (모달 내부 컨트롤)
npm run course:display-verify       # 화면기본 (전 화면 표시요소)
# 트리 생성 (오프라인, 전 리포트 통합 매칭)
npm run course:coverage-tree        # HTML 트리 + 의견/Summary xlsx
# 진단 프로브
npm run course:home-tab-probe / course:calendar-probe / course:content-probe / course:workorder-edit-probe
```
> `course-coverage-tree`는 **전 `코스관리_*_report_*.xlsx`(스위트 prefix별 최신)를 병합**해 매칭 → 어떤 자동화든 리포트만 있으면 자동 크레딧(= 커버리지 체계 표준화).

## 5. 현재 수치 (2026-08-20 최종)
- **전체 커버 62.0%** (854/1378 구성요소) · 미포착 감사 0
- 카테고리: 화면기본 46%(309/675) · 등록수정 76%(208/273) · 숫자계산 80%(267/332) · 지도시각화 71%(70/98)
- 전환: 27개(모달 20·페이지 7) · 전환 대상 커버 46%(171/368)
- 취약영역 보강 결과: 숫자 3→80 · 지도 15→71 · 전환폼 23→46 · 화면기본 26→46

## 6. ⚠ 세션 제약 (가장 중요)
- **"1로그인당 1런"** — 공유 QA 계정이라 재로그인 1회당 1개 스펙런만 생존. 다음 런은 depth-2 네비가 빈값(`노출 항목:[]`)으로 degraded → 진입 전부 실패.
- **재인증**: `npm run course:auth`(헤디드 수동 로그인). 무거운 런(transition-map·inventory)은 **재인증 직후 곧바로** 단독 실행.
- 스펙은 degraded 시 "진입 실패"로 정직 기록(가짜 데이터 없음).

## 7. 주요 함정 (해결 이력)
- **allow-list 셀렉터의 불완전성** → inclusive(deny-list: 본문 전수, 데이터/chrome만 제외)로 전환 = 완전성 확보.
- **비시맨틱 컨트롤**(달력 주간/월간/연간·화살표가 div/span) → `getComputedStyle(el).cursor==='pointer'` 휴리스틱 + 뷰토글/arrow 안전장치.
- **탭 델타**: 탭 클릭 시 화면 전체 재캡처하면 공통요소 중복 → base 대비 신규만 귀속.
- **push 44자 truncation** → text/title 200자(안내문구 잘림·가짜 미포착 해소).
- **카테고리 오분류**(일정달력이 지도시각화) → 메뉴 기반 재정의.
- **매칭 갭**: 트리가 전 리포트를 로드해야 기존 자동화 크레딧(안 하면 % 착시).

## 8. 다음 단계 (잔여)
1. **화면기본 46%** — 195개 표시요소가 탭/상태 의존으로 `getByText` 재검 SKIP(부분텍스트·비활성탭). 탭별 정밀 재검으로 상승 여지.
2. **전환 대상 46%** — 모달 상세조회·개별 버튼 클릭 검증 확대.
3. 신규 자동화 추가 시 → 리포트 생성 → `course:coverage-tree`로 자동 반영(수동 작업 없음).

## 9. 파일 맵
- 스펙: `Course/component-inventory.spec.ts`(인벤토리+감사) · `course-transition-map.spec.ts`(B/C) · `course-{budget-cost-columns,visual-controls,modal-controls,display-verify}.spec.ts`(보강) · `course-{home-tab,calendar,content,workorder-edit}-probe.spec.ts`(진단)
- 렌더러: `scripts/courseCoverageTree.js`(트리 HTML + 의견/Summary xlsx, 전 리포트 매칭)
- 라이브러리: `lib/course/deepScreenE2E.ts`(DEEP_SCREENS·runDeepScreensSweep) · `formE2E.ts` · `courseHelpers.ts`(COURSE_IA·gotoCourseMenu·1런 제약)
- 관련 메모리: `.claude/.../memory/course-coverage-tree.md`, `course-deep-screen-e2e.md`

## 10. 검증 상태
- 전 코드 `npm run typecheck` 통과. 라이브 검증: 인벤토리/전환/4보강 모두 실행·수치 확인 완료(위 §5).
- ⚠ 최신 코드 수정분(2 FAIL→SKIP 등)은 다음 refresh에 반영(현 baseline은 마지막 실행분).
