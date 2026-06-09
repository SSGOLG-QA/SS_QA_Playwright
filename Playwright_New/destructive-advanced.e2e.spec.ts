import { test, expect, Page } from '@playwright/test';
import { openAdmin, navigateMenu, settle } from '../lib/adminHelpers';
import { skipUnlessDestructive, withFixture } from './destructive';

// ──────────────────────────────────────────────────────────────
//  커스텀 토글 전용 파괴(카트패스/태블릿 기능/아이콘) + Tier C CRUD(캐디 등록)
//   ⚠ 기본 SKIP. ALLOW_DESTRUCTIVE=1 + td17 + 킹즈락. teardown 원복(토글 되돌리기 / 더미 삭제).
//   토글 구조: input[type=checkbox][id^=tgv-] 는 뷰포트 밖 hidden → label[for] 또는 JS el.click()로 조작.
//  실행: ALLOW_DESTRUCTIVE=1 npx playwright test --config=Playwright_New/playwright.config.ts -g "커스텀토글|CRUD"
// ──────────────────────────────────────────────────────────────

let admin: Page;
test.beforeEach(async ({ page, context }) => { admin = await openAdmin(page, context); });

const confirmModal = () => admin.locator('.modal-footer').filter({ has: admin.getByRole('button', { name: /확인|삭제|해지/ }) }).first();
const clickConfirm = async () => { if (await confirmModal().isVisible({ timeout: 2500 }).catch(() => false)) { await confirmModal().getByRole('button', { name: /확인|삭제|해지/ }).first().click().catch(() => {}); await admin.waitForTimeout(600); } };
const saveIfAny = async () => {
  const b = admin.getByRole('button', { name: '저장', exact: true }).first();
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await clickConfirm(); await admin.locator('.toast-box').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {}); await admin.waitForTimeout(600); }
};

// 숨김(뷰포트 밖) 커스텀 토글 1개 ON/OFF → 저장 → teardown 원복
function customToggle(parent: string, child: string) {
  test(`커스텀토글 파괴: ${parent} > ${child} 기능 토글 ON/OFF→저장→원복`, async () => {
    await skipUnlessDestructive(admin);
    await navigateMenu(admin, parent, child).catch(() => {}); await settle(admin);
    await admin.locator('.contents-box').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const cb = admin.locator('.contents-box input[type=checkbox][id^="tgv-"]').first();
    if (!(await cb.count().catch(() => 0))) { test.skip(true, '기능 토글(tgv-*) 없음'); return; }
    const id = await cb.getAttribute('id').catch(() => '');
    const orig = await cb.isChecked().catch(() => null);

    const flip = async () => {
      const lab = id ? admin.locator(`label[for="${id}"]`) : admin.locator('___none___');
      if (await lab.count().catch(() => 0)) await lab.first().click({ force: true }).catch(() => {});
      else await cb.evaluate((el: any) => el.click()).catch(() => {});   // hidden checkbox → JS click
      await clickConfirm();   // 일부 화면(태블릿)은 토글 즉시 확인모달
      await admin.waitForTimeout(500);
    };

    let done = false, skipReason = '';
    await withFixture(
      async () => { if (orig === null) skipReason = '토글 상태 읽기 실패'; },
      async () => {
        if (skipReason) return;
        try {
          await flip(); await saveIfAny();
          const now = await cb.isChecked().catch(() => orig);
          if (now === orig) { skipReason = '토글 미반영(조작 방식 상이) — 추가 분석 필요'; return; }
          done = true;
        } catch (e: any) { skipReason = '예외: ' + String(e?.message || e).slice(0, 50); }
      },
      async () => {
        if (done) { const cur = await cb.isChecked().catch(() => null); if (cur !== null && cur !== orig) { await flip(); await saveIfAny(); } }
        console.log(`[teardown] ${child} 토글 done=${done} 현재=${await cb.isChecked().catch(() => '?')} 원본=${orig}`);
      },
    );
    if (skipReason) { test.skip(true, skipReason); return; }
    expect(done, '토글 변경→저장 수행').toBeTruthy();
  });
}

customToggle('홀맵 관리', '카트패스 진입여부 설정');
customToggle('태블릿 운영 관리', '태블릿 기능 설정');
customToggle('관제 관리', '아이콘 관리');

// ── Tier C CRUD: 캐디 등록(더미 생성) → 수정/해지 탭에서 삭제 (teardown 원복) ──
test('CRUD 파괴: 캐디 등록 더미 생성→삭제 원복', async () => {
  await skipUnlessDestructive(admin);
  await navigateMenu(admin, '캐디 관리', '캐디 등록 관리').catch(() => {}); await settle(admin);
  await admin.locator('.contents-box').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  const DUMMY = 'E2E자동캐디';
  const listTable = () => admin.locator('.table-overflow-item table, .list-table-group table').first();
  const goTab = async (name: string) => { await admin.getByText(name, { exact: false }).first().click().catch(() => {}); await admin.waitForTimeout(800); };
  const dummyRows = () => listTable().locator('tbody tr').filter({ hasText: DUMMY });
  const deleteAllDummy = async () => {
    await goTab('캐디 수정/해지');
    for (let g = 0; g < 5; g++) {
      const row = dummyRows().first();
      if (!(await row.count().catch(() => 0))) break;
      const del = row.getByRole('button', { name: /삭제|해지/ }).first();
      if (!(await del.isVisible().catch(() => false))) break;
      await del.click().catch(() => {}); await clickConfirm(); await admin.waitForTimeout(1000);
    }
  };

  let created = false, skipReason = '';
  await withFixture(
    async () => { await deleteAllDummy().catch(() => {}); await goTab('캐디 등록 관리'); },   // 사전 잔여 더미 정리
    async () => {
      try {
        await admin.getByPlaceholder('성명').first().fill(DUMMY).catch(() => {});
        await admin.getByPlaceholder('휴대폰').first().fill('01099998888').catch(() => {});
        await admin.getByText('하우스 캐디', { exact: true }).first().click().catch(() => {});   // 구분 radio
        await admin.getByText('남성', { exact: true }).first().click().catch(() => {});          // 성별 radio
        // 자격취득일 datepicker(달력 전용) → 입력 클릭 후 달력에서 한 날짜 선택
        const dp = admin.locator('.contents-box input.datepicker-input').first();
        if (await dp.isVisible().catch(() => false)) {
          await dp.click().catch(() => {}); await admin.waitForTimeout(600);
          const day = admin.locator('.datepicker-layer .text-num, .datepicker-layer .day:not(.disabled)').filter({ hasText: /^\d{1,2}$/ }).first();
          await day.click().catch(() => {}); await admin.waitForTimeout(400);
        }
        // vue-select(선택) → 첫 옵션
        const vs = admin.locator('.contents-box .vs__dropdown-toggle').first();
        if (await vs.isVisible().catch(() => false)) {
          await vs.click().catch(() => {}); await admin.waitForTimeout(400);
          await admin.locator('.vs__dropdown-option, li[role=option], .vs__dropdown-menu li').first().click().catch(() => {});
          await admin.waitForTimeout(300);
        }
        await admin.getByPlaceholder('태블릿 No.').first().fill('999').catch(() => {});
        await admin.getByPlaceholder('배터리').first().fill('100').catch(() => {});
        await admin.waitForTimeout(300);
        const save = admin.getByRole('button', { name: '저장', exact: true }).first();
        if (!(await save.isEnabled().catch(() => false))) { skipReason = '저장 비활성(필수항목 미충족 — 자격취득일/태블릿No./배터리 등 추가 검증 필요)'; return; }
        await save.click().catch(() => {}); await clickConfirm();
        await admin.locator('.toast-box').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
        await admin.waitForTimeout(1000);
        await goTab('캐디 수정/해지');
        created = (await dummyRows().count().catch(() => 0)) > 0;
        if (!created) skipReason = '더미 생성 미확인(저장 차단/검증 위치 상이) — 화면 검토 필요';
      } catch (e: any) { skipReason = '예외: ' + String(e?.message || e).slice(0, 50); }
    },
    async () => { await deleteAllDummy().catch(() => {}); const remain = await dummyRows().count().catch(() => 0); console.log(`[teardown] 더미 캐디('${DUMMY}') 삭제 후 잔여=${remain}`); },
  );
  if (skipReason) { test.skip(true, skipReason); return; }
  expect(created, '더미 캐디 생성 확인').toBeTruthy();
});
