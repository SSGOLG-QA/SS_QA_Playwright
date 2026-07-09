import { test } from '../lib/fixtures';
import { runGroupRound } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 라운드관리 > 단체 라운드 — 구조 기반 + 읽기전용 딥 인터랙션 (드라이브 상세 TC 미작성)
//   IA: 라운드관리 하위. URL: /club/page/round-group
//   🔴 비파괴: 등록·설정·복사·그룹편집/핸디관리·결과집계/출력·시상내역 편집(데이터 변경/단체팀 고도화 별도) = 노출만.
//   ✅ 읽기전용 딥 인터랙션: [보기] 팝업 DOM 노출→닫기 / [관리자 웹뷰] 새 탭 랜딩→닫기 / [랭킹다운] 다운로드 발생 / 데이트피커 실조회.
//   ⚠️ 데이터 의존 항목(GRND-06~10)은 0건 시 SKIP(가짜 FAIL 방지).
// 실행: npx playwright test --project=admin-chromium Admin/group-round.spec.ts --no-deps
test('라운드관리 > 단체 라운드 검증 (구조 기반 + 읽기전용 딥 인터랙션)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '라운드관리', '단체라운드', { path: '라운드관리 > 단체 라운드', tcRef: '라운드 관리_단체 라운드', tcId: '진입', desc: '단체 라운드 진입', failMsg: '메뉴 진입 불가' }))
    await runGroupRound(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('group-round'); });
