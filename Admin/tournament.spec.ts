import { test } from '../lib/fixtures';
import { runTournament } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 대회 > 대회관리 - 2026-06 대회모드 TC 기준 검증
//   TC: 드라이브 > 01.TC > 2026-06 대회모드 (시트 '대회모드_Cloud', 531 TC). IA: 대회 대메뉴(단일 하위). URL: /club/page/tournament
//   🔴 비파괴: 대회 등록·설정·등록·복사·시상내역 편집·저장·삭제·엑셀 업로드 금지(노출·활성만).
//   ✅ 읽기전용 딥 인터랙션: [스코어]/[결과집계·출력] 보기 팝업 구조 노출 검증 → 비파괴 닫기.
//   ⛔ 리더보드/관리자 웹뷰(별도 웹앱, 새 창)는 범위 외(랜딩만) → diff 추적.
//   ⚠ TC host=td18, target=td17 — 라벨 차이 정규식·부분일치 + diff 추적(라이브 재확인 필요).
// 실행: npx playwright test --project=admin-chromium Admin/tournament.spec.ts --no-deps
test('대회 > 대회관리 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '대회', '대회관리', { path: '대회 > 대회관리', tcRef: '대회_대회관리', tcId: '진입', desc: '대회관리 진입', failMsg: '메뉴 진입 불가' }))
    await runTournament(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('tournament'); });
