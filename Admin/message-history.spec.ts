import { test } from '../lib/fixtures';
import { runMessageHistory } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 관제 관리 > 메시지 기록 조회 - 구조 기반 (2026-06 콘텐츠 구현 확인, /club/page/control-message-history)
//   ⚠ 초기화/적용은 조회(읽기) 동작 → 노출만 검증(비파괴). 대화 항목은 데이터 의존(빈 상태 SKIP)
// 실행: npx playwright test --project=admin-chromium Admin/message-history.spec.ts --no-deps
test('관제 관리 > 메시지 기록 조회 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '관제 관리', '메시지 기록 조회', { path: '관제 관리 > 메시지 기록 조회', tcRef: '관제 관리_메시지 기록 조회', tcId: '진입', desc: '메시지 기록 조회 진입', failMsg: '메뉴 진입 불가' }))
    await runMessageHistory(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('message-history'); });
