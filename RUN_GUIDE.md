# 기획서 JSON → SpecParser 변환 실행 가이드

## 파이프라인 전체 흐름

```
analysis/*.json          기획서 JSON
     │                       │
     ▼                       │
① extractRoutes.ts            │
     │                       │
     ▼                       ▼
  route-map.json ──── ② jsonToSpecParser.ts
                              │
                              ▼
                        spec-input.json
                              │
                              ▼
                      ③ genSuites.ts
                              │
                              ▼
                   suites.generated.ts
                   (검토 후 lib/suites.ts 병합)
```

---

## 사전 조건

```powershell
cd D:\Playwright
npm install           # ts-node 등 기존 devDependencies 확인
```

3개 파일을 `D:\Playwright\scripts\` 에 복사:
- `extractRoutes.ts`
- `jsonToSpecParser.ts`
- `genSuites.ts`

---

## Step 1 — Route 맵 추출

```powershell
npx ts-node scripts/extractRoutes.ts
```

**출력**: `scripts/route-map.json`

로그에서 `❌ Route 없음` 항목 확인 — 해당 화면은 아래 중 하나:
- `url` 필드가 JSON에 없는 경우 → explore.spec.ts 재덤프 필요
- 특수 파일(Home, _census 등) → 정상 스킵

---

## Step 2 — SpecParser 호환 JSON 생성

```powershell
npx ts-node scripts/jsonToSpecParser.ts `
  --planJson=./경기관제_클럽어드민__개선__3_.json
```

**출력**: `scripts/spec-input.json`

> ⚠️ 기획서 JSON 키명이 다를 경우 `jsonToSpecParser.ts` 상단의
> `PLAN_KEY_MAP` 상수를 수정하세요.

---

## Step 3 — run*() 함수 초안 생성

```powershell
# 검토용 파일만 생성 (lib/suites.ts 건드리지 않음 — 권장)
npx ts-node scripts/genSuites.ts

# lib/suites.ts 에 직접 append (검토 완료 후)
npx ts-node scripts/genSuites.ts --append
```

**출력**: `scripts/suites.generated.ts`

---

## Step 4 — 생성 파일 검토 및 병합

`suites.generated.ts` 에서 확인할 항목:

| 확인 항목 | 위치 |
|-----------|------|
| `TODO: route 미확보` 주석 화면 | route 공란인 함수 상단 |
| `import` 경로 (`./helpers`, `./reporter`) | 파일 상단 |
| 함수명 중복 또는 오매핑 | `run*` 함수 이름 |
| `gotoMenu` 호출 파라미터 | 각 함수 내부 |

검토 후 `lib/suites.ts` 에 필요한 함수만 붙여넣거나 `--append` 실행.

---

## Route 미확보 화면 처리

Step 1 로그에서 `❌ Route 없음`으로 표시된 화면은:

```powershell
# 예: 캐디피 관리 화면 덤프
$env:MENU="캐디피 관리"; npx playwright test --project=admin-chromium Admin/explore.spec.ts --no-deps

# 덤프 후 Step 1 재실행
npx ts-node scripts/extractRoutes.ts
```

덮어쓰기 후 Step 2, 3 재실행하면 route 자동 채워짐.

---

## 현재 analysis/ 파일 기준 예상 커버리지

덤프 완료된 화면 기준 Route 확보 예상:

| 대메뉴 | 화면 수 | 덤프 파일 |
|--------|---------|-----------|
| 라운드 관리 | 7 | ✅ 전부 |
| 관제 관리 | 4 | ✅ 전부 |
| 태블릿 운영 관리 | 3 | ✅ 전부 |
| 홀맵 관리 | 4 | ✅ 전부 |
| 코스 운영 관리 | 6 | ✅ 전부 |
| 경기 진행 관리 | 4 | ✅ 전부 |
| 캐디 관리 | 3 | ✅ 전부 |
| 배토 관리 | 2 | ✅ 전부 |
| 식음 관리 | 4 | ✅ 전부 |
| 대회 | 1 | ✅ |
| 고객 평가 관리 | 4 | ✅ 전부 |
| 계정 관리 | 2 | ✅ 전부 |
| **캐디피 관리** | ? | ❌ 덤프 없음 |

캐디피 관리만 explore.spec.ts 덤프 후 재실행하면 전체 커버 가능.
