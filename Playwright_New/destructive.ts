import { Page, test } from '@playwright/test';

// ──────────────────────────────────────────────────────────────
//  파괴(destructive) 테스트 가드 — 운영 보호용 옵트인 + 이중 화이트리스트
//
//  기본값: 비활성(모든 파괴 단계 SKIP). 아래 3중 조건 모두 충족 시에만 실행:
//    1) 환경변수 ALLOW_DESTRUCTIVE=1            (명시적 옵트인)
//    2) TEST_HOSTS 에 현재 호스트 포함          (테스트 서버만)
//    3) TEST_CLUBS 에 현재 클럽(h3) 포함        (테스트 클럽/더미 데이터만)
//
//  실행 예:
//    ALLOW_DESTRUCTIVE=1 TEST_HOSTS=td17-test.smartscore.kr TEST_CLUBS=E2E테스트클럽 \
//      npx playwright test --config=Playwright_New/playwright.config.ts
//  (PowerShell: $env:ALLOW_DESTRUCTIVE="1"; $env:TEST_HOSTS="..."; $env:TEST_CLUBS="..."; npx ...)
// ──────────────────────────────────────────────────────────────

export const DESTRUCTIVE_ENABLED = process.env.ALLOW_DESTRUCTIVE === '1';
// 기본 화이트리스트: td17(개발/테스트 도메인) + 킹즈락(테스트 클럽, 비실데이터) — 사용자 확정(2026-06-04).
//   환경변수로 override 가능. ⚠ 최종 스위치는 ALLOW_DESTRUCTIVE=1 (기본 OFF).
export const TEST_HOST_WHITELIST = (process.env.TEST_HOSTS || 'td17.smartscore.kr').split(',').map(s => s.trim()).filter(Boolean);
export const TEST_CLUB_WHITELIST = (process.env.TEST_CLUBS || '킹즈락').split(',').map(s => s.trim()).filter(Boolean);

// 파괴 허용 여부 종합 판정 (옵트인 + 호스트 + 클럽). 운영/공유 환경은 항상 false.
export async function isDestructiveAllowed(page: Page): Promise<{ ok: boolean; reason: string }> {
  if (!DESTRUCTIVE_ENABLED) return { ok: false, reason: 'ALLOW_DESTRUCTIVE!=1 (기본 비파괴)' };
  if (!TEST_HOST_WHITELIST.length || !TEST_CLUB_WHITELIST.length)
    return { ok: false, reason: 'TEST_HOSTS/TEST_CLUBS 화이트리스트 미설정 — 운영 보호' };
  const host = (() => { try { return new URL(page.url()).host; } catch { return ''; } })();
  if (!TEST_HOST_WHITELIST.some(h => host.includes(h))) return { ok: false, reason: `비-테스트 호스트(${host})` };
  const club = (await page.locator('h3').first().innerText().catch(() => '')).trim();
  if (!TEST_CLUB_WHITELIST.some(c => club.includes(c))) return { ok: false, reason: `비-테스트 클럽(${club})` };
  return { ok: true, reason: `테스트 환경 확인(host=${host}, club=${club})` };
}

// 비허용 시 현재 test 를 SKIP(사유 명시). 파괴 단계 직전에 호출.
export async function skipUnlessDestructive(page: Page): Promise<void> {
  const g = await isDestructiveAllowed(page);
  test.skip(!g.ok, `파괴 테스트 비활성 — ${g.reason}`);
}

// 데이터 셋업 → 본문 → (항상) 원복 골격. teardown 은 본문 실패와 무관하게 실행.
export async function withFixture(
  setup: () => Promise<void>,
  body: () => Promise<void>,
  teardown: () => Promise<void>,
): Promise<void> {
  await setup();
  try { await body(); } finally { await teardown(); }
}
