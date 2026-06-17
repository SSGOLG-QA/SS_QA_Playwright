import { test } from '../lib/fixtures';
import { runTournament } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 대회 > 대회관리 - 구조 기반 전수 검증 (드라이브 상세 TC 미작성)
//   IA: 대회 대메뉴(단일 하위). URL: /club/page/tournament
//   🔴 비파괴: 신규 등록·설정·등록·복사·보기(상세/웹뷰 진입) 금지(노출·활성만). 검색은 조회성.
//   ⚠️ 리더보드=관리자 웹뷰 URL 동일 → 기획-구현 차이 기록
// 실행: npx playwright test --project=admin-chromium Admin/tournament.spec.ts --no-deps
test('대회 > 대회관리 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '대회', '대회관리', { path: '대회 > 대회관리', tcRef: '대회_대회관리', tcId: '진입', desc: '대회관리 진입', failMsg: '메뉴 진입 불가' }))
    await runTournament(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('tournament'); });
