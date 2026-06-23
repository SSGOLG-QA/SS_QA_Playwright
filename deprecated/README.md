# deprecated/

이 디렉토리는 더 이상 메인 테스트 스위트에 포함되지 않는 레거시 파일들을 보관합니다.

## 파일 목록

| 파일/디렉토리 | 이전 역할 | 대체 |
|---|---|---|
| `SmartScore.spec.ts` | MNG/Admin 로그인 + 메뉴 탐색 초기 스크립트 | `Admin/` 스위트 + `lib/suites.ts` |
| `Spark_login.spec.ts` | 클럽 로그인 단순 시나리오 | `auth/auth.setup.ts` |
| `Spark_menu.spec.ts` | Admin 메뉴 탐색 초기 스크립트 | `Admin/` 스위트 |
| `Cloud/` | Cloud 대시보드 테스트 (sv1td4 환경) | 미이전 (환경 별도) |
| `Flow/` | 순차 플로우 테스트 (레거시 구조) | `Admin/all-suite.spec.ts` |

## 주의

- 이 파일들은 `playwright.config.ts`의 테스트 매칭에서 제외됩니다.
- 참고 목적으로만 보관하며, 필요 없으면 삭제해도 됩니다.
