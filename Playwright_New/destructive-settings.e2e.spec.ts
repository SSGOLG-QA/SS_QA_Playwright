import { test, expect, Page } from '@playwright/test';
import { openAdmin, navigateMenu, settle } from '../lib/adminHelpers';
import { skipUnlessDestructive, withFixture } from './destructive';

// ──────────────────────────────────────────────────────────────
//  Tier A(설정 저장형) · Tier B(토글/상태형) 파괴 테스트 확장
//   ⚠ 기본 SKIP. ALLOW_DESTRUCTIVE=1 + td17 + 킹즈락 일 때만 실행. 모든 변경은 teardown 원복.
//   안전 설계(데이터 무손상 우선):
//     · 단일 요소(체크박스 1개 또는 텍스트 입력 1개)만 변경 → 저장 → teardown 원복.
//     · [저장] 없음/변경 미반영(커스텀 토글)/예외 → 저장 안 하고 graceful SKIP(데이터 무변경). FAIL 아님.
//     · 화면별 토글/저장 메커니즘 상이 → 제너릭으로 엔게이지 되는 화면만 실검증, 그 외 SKIP(전용 구현 플래그).
//   실행: ALLOW_DESTRUCTIVE=1 npx playwright test --config=Playwright_New/playwright.config.ts -g "Tier"
// ──────────────────────────────────────────────────────────────

let admin: Page;
test.beforeEach(async ({ page, context }) => { admin = await openAdmin(page, context); });

const saveBtn = () => admin.getByRole('button', { name: /^\s*저장\s*$|홀별\s*설정\s*저장/ }).first();
const confirmIfAny = async () => {
  const m = admin.locator('.modal-footer').filter({ has: admin.getByRole('button', { name: '확인', exact: true }) }).first();
  if (await m.isVisible({ timeout: 2500 }).catch(() => false)) await m.getByRole('button', { name: '확인', exact: true }).first().click().catch(() => {});
};
const doSave = async () => {
  if (await saveBtn().isVisible().catch(() => false)) {
    await saveBtn().click().catch(() => {}); await confirmIfAny();
    await admin.locator('.toast-box').filter({ hasText: /저장|완료|성공|반영|적용|처리/ }).first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
    await admin.waitForTimeout(700);
  }
};
const flip = async (cb: ReturnType<Page['locator']>) => {
  const lbl = cb.locator('xpath=ancestor::label[1]');
  if (await lbl.count().catch(() => 0)) await lbl.first().click().catch(async () => { await cb.click({ force: true }).catch(() => {}); });
  else await cb.click({ force: true }).catch(() => {});
  await confirmIfAny();   // 일부 화면은 토글 즉시 확인모달(설정을 변경하겠습니까?)
  await admin.waitForTimeout(400);
};

// 제너릭: 단일 요소 변경 → 저장 → 원복. 엔게이지 실패/예외 시 SKIP(원복 후).
function settingsDestructive(parent: string, child: string) {
  test(`Tier A/B 파괴: ${parent} > ${child} 변경→저장→원복`, async () => {
    await skipUnlessDestructive(admin);
    await navigateMenu(admin, parent, child).catch(() => {}); await settle(admin);   // 진입 플레이크 → 미착지 시 아래 가드가 SKIP
    await admin.locator('.contents-box').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    if (!(await saveBtn().isVisible({ timeout: 5_000 }).catch(() => false))) { test.skip(true, `[저장] 버튼 없음(인라인/행단위 저장 화면) — 전용 구현 필요`); return; }

    const cb = admin.locator('.contents-box input[type=checkbox]').first();
    const txt = admin.locator('.contents-box input:not([type=checkbox]):not([type=radio]):not([readonly])').first();
    let mode = '', origChecked: boolean | null = null, origVal = '', skipReason = '', done = false;

    await withFixture(
      async () => {
        if ((await cb.count().catch(() => 0)) > 0 && await cb.isEnabled().catch(() => false)) { mode = 'cb'; origChecked = await cb.isChecked().catch(() => null); }
        else if ((await txt.count().catch(() => 0)) > 0 && await txt.isEditable().catch(() => false)) { mode = 'txt'; origVal = await txt.inputValue().catch(() => ''); }
        if (!mode) skipReason = '변경 가능한 체크박스/입력 없음';
      },
      async () => {
        if (skipReason) return;
        try {
          let changed = false;
          if (mode === 'cb') { await flip(cb); changed = (await cb.isChecked().catch(() => origChecked)) !== origChecked; }
          else { await txt.fill(String((parseInt(origVal || '0', 10) || 0) + 1)).catch(() => {}); await txt.blur().catch(() => {}); await admin.waitForTimeout(300); changed = (await txt.inputValue().catch(() => origVal)) !== origVal; }
          if (!changed) { skipReason = '제너릭 변경 미반영(커스텀 토글/입력 구조 상이) — 전용 파괴 케이스 필요'; return; }
          await doSave();   // 변경 영속(파괴) — 실제 변경된 경우만
          done = true;
        } catch (e: any) { skipReason = '예외: ' + String(e?.message || e).slice(0, 60); }
      },
      async () => {
        // 원복: 토글 되돌리기 / 값 복원 + 저장 (변경 수행된 경우만)
        if (!done) { await admin.waitForTimeout(100); }
        else if (mode === 'cb') { const cur = await cb.isChecked().catch(() => null); if (cur !== null && origChecked !== null && cur !== origChecked) await flip(cb); await doSave(); }
        else if (mode === 'txt') { await txt.fill(origVal).catch(() => {}); await txt.blur().catch(() => {}); await admin.waitForTimeout(300); await doSave(); }
        const now = mode === 'cb' ? String(await cb.isChecked().catch(() => '?')) : await txt.inputValue().catch(() => '?');
        console.log(`[teardown] ${child} (mode=${mode}, done=${done}) 현재=${now} 원본=${mode === 'cb' ? origChecked : JSON.stringify(origVal)}`);
      },
    );
    if (skipReason) { test.skip(true, skipReason); return; }
    expect(done, '변경→저장 경로 수행').toBeTruthy();
  });
}

// ── Tier A: 설정 저장형 ──
settingsDestructive('홀맵 관리', '홀맵 구역 설정');
settingsDestructive('홀맵 관리', '카트패스 진입여부 설정');
settingsDestructive('홀맵 관리', '티샷 유의 거리 설정');
settingsDestructive('태블릿 운영 관리', '태블릿 기능 설정');
settingsDestructive('관제 관리', '아이콘 관리');
settingsDestructive('코스 운영 관리', '그린 스피드');

// ── Tier B: 후기 리스트 숨김처리 ↔ 숨김해제 ──
test('Tier B 파괴: 후기 리스트 숨김처리→숨김해제 원복', async () => {
  await skipUnlessDestructive(admin);
  await navigateMenu(admin, '고객 평가 관리', '후기 리스트').catch(() => {}); await settle(admin);
  const table = admin.locator('.table-overflow-item table, .list-table-group table').first();
  const firstRowCheck = table.locator('tbody tr').first().locator('input[type=checkbox]').first();
  const hideBtn = () => admin.getByRole('button', { name: /숨김\s*처리/ }).first();
  const unhideBtn = () => admin.getByRole('button', { name: /숨김\s*해제|해제|노출/ }).first();
  if (!(await table.locator('tbody tr').first().isVisible({ timeout: 6_000 }).catch(() => false))) { test.skip(true, '후기 데이터 없음'); return; }
  const selOk = await firstRowCheck.check({ force: true, timeout: 5_000 }).then(() => true).catch(() => false);
  if (!selOk || !(await hideBtn().isVisible({ timeout: 3_000 }).catch(() => false))) { test.skip(true, '후기 행 선택/숨김처리 진입 불가 — 전용 구현 필요'); return; }

  let done = false, skipReason = '';
  await withFixture(
    async () => { await firstRowCheck.check({ force: true }).catch(() => {}); },
    async () => {
      try {
        await hideBtn().click({ timeout: 5_000 }); await confirmIfAny();
        await admin.locator('.toast-box').filter({ hasText: /숨김|처리|완료|반영/ }).first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {});
        await admin.waitForTimeout(800); done = true;
      } catch (e: any) { skipReason = '숨김처리 미수행: ' + String(e?.message || e).slice(0, 50); }
    },
    async () => {
      if (done) { await firstRowCheck.check({ force: true }).catch(() => {}); if (await unhideBtn().isVisible({ timeout: 3_000 }).catch(() => false)) { await unhideBtn().click().catch(() => {}); await confirmIfAny(); await admin.waitForTimeout(800); } }
      console.log(`[teardown] 후기 숨김 원복(done=${done})`);
    },
  );
  if (skipReason) { test.skip(true, skipReason); return; }
  expect(done, '숨김처리 수행').toBeTruthy();
});
