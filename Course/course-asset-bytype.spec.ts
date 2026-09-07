import { test, Page, Locator } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { createMaterial, MaterialSpec } from '../lib/course/assetHelpers';
import * as fs from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 파괴적(데이터 생성, 삭제 없음). 장비 분류×장비구분 조합마다 1건 + 자재 분류마다 1건 등록.
//   실행: npm run course:auth → npm run course:asset-bytype
//   명명: 장비 [YS] {분류}_{장비구분}_001 · 자재 [YS] {분류}_001  (선택한 옵션명 그대로 사용)
//   ⚠ 핵심(2026-08-26): 장비 분류는 고정 마스터 + 장비구분 캐스케이드. 필드는 반드시 모달 스코프로 조작
//     (리스트 페이지에도 동일 placeholder '분류 선택' 필터가 있어 unscoped .first()가 오매칭 → 빈 메뉴).
//   거래처: 각 모달 실노출분 라운드로빈(Test 우선). 매입가/내용연수/재고/단위/연료 임의값. 비-teardown(보존).
// ─────────────────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1536, height: 950 } });
const dir = 'reports/_asset-bytype';
const FUELS = ['휘발유', '경유', '기타'];   // '없음'은 등록 실패 관찰 → 제외
const modal = (admin: Page): Locator => admin.locator('.modal-group:not(.alarm)').last();
// 누락 분류만 재등록용 필터(예: ONLY_EQUIP_CATS="측정·진단,기타"). 미설정 시 전체 분류.
const ONLY_EQUIP_CATS = process.env.ONLY_EQUIP_CATS ? new Set(process.env.ONLY_EQUIP_CATS.split(',').map((s) => s.trim()).filter(Boolean)) : null;

// 모달 내 placeholder 필드를 열고 열린 드롭다운(.vs__dropdown-menu, body 텔레포트 가능)의 옵션 텍스트 수집.
async function enumField(admin: Page, ph: string): Promise<string[]> {
  const inp = modal(admin).getByPlaceholder(ph).first();
  if (!(await inp.isVisible({ timeout: 1_500 }).catch(() => false))) return [];
  await inp.click({ timeout: 2_000 }).catch(() => {});
  await admin.waitForTimeout(600);
  const opts = await admin.locator('.vs__dropdown-menu li').allInnerTexts().catch(() => []);
  await admin.keyboard.press('Escape').catch(() => {});
  await admin.waitForTimeout(200);
  return opts.map((s) => s.trim()).filter(Boolean);
}
// 모달 내 placeholder 필드를 열고 텍스트가 일치(exact/contains)하는 옵션 선택.
async function pickField(admin: Page, ph: string, text: string, contains = false): Promise<boolean> {
  const inp = modal(admin).getByPlaceholder(ph).first();
  if (!(await inp.isVisible({ timeout: 1_500 }).catch(() => false))) return false;
  await inp.click({ timeout: 2_000 }).catch(() => {});
  await admin.waitForTimeout(400);
  await inp.fill(text).catch(() => {});   // 검색 가능하면 필터, 아니면 무해
  await admin.waitForTimeout(400);
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = contains ? new RegExp(esc) : new RegExp(`^\\s*${esc}\\s*$`);
  const li = admin.locator('.vs__dropdown-menu li').filter({ hasText: re }).first();
  if (!(await li.isVisible({ timeout: 1_000 }).catch(() => false))) { await admin.keyboard.press('Escape').catch(() => {}); return false; }
  await li.click({ timeout: 1_500 }).catch(() => {});
  await admin.waitForTimeout(400); await killAlarms(admin);
  return true;
}
async function scrollTo(admin: Page, kw: string) {
  await admin.evaluate((k) => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && new RegExp(k).test((e as HTMLElement).innerText || '')); (el as HTMLElement)?.scrollIntoView({ block: 'center' }); }, kw).catch(() => {});
  await admin.waitForTimeout(300);
}
async function openEquipModal(admin: Page) {
  await admin.getByRole('button', { name: /장비등록|장비 등록|신규 등록/ }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_100); await killAlarms(admin);
  const tab = admin.getByRole('button', { name: '단건 등록' }).first();
  if (await tab.isVisible({ timeout: 800 }).catch(() => false)) await tab.click().catch(() => {});
  await admin.waitForTimeout(400);
}
async function closeModal(admin: Page) {
  for (const lbl of ['취소', '닫기']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); break; } }
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);
}
async function submitEquip(admin: Page): Promise<boolean> {
  const reg = modal(admin).getByRole('button', { name: /^등록$/ }).last();
  if (await reg.isVisible({ timeout: 1_000 }).catch(() => false)) { await reg.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
  for (const lbl of ['확인', '예', '등록']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 700 }).catch(() => false)) { await b.click({ timeout: 1_500 }).catch(() => {}); break; } }
  await admin.waitForTimeout(1_200); await killAlarms(admin);
  const still = await modal(admin).filter({ hasText: /장비등록|장비 등록/ }).first().isVisible({ timeout: 800 }).catch(() => false);
  if (still) await closeModal(admin);
  return !still;
}

test('장비 분류×구분 + 자재 분류별 1건씩 등록', async ({ page, context }) => {
  test.setTimeout(1_500_000);
  fs.mkdirSync(dir, { recursive: true });
  const admin = await openCourseAdmin(page, context);
  const out: any = { ts: new Date().toISOString(), equipment: [], material: [], vendors: {}, taxonomy: {} };
  let ei = 0;

  // ═══ 장비: 분류 목록 → 분류별 장비구분 → 조합마다 1건 ═══
  if (!(await gotoCourseMenu(admin, '장비 관리', '장비 총괄').then(() => true).catch(() => false))) { test.skip(true, '장비 총괄 진입 실패'); return; }
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  if (admin.url().includes('/login')) { test.skip(true, '세션 만료'); return; }

  await openEquipModal(admin);
  const eqCats = await enumField(admin, '분류 선택');
  await scrollTo(admin, '거래처');
  const eqVendorsRaw = await enumField(admin, '거래처 선택');
  await closeModal(admin);
  const eqVenPool = eqVendorsRaw.filter((v) => /Test00[1-5]/.test(v));
  const eqVenUse = (eqVenPool.length ? eqVenPool : eqVendorsRaw).slice();
  out.taxonomy.equipmentCategories = eqCats;
  out.vendors.equipment = { available: eqVendorsRaw, used: eqVenUse };
  console.log(`[bytype] 장비 분류 ${eqCats.length}종: ${JSON.stringify(eqCats)}`);
  console.log(`[bytype] 장비 거래처: ${JSON.stringify(eqVendorsRaw)} → 사용 ${JSON.stringify(eqVenUse)}`);

  const eqGubun: Record<string, string[]> = {};
  if (eqCats.length === 0) {
    console.log('[bytype] ⚠ 장비 분류 0종 — 등록 건너뜀(구조/세션 확인). 자재만 진행.');
  } else {
    for (const cat of eqCats) {
      if (ONLY_EQUIP_CATS && !ONLY_EQUIP_CATS.has(cat)) continue;   // 누락 분류만 재등록(예: 측정·진단,기타)
      await openEquipModal(admin);
      let gubuns: string[] = [];
      if (await pickField(admin, '분류 선택', cat)) { await admin.waitForTimeout(400); gubuns = await enumField(admin, '장비선택'); }
      eqGubun[cat] = gubuns;
      console.log(`[bytype]   ${cat} → 구분 ${JSON.stringify(gubuns)}`);
      await closeModal(admin);

      for (const g of gubuns) {
        ei++;
        const name = `[YS] ${cat}_${g}_001`;
        await openEquipModal(admin);
        await modal(admin).getByPlaceholder(/장비명 입력/).first().fill(name).catch(() => {});
        const okCat = await pickField(admin, '분류 선택', cat);
        await admin.waitForTimeout(300);
        const okG = await pickField(admin, '장비선택', g);
        const price = (10 + (ei % 20)) * 1_000_000; const life = 5 + (ei % 5); const hours = 1000 + (ei % 9) * 100;
        const hourly = Math.round(price / (life * hours) / 10) * 10;
        await modal(admin).getByPlaceholder(/매입가 입력/).first().fill(String(price)).catch(() => {});
        await modal(admin).getByPlaceholder(/내용연수 입력/).first().fill(String(life)).catch(() => {});
        await modal(admin).getByPlaceholder(/운용 시간 입력/).first().fill(String(hours)).catch(() => {});
        await modal(admin).getByPlaceholder(/시간당 예상 비용 입력/).first().fill(String(hourly)).catch(() => {});
        await scrollTo(admin, '거래처');
        const vTok = eqVenUse.length ? eqVenUse[(ei - 1) % eqVenUse.length] : '';
        const okV = vTok ? await pickField(admin, '거래처 선택', vTok, true) : false;
        const fuel = FUELS[(ei - 1) % FUELS.length];
        await scrollTo(admin, '사용연료');
        await modal(admin).getByText(fuel, { exact: true }).first().click({ timeout: 1_500 }).catch(() => {});
        if (fuel !== '없음') await modal(admin).getByPlaceholder(/표준연비 입력/).first().fill(String(5 + (ei % 10))).catch(() => {});
        await admin.waitForTimeout(300); await killAlarms(admin);
        const registered = await submitEquip(admin);
        out.equipment.push({ ei, name, cat, gubun: g, okCat, okG, vendor: vTok, okV, fuel, price, registered });
        console.log(`[equip] ${name} · 분류OK=${okCat} 구분OK=${okG} 거래처=${vTok}(${okV}) 연료=${fuel} · 등록=${registered}`);
        await admin.waitForTimeout(500); await killAlarms(admin);
      }
    }
  }
  out.taxonomy.equipmentGubun = eqGubun;
  await admin.screenshot({ path: `${dir}/equip-after.png`, fullPage: true }).catch(() => {});

  // ═══ 자재: 분류마다 1건 ═══
  if (await gotoCourseMenu(admin, '자재 관리', '자재 총괄').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1_500); await killAlarms(admin);
    await admin.getByRole('button', { name: /자재 등록/ }).first().click({ timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_100); await killAlarms(admin);
    const t = admin.getByRole('button', { name: '신규 등록' }).first();
    if (await t.isVisible({ timeout: 800 }).catch(() => false)) await t.click().catch(() => {});
    await admin.waitForTimeout(400);
    const matCats = await enumField(admin, '분류 선택');
    const matUnits = await enumField(admin, '단위 선택');
    await scrollTo(admin, '거래처');
    const matVendorsRaw = await enumField(admin, '거래처 선택');
    await closeModal(admin);
    const matVenPool = matVendorsRaw.filter((v) => /Test00[1-5]/.test(v));
    const matVenTok = (matVenPool[0] || matVendorsRaw[0] || '').match(/Test\s*0*([1-9]\d*)/i);
    const matVendor = matVenTok ? `Test${String(Number(matVenTok[1])).padStart(3, '0')}` : (matVendorsRaw[0] || '');
    out.taxonomy.materialCategories = matCats; out.taxonomy.materialUnits = matUnits;
    out.vendors.material = { available: matVendorsRaw, used: matVendor };
    console.log(`[bytype] 자재 분류 ${JSON.stringify(matCats)} · 단위 ${JSON.stringify(matUnits)} · 거래처 ${JSON.stringify(matVendorsRaw)}→${matVendor}`);

    let mi = 0;
    for (const cat of matCats) {
      mi++;
      const name = `[YS] ${cat}_001`;
      const spec: MaterialSpec = {
        name, category: cat, unitIndex: (mi - 1) % Math.max(1, matUnits.length),
        vendor: matVendor, vendorSearch: matVendor,
        price: (5 + mi) * 100_000, qty: 100 + mi * 10,   // qty = 초기 재고
      };
      const { registered, detail } = await createMaterial(admin, spec);
      out.material.push({ mi, name, ...detail, registered });
      console.log(`[mat] ${name} · 분류 ${detail.category} · 단위 ${detail.unit} · 거래처 ${detail.vendor || '(미선택)'} · 재고 ${spec.qty} · 등록=${registered}`);
      await admin.waitForTimeout(500); await killAlarms(admin);
    }
    await admin.screenshot({ path: `${dir}/material-after.png`, fullPage: true }).catch(() => {});
  } else out.material_error = '자재 총괄 진입 실패';

  fs.writeFileSync(`${dir}/results.json`, JSON.stringify(out, null, 2), 'utf-8');
  const eqOk = out.equipment.filter((r: any) => r.registered).length;
  const matOk = out.material.filter((r: any) => r.registered).length;
  console.log(`\n[bytype] 완료 — 장비 ${eqOk}/${out.equipment.length}(조합) · 자재 ${matOk}/${out.material.length}(분류) · 결과 ${dir}/results.json`);
});
