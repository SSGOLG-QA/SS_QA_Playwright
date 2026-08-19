import { test } from '../lib/fixtures';
import { runScoreOutput } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 라운드 관리 > 스코어 출력 설정 (신규 화면) — 구조 기반 전수 검증(비파괴).
//   URL /club/page/scorecard-print-setting · 사용여부 토글·골프장 로고·본인확인 방식(radio).
//   ⚠ 비파괴: 저장·바로가기(로그아웃)·사진선택/등록·토글 실변경 클릭 금지 → 노출·활성만. 로고/본인확인은 '노출' 상태 의존.
// 실행: npm run auth 후 npx playwright test --project=admin-chromium Admin/score-output.spec.ts --no-deps
test('라운드 관리 > 스코어 출력 설정 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '라운드 관리', '스코어 출력 설정', { path: '라운드관리 > 스코어 출력 설정', tcRef: '라운드 관리_스코어 출력 설정', tcId: '진입', desc: '스코어 출력 설정 진입', failMsg: '메뉴 진입 불가' }))
    await runScoreOutput(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('score-output'); });
