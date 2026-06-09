import { test, expect, Page } from '@playwright/test';
import { openAdmin, navigateMenu, settle } from '../lib/adminHelpers';
import { skipUnlessDestructive, withFixture } from './destructive';

// ──────────────────────────────────────────────────────────────
//  파괴(destructive) 테스트 — 저장/확인 등 데이터 변경 동작 검증.
//  ⚠ 기본 SKIP. td17(테스트) + 킹즈락(테스트클럽) + ALLOW_DESTRUCTIVE=1 일 때만 실행.
//  실행: ALLOW_DESTRUCTIVE=1 npx playwright test --config=Playwright_New/playwright.config.ts
//  ★ 모든 시나리오는 withFixture teardown 에서 원복(본문 실패와 무관하게 실행).
// ──────────────────────────────────────────────────────────────

let admin: Page;
test.beforeEach(async ({ page, context }) => { admin = await openAdmin(page, context); });

// 항목8(파괴): 카트 사용중지 → confirm '확인' 실행 → 성공 토스트 → 사용재개 원복
//   통제 관찰(2026-06-05)로 확정: confirm="카트사용을 중지 하시겠습니까?"(취소/확인), 성공 토스트="처리되었습니다.",
//   원복=비활성 행('사용중지' 버튼 없는 행)의 '보기' 외 버튼 클릭(+확인). teardown 후 비활성 0 보증.
test('파괴: 카트 사용중지 확인 → 성공 토스트 → 사용재개 원복', async () => {
  await skipUnlessDestructive(admin);                          // 비허용 시 SKIP(운영 보호)
  await navigateMenu(admin, '라운드 관리', '카트관리');
  await settle(admin);

  const table = admin.locator('.table-overflow-item table').first();
  const usingRow = table.locator('tbody tr').filter({ has: admin.getByRole('button', { name: '사용중지' }) }).first();
  const confirmModal = () => admin.locator('.modal-footer').filter({ has: admin.getByRole('button', { name: '확인', exact: true }) }).first();
  const disabledRows = () => table.locator('tbody tr').filter({ hasNot: admin.getByRole('button', { name: '사용중지' }) });

  await withFixture(
    // setup: 사용중 카트 존재 확인
    async () => { await expect(usingRow, '사용중 카트 행 존재').toBeVisible({ timeout: 8_000 }); },
    // body: 사용중지 → 확인 → 성공 토스트("처리되었습니다.")
    async () => {
      await usingRow.getByRole('button', { name: '사용중지' }).click();
      await expect(confirmModal(), '사용중지 confirm 모달').toBeVisible({ timeout: 8_000 });
      await confirmModal().getByRole('button', { name: '확인', exact: true }).first().click();     // 확인 실행(파괴)
      await expect(admin.locator('.toast-box'), '처리 성공 토스트').toContainText('처리되었습니다', { timeout: 6_000 });
    },
    // teardown: 비활성 카트 사용재개(+확인) 원복 + 사후검증(비활성 0)
    async () => {
      await admin.waitForTimeout(800);
      const dr = disabledRows().first();
      if (await dr.count().catch(() => 0)) {
        await dr.getByRole('button').filter({ hasNotText: '보기' }).first().click().catch(() => {});   // 재개 버튼(라벨 가변 → '보기' 외)
        if (await confirmModal().isVisible({ timeout: 3_000 }).catch(() => false))
          await confirmModal().getByRole('button', { name: '확인', exact: true }).first().click().catch(() => {});
        await admin.waitForTimeout(1200);
      }
      const remain = await disabledRows().count().catch(() => 0);
      console.log('[teardown] 원복 후 비활성 카트 수(0이어야 정상):', remain);
      expect(remain, '원복 후 비활성 카트 0').toBe(0);
    },
  );
});

// 항목7(파괴): 홀별정산 사유 저장 — ⚠ [저장]이 '홀정산 요청 활성화' 토글 ON 선행에 게이트됨.
//   토글 OFF(현재 기본) 시 단순 입력만으로 저장 불가 → 복합 파괴(토글 ON→사유 저장→원복→토글 OFF) 필요. 조건부 실행.
test('파괴: 홀별정산 사유 저장 (활성화 토글 ON 조건부)', async () => {
  await skipUnlessDestructive(admin);
  await navigateMenu(admin, '라운드 관리', '홀별정산관리');
  await settle(admin);
  const actOn = await admin.locator('.contents-box').filter({ hasText: /활성화/ })
    .locator('input[type=checkbox]').first().isChecked().catch(() => false);
  test.skip(!actOn, '사유 [저장]은 홀정산 요청 활성화 토글 ON 선행 필요(현재 OFF) — 복합 파괴로 별도 처리');

  const reasonBox = admin.locator('.contents-box').filter({ has: admin.getByPlaceholder('직접입력') });
  const fields = admin.getByPlaceholder('직접입력');
  const save = () => reasonBox.getByRole('button', { name: '저장', exact: true }).first();
  const TEMP = 'E2E_임시사유';
  let orig: string[] = [];
  const typeField = async (i: number, val: string) => {
    const f = admin.getByPlaceholder('직접입력').nth(i);
    await f.click(); await admin.keyboard.press('Control+A'); await admin.keyboard.press('Delete');
    if (val) await f.pressSequentially(val, { delay: 20 });
  };
  await withFixture(
    async () => { orig = [await fields.nth(0).inputValue(), await fields.nth(1).inputValue(), await fields.nth(2).inputValue()]; },
    async () => {
      await typeField(0, TEMP);
      await expect(save(), '변경 시 [저장] 활성화').toBeEnabled({ timeout: 5_000 });
      await save().click();
      await expect(admin.locator('.toast-box'), '저장 성공 토스트').toContainText(/저장|완료|성공|반영|수정/, { timeout: 6_000 });
    },
    async () => {
      const cur = await admin.getByPlaceholder('직접입력').first().inputValue().catch(() => '');
      if (orig.length && cur !== orig[0]) { for (let i = 0; i < orig.length; i++) await typeField(i, orig[i]).catch(() => {}); await save().click().catch(() => {}); await admin.waitForTimeout(1000); }
    },
  );
});

// 파괴: 진행시간 표준 설정 — 입력변경 → 저장 → 초기화(Default 값 입력) → 저장 → (teardown)원본 복원+저장
//   ⚠ [저장] 2회로 골프장 표준시간 영구 변경 → 옵트인 가드 + teardown 원복 필수. 시간포맷 H:MM.
//   검증축: 각 단계 정합성(전체=경기+홀간) + 저장 영속(재진입) + 초기화가 Default(저장값과 다른 값) 채움.
test('파괴: 진행시간 표준설정 입력변경→저장→초기화(Default)→저장 (원본 복원)', async () => {
  await skipUnlessDestructive(admin);
  await navigateMenu(admin, '경기 진행 관리', '진행시간 표준 설정');
  await settle(admin);
  await admin.locator('.hole-card').first().waitFor({ state: 'visible', timeout: 10_000 });

  const holes = admin.locator('.hole-card');
  const t2m = (s: string) => { const m = (s || '').match(/(\d+)\s*:\s*(\d+)/); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN; };
  const readAll = async () => { const n = await holes.count(); const r: string[][] = []; for (let i = 0; i < n; i++) { const ins = holes.nth(i).locator('input'); r.push([await ins.nth(0).inputValue().catch(() => ''), await ins.nth(1).inputValue().catch(() => '')]); } return r; };
  const writeAll = async (vals: string[][]) => { for (let i = 0; i < vals.length; i++) { const ins = holes.nth(i).locator('input'); if (vals[i][0] !== '') { await ins.nth(0).fill(vals[i][0]).catch(() => {}); await ins.nth(0).blur().catch(() => {}); } if (vals[i][1] !== '') { await ins.nth(1).fill(vals[i][1]).catch(() => {}); await ins.nth(1).blur().catch(() => {}); } } await admin.waitForTimeout(300); };
  const summary = async () => { const s = (await admin.locator('.summary-panel').first().innerText()).replace(/\s+/g, ' '); return { game: t2m((s.match(/경기시간\s*(\d+:\d+)/) || [])[1]), wait: t2m((s.match(/홀간대기\s*(\d+:\d+)/) || [])[1]), total: t2m((s.match(/전체시간\s*(\d+:\d+)/) || [])[1]) }; };
  const saveBtn = () => admin.getByRole('button', { name: '저장', exact: true }).first();
  const resetBtn = () => admin.getByRole('button', { name: '초기화', exact: true }).first();
  const confirmModal = () => admin.locator('.modal-footer').filter({ has: admin.getByRole('button', { name: '확인', exact: true }) }).first();
  const clickConfirmIfAny = async () => { if (await confirmModal().isVisible({ timeout: 3_000 }).catch(() => false)) await confirmModal().getByRole('button', { name: '확인', exact: true }).first().click().catch(() => {}); };
  const doSave = async () => { await saveBtn().click().catch(() => {}); await clickConfirmIfAny(); await admin.locator('.toast-box').filter({ hasText: /저장|완료|성공|반영|적용|처리/ }).first().waitFor({ state: 'visible', timeout: 6_000 }).catch(() => {}); await admin.waitForTimeout(800); };
  const reenter = async () => { await navigateMenu(admin, '경기 진행 관리', '진행시간 표준 설정').catch(() => {}); await settle(admin); await holes.first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}); };

  let orig: string[][] = [];
  await withFixture(
    // setup: 활성 코스 9홀 원본 저장값 캡처
    async () => { orig = await readAll(); expect(orig.length, '홀 카드 ≥1').toBeGreaterThanOrEqual(1); },
    async () => {
      const h1 = holes.first().locator('input').nth(0);
      const O = parseInt(orig[0][0] || '0', 10) || 0;
      const marker = String(O + 7);
      // 1) 입력 변경 → 정합성 → 저장
      await h1.fill(marker); await h1.blur(); await admin.waitForTimeout(400);
      const s1 = await summary(); expect(s1.total, '변경 후 전체=경기+홀간').toBe(s1.game + s1.wait);
      await doSave();
      // 저장 영속 확인(타 메뉴 경유 재진입 후 값 유지)
      await navigateMenu(admin, '경기 진행 관리', '진행시간 실시간'); await settle(admin);
      await reenter();
      expect(await holes.first().locator('input').nth(0).inputValue(), '저장값 영속(재진입)').toBe(marker);
      // 2) 초기화 → Default 값 채움(저장한 marker와 달라야 함) + 정합성
      await resetBtn().click(); await clickConfirmIfAny(); await admin.waitForTimeout(1000);
      const afterReset = await readAll();
      expect(afterReset[0][0], '초기화 후 Default 채움(비어있지 않음)').not.toBe('');
      expect(afterReset[0][0], '초기화 = Default(저장한 marker와 다름)').not.toBe(marker);
      const s2 = await summary(); expect(s2.total, '초기화 후 전체=경기+홀간').toBe(s2.game + s2.wait);
      // 3) 저장(Default 영속)
      await doSave();
      const s3 = await summary(); expect(s3.total, '재저장 후 전체=경기+홀간').toBe(s3.game + s3.wait);
    },
    // teardown: 원본값 전체 복원 + 저장 (본문 실패와 무관 실행)
    async () => {
      await reenter();
      await writeAll(orig).catch(() => {});
      await saveBtn().click().catch(() => {}); await clickConfirmIfAny(); await admin.waitForTimeout(1200);
      await reenter();
      const restored = await holes.first().locator('input').nth(0).inputValue().catch(() => '');
      console.log('[teardown] 복원 1홀 진행:', restored, '| 원본:', orig[0]?.[0]);
      expect(restored, '원복 후 1홀 진행 = 원본').toBe(orig[0]?.[0]);
    },
  );
});
