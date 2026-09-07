import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { createEquipment, createMaterial, EquipmentSpec, MaterialSpec } from '../lib/course/assetHelpers';
import * as fs from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// ⚠ 파괴적(데이터 생성, 삭제 없음). 장비 10건 + 자재 10건 등록 — 단일 로그인 1런.
//   실행: npm run course:auth (헤디드 수동 로그인) → npm run course:asset-bulk
//   명명 규칙: [YS] 장비_Test001~010 / [YS] 자재_Test001~010
//   거래처: Test001~5 사용(각 등록 모달의 실제 노출 거래처만 라운드로빈 — 주요거래항목 필터 대응).
//     ⚠ 거래처 dropdown은 주요거래항목으로 필터됨(장비엔 '장비', 자재엔 '자재' 포함 거래처만). 사전 read로 확인.
//   분류/매입가/내용연수/재고(수량)/단위 등은 임의값. 확정 헬퍼(assetHelpers) 재사용.
//   비-teardown: 생성 데이터는 보존(사용자 요청 = 추가 등록).
// ─────────────────────────────────────────────────────────────────────────────

test.use({ viewport: { width: 1536, height: 950 } });
const dir = 'reports/_asset-bulk';
const pad3 = (n: number) => String(n).padStart(3, '0');
// ⚠ 연료 '없음' 항목은 등록 실패 관찰(2026-08-26 1차 런: fuel='없음'인 i=4,8만 reg=False) → 신뢰 경로만(3종 순환).
const FUELS = ['휘발유', '경유', '기타'];
const EQ_CATS = ['[YS]장비분류1', '[YS]장비분류2', '[YS]장비분류3'];   // taggable 신규 생성(3종 순환)
// 재시도/부분등록 타깃: ONLY_EQUIP="4,8"(해당 i만 장비 등록) · SKIP_EQUIP=1 · SKIP_MATERIAL=1 · ONLY_MATERIAL="..".
const parseOnly = (v?: string) => (v ? new Set(v.split(',').map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 10)) : null);
const ONLY_EQUIP = parseOnly(process.env.ONLY_EQUIP);
const ONLY_MATERIAL = parseOnly(process.env.ONLY_MATERIAL);
const SKIP_EQUIP = process.env.SKIP_EQUIP === '1';
const SKIP_MATERIAL = process.env.SKIP_MATERIAL === '1';

// 등록 모달을 열어 거래처 dropdown에 실제 노출되는 Test00N 옵션을 읽고 모달을 닫음(비생성).
//   반환: 정규화된 토큰 배열(예 ['Test001','Test005']). 필터로 일부만 노출될 수 있음.
async function readAvailableVendors(admin: Page, openBtnRe: RegExp, tabNameRe: RegExp): Promise<{ tokens: string[]; raw: string[] }> {
  await admin.getByRole('button', { name: openBtnRe }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_200); await killAlarms(admin);
  const tab = admin.getByRole('button', { name: tabNameRe }).first();
  if (await tab.isVisible({ timeout: 900 }).catch(() => false)) await tab.click().catch(() => {});
  await admin.waitForTimeout(400);
  // 거래처 영역으로 스크롤
  await admin.evaluate(() => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /거래처/.test((e as HTMLElement).innerText || '')); (el as HTMLElement)?.scrollIntoView({ block: 'center' }); }).catch(() => {});
  let raw: string[] = [];
  const inp = admin.getByPlaceholder('거래처 선택').first();
  if (await inp.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await inp.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(700);
    raw = await admin.locator('.vs__dropdown-menu li').allInnerTexts().catch(() => []);
    await admin.keyboard.press('Escape').catch(() => {});
  }
  // 모달 닫기(비생성)
  for (const lbl of ['취소', '닫기']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 600 }).catch(() => false)) { await b.click().catch(() => {}); break; } }
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin);
  // Test00N 토큰 추출·정규화·정렬·중복제거
  const tokens = Array.from(new Set(
    raw.map((s) => (s.match(/Test\s*0*([1-9]\d*)/i) || [])[1]).filter(Boolean).map((n) => `Test${pad3(Number(n))}`),
  )).sort();
  return { tokens, raw: raw.map((s) => s.trim()).filter(Boolean) };
}

test('장비 10건 + 자재 10건 등록(단일 로그인)', async ({ page, context }) => {
  test.setTimeout(900_000);
  fs.mkdirSync(dir, { recursive: true });
  const admin: Page = await openCourseAdmin(page, context);
  const out: any = { ts: new Date().toISOString(), equipment: [], material: [], vendors: {} };

  // ═══ 장비 10건 ═══
  if (!SKIP_EQUIP) {
    if (!(await gotoCourseMenu(admin, '장비 관리', '장비 총괄').then(() => true).catch(() => false))) { test.skip(true, '장비 총괄 진입 실패(세션 확인)'); return; }
    await admin.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await admin.waitForTimeout(1_500); await killAlarms(admin);
    if (admin.url().includes('/login')) { test.skip(true, '세션 만료'); return; }

    const eqVen = await readAvailableVendors(admin, /장비등록|장비 등록|신규 등록/, /단건 등록/);
    const eqPool = eqVen.tokens.filter((t) => /Test00[1-5]/.test(t));   // 요청: Test001~5
    out.vendors.equipment = { available: eqVen.tokens, used: eqPool, raw: eqVen.raw };
    console.log(`[bulk] 장비 거래처 노출: ${JSON.stringify(eqVen.tokens)} → 사용 ${JSON.stringify(eqPool)}`);

    for (let i = 1; i <= 10; i++) {
      if (ONLY_EQUIP && !ONLY_EQUIP.has(i)) continue;
      const vendor = eqPool.length ? eqPool[(i - 1) % eqPool.length] : undefined;
      const spec: EquipmentSpec = {
        name: `[YS] 장비_Test${pad3(i)}`, category: EQ_CATS[(i - 1) % EQ_CATS.length], brand: `YS_${pad3(i)}`,
        vendor, price: (10 + i) * 1_000_000, life: 5 + (i % 5), hours: 1000 + i * 100,
        fuel: FUELS[(i - 1) % FUELS.length], mileage: 5 + i,
      };
      const { registered, detail } = await createEquipment(admin, spec);
      out.equipment.push({ i, ...detail, vendorReq: vendor, registered });
      console.log(`[equip] ${spec.name} · 분류 ${detail.category} · 거래처 ${detail.vendor || '(미선택)'} · 연료 ${spec.fuel} · 등록=${registered}`);
      await admin.waitForTimeout(700); await killAlarms(admin);
    }
    await admin.screenshot({ path: `${dir}/equip-after.png`, fullPage: true }).catch(() => {});
  }

  // ═══ 자재 10건 ═══
  if (!SKIP_MATERIAL) {
    if (!(await gotoCourseMenu(admin, '자재 관리', '자재 총괄').then(() => true).catch(() => false))) { test.skip(true, '자재 총괄 진입 실패'); return; }
    await admin.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
    await admin.waitForTimeout(1_500); await killAlarms(admin);

    const matVen = await readAvailableVendors(admin, /자재 등록/, /신규 등록/);
    const matPool = matVen.tokens.filter((t) => /Test00[1-5]/.test(t));
    out.vendors.material = { available: matVen.tokens, used: matPool, raw: matVen.raw };
    console.log(`[bulk] 자재 거래처 노출: ${JSON.stringify(matVen.tokens)} → 사용 ${JSON.stringify(matPool)}`);

    for (let i = 1; i <= 10; i++) {
      if (ONLY_MATERIAL && !ONLY_MATERIAL.has(i)) continue;
      const token = matPool.length ? matPool[(i - 1) % matPool.length] : 'Test005';
      const spec: MaterialSpec = {
        name: `[YS] 자재_Test${pad3(i)}`, categoryIndex: (i - 1) % 7, unitIndex: (i - 1) % 5,
        vendor: token, vendorSearch: token,
        price: (5 + i) * 100_000, qty: 100 + i * 10,   // qty = 초기 재고
      };
      const { registered, detail } = await createMaterial(admin, spec);
      out.material.push({ i, ...detail, vendorReq: token, registered });
      console.log(`[mat] ${spec.name} · 분류 ${detail.category} · 단위 ${detail.unit} · 거래처 ${detail.vendor || '(미선택)'} · 재고 ${spec.qty} · 등록=${registered}`);
      await admin.waitForTimeout(700); await killAlarms(admin);
    }
    await admin.screenshot({ path: `${dir}/material-after.png`, fullPage: true }).catch(() => {});
  }

  // 이전 실행 결과와 병합(부분 재시도 시 이름 기준 갱신) → results.json = 누적 최신 상태.
  const mergeByName = (prev: any[], next: any[]) => { const m = new Map<string, any>(); for (const r of prev || []) m.set(r.name, r); for (const r of next) m.set(r.name, r); return [...m.values()].sort((a, b) => (a.i || 0) - (b.i || 0)); };
  let prev: any = {};
  try { if (fs.existsSync(`${dir}/results.json`)) prev = JSON.parse(fs.readFileSync(`${dir}/results.json`, 'utf-8')); } catch { /* noop */ }
  const merged = {
    ts: out.ts,
    vendors: { ...(prev.vendors || {}), ...out.vendors },
    equipment: mergeByName(prev.equipment, out.equipment),
    material: mergeByName(prev.material, out.material),
  };
  fs.writeFileSync(`${dir}/results.json`, JSON.stringify(merged, null, 2), 'utf-8');
  const eqOk = merged.equipment.filter((r: any) => r.registered).length;
  const matOk = merged.material.filter((r: any) => r.registered).length;
  console.log(`\n[bulk] 이번 런 — 장비 ${out.equipment.filter((r: any) => r.registered).length}/${out.equipment.length} · 자재 ${out.material.filter((r: any) => r.registered).length}/${out.material.length} 등록`);
  console.log(`[bulk] 누적(병합) — 장비 ${eqOk}/${merged.equipment.length} · 자재 ${matOk}/${merged.material.length} · 결과 ${dir}/results.json`);
});
