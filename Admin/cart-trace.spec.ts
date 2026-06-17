import { test } from '../lib/fixtures';
import { runCartTrace } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu, diff, skip } from '../lib/reporter';
import { navigateMenu } from '../lib/adminHelpers';

// 관제관리 > 카트 이동경로 확인 - 구조 기반 제한 검증 (지도·재생 도구)
//   ⚠️드리프트(2026-06-16): SNB에서 '카트이동경로 확인' 메뉴 제거 확인(관제 모니터로 통합 추정).
//     → 적응형: 메뉴 존재 시 기존 검증 수행, 부재 시 제거 사실을 diff로 추적(가짜 진입 FAIL 방지).
//   ⚠ (메뉴 존재 시) 지도 상호작용·경로재생 제외, 필터·지도·컨트롤 노출만(비파괴)
// 실행: npx playwright test --project=admin-chromium Admin/cart-trace.spec.ts --no-deps
test('관제관리 > 카트 이동경로 확인 검증 (구조 기반 제한)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  // SNB 메뉴 존재 여부 선탐지(2~3회) — navigateMenu는 실패해도 FAIL 기록 안 함
  let present = false;
  for (let i = 0; i < 3 && !present; i++) present = await navigateMenu(admin, '관제 관리', '카트이동경로 확인').catch(() => false);
  if (present) {
    await gotoMenu(admin, '관제 관리', '카트이동경로 확인', { path: '관제관리 > 카트이동경로 확인', tcRef: '관제 관리_카트이동경로 확인', tcId: '진입', desc: '카트 이동경로 확인 진입', failMsg: '메뉴 진입 불가' });
    await runCartTrace(admin);
  } else {
    diff('관제관리 > 카트이동경로 확인', '관제 관리 하위 [카트 이동경로 확인] 메뉴 제공', 'SNB에서 메뉴 제거됨(관제 모니터로 통합 추정)', '관제 관리_카트이동경로 확인', '구조 변경 — QA 확인 요망(기능 이전/제거 여부)');
    skip({ path: '관제관리 > 카트이동경로 확인', tcRef: '관제 관리_카트이동경로 확인', tcId: 'CARTTRACE-ALL', desc: '카트 이동경로 확인 전체 검증' }, '메뉴 제거됨(2026-06-16 드리프트) — SNB에 카트이동경로 확인 부재');
  }
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('cart-trace'); });
