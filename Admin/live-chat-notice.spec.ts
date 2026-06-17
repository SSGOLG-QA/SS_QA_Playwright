import { test } from '../lib/fixtures';
import { runLiveChatNotice } from '../lib/suites';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';

// 관제관리 > 라이브채팅 공지 조회 - 구조 기반 전수 검증 (드라이브 상세 TC 미작성)
//   IA: 관제 관리 하위 — 진입 가능(구현)
//   🔴 공지내용 검색 필드 label '출력률' 오표기 → 기획-구현 차이로 기록
// 실행: npx playwright test --project=admin-chromium Admin/live-chat-notice.spec.ts --no-deps
test('관제관리 > 라이브채팅 공지 조회 검증 (구조 기반)', async ({ admin }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  if (await gotoMenu(admin, '관제 관리', '라이브채팅 공지 조회', { path: '관제관리 > 라이브채팅 공지 조회', tcRef: '관제 관리_라이브채팅 공지 조회', tcId: '진입', desc: '라이브채팅 공지 조회 진입', failMsg: '메뉴 진입 불가' }))
    await runLiveChatNotice(admin);
  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('live-chat-notice'); });
