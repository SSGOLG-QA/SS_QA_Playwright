import { test } from '@playwright/test';
import { openAdmin } from '../lib/adminHelpers';
import { writeReport, resetResults, resetNoTC, resetDiff, gotoMenu } from '../lib/reporter';
import { scanScreenAllLangs } from '../lib/langCheck';

// ──────────────────────────────────────────────────────────────
//  언어 검증 PoC — 일본어/인도네시아어 모드에서 '정적 UI' 한글 노출 검출
//   대상(PoC): 홈 + 관제관리 > 라이브채팅 공지 조회 (1개 메뉴)
//   전략: 한국어로 화면 진입 → 그 화면에서 언어 전환(현재 화면 리렌더) → 스캔 → 한국어 원복
//         (전환 후 SNB가 외국어로 바뀌면 한글 기반 navigateMenu가 불가하므로 진입은 한국어 상태에서)
//   결과: '언어검증' 검출 → 요약/이슈 시트 + 기획-구현 차이 시트(검출 목록)
// 실행: npx playwright test --project=admin-chromium Admin/lang-check.spec.ts --no-deps
// ──────────────────────────────────────────────────────────────
test('언어 검증 PoC (홈 + 라이브채팅 공지 조회) — 한글 노출 검출', async ({ page, context }) => {
  test.setTimeout(180_000);
  resetResults(); resetNoTC(); resetDiff();
  const admin = await openAdmin(page, context);

  // ① 홈(랜딩) — 네비게이션 없이 바로 스캔
  await scanScreenAllLangs(admin, '홈', '언어검증_홈');

  // ② 관제관리 > 라이브채팅 공지 조회 (한국어로 진입 후 언어 전환)
  if (await gotoMenu(admin, '관제관리', '라이브채팅 공지 조회', { path: '관제관리 > 라이브채팅 공지 조회', tcRef: '언어검증_라이브채팅', tcId: '진입', desc: '진입', failMsg: '메뉴 진입 불가' }))
    await scanScreenAllLangs(admin, '관제관리 > 라이브채팅 공지 조회', '언어검증_라이브채팅');

  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('lang-check'); });
