import { test } from '@playwright/test';
import { openAdmin, navigateMenu, extractDom } from '../lib/adminHelpers';
import fs from 'fs';
import path from 'path';

// ──────────────────────────────────────────────────────────────
//  메뉴 자동 진입 + DOM 추출 (분석용)
//
//  사용:
//    $env:MENU="배토 관리>배토 통계"; npx playwright test --project=admin-chromium Admin/explore.spec.ts --no-deps --headed
//    - MENU="대메뉴>하위메뉴" 형식 (하위 없으면 "대메뉴"만)
//    - 결과 DOM은 analysis/<파일>.json 으로 저장됨 → 분석에 사용
//    - $env:KEEP_OPEN=1 추가 시 진입 화면을 닫지 않고 유지
// ──────────────────────────────────────────────────────────────

test('메뉴 진입 + DOM 추출', async ({ page, context }) => {
  test.slow();

  const menuSpec = process.env.MENU || '';            // 예: "배토 관리>배토 통계"
  const [parent, child] = menuSpec.split('>').map(s => s.trim());

  // 1) 어드민 홈 진입
  const admin = await openAdmin(page, context);

  // 2) 지정 메뉴로 이동 (실패해도 진행 — 창 유지/추출 보장)
  if (parent) {
    const ok = await navigateMenu(admin, parent, child).catch(() => false);
    if (!ok) console.warn(`[explore] 메뉴 진입 실패: "${menuSpec}" — 현재 화면 기준으로 추출합니다.`);
    // SPA 컨텐츠 렌더 안정화 — 홈 공지(.notice-list-item)가 사라질 때까지 + 여유 대기
    await admin.locator('.notice-list-item').first().waitFor({ state: 'detached', timeout: 8_000 }).catch(() => {});
    await admin.waitForTimeout(2_000);
  }

  // 3) DOM 추출 → 파일 저장
  const dom = await extractDom(admin);
  const dir = path.join(process.cwd(), 'analysis');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const slug = (menuSpec || 'home').replace(/[>\s/]+/g, '_');
  const outPath = path.join(dir, `${slug}.json`);
  fs.writeFileSync(outPath, JSON.stringify(dom, null, 2), 'utf-8');
  console.log(`\n[explore] 메뉴 "${menuSpec || '(home)'}" 진입 → DOM 저장: ${outPath}`);
  console.log(`[explore] URL: ${dom.url}\n`);

  // 4) 창 유지 (검사용)
  if (process.env.KEEP_OPEN) {
    await admin.pause();
  }
});
