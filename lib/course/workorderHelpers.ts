import { Page } from '@playwright/test';
import { killAlarms } from './courseHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// 코스관리 작업 지시(작업 관리 > 작업 지시) 등록/수정 공용 헬퍼.
//   ~15회 프로브로 확정(2026-08-26). 메모리 course-workorder-invest 참조.
//   핵심 함정:
//    ① 기타 섹션 카드(장비/농약/비료/기타자재/외부장비) 투입 picker는 카드·제목 클릭 무반응 →
//       우측 셰브론 `.ico-right.cursor-pointer`(nth 0~4=카드 순서) 클릭으로만 열림.
//    ② 자재는 등록 분류에 따라 카드로 분산(농약/비료/기타자재) → 자재 투입은 셰브론 nth(1~4)를 전부 훑어 선택.
//    ③ picker 등록 버튼은 DOM 마지막 → getByRole('button',{name:/^등록$/}).last().
//    ④ vue-select은 값이 차면 placeholder가 사라져 중복 placeholder의 nth 인덱스가 바뀜.
//    ⑤ 필수: 작업명(자동) · 1분류 · 고정직 조장 · 작업 유형(단일/반복) · 작업 위치("작업장소 해당사항 없음" 체크로 우회).
// ─────────────────────────────────────────────────────────────────────────────

export interface PickResult { picked: string; opts: string[]; }

/** vue-select을 placeholder로 특정 → 텍스트로 선택(exact 우선, 없으면 contains). 값 채워지면 placeholder 사라지는 함정 주의(nth 사용 시). */
export async function pickVSByText(admin: Page, placeholder: string, text: string, opts: { nth?: number; typeSearch?: boolean } = {}): Promise<PickResult> {
  const vs = admin.locator('.v-select').filter({ has: admin.locator(`input[placeholder="${placeholder}"]`) }).nth(opts.nth ?? 0);
  if (!(await vs.isVisible({ timeout: 1_500 }).catch(() => false))) return { picked: '(vs없음)', opts: [] };
  await vs.locator('.vs__dropdown-toggle').click({ timeout: 2_000 }).catch(() => {});
  await admin.waitForTimeout(500);
  if (opts.typeSearch) { const inp = vs.locator('input.vs__search, input').first(); await inp.fill(text).catch(() => {}); await admin.waitForTimeout(700); }
  const optionTexts = await admin.locator('.vs__dropdown-menu li').allInnerTexts().catch(() => [] as string[]);
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exact = admin.locator('.vs__dropdown-menu li').filter({ hasText: new RegExp(`^\\s*${esc}\\s*$`) }).first();
  const contains = admin.locator('.vs__dropdown-menu li').filter({ hasText: text }).first();
  let picked = '(미발견)';
  if (await exact.isVisible({ timeout: 700 }).catch(() => false)) { picked = (await exact.innerText().catch(() => '')).trim(); await exact.click({ timeout: 1_500 }).catch(() => {}); }
  else if (await contains.isVisible({ timeout: 700 }).catch(() => false)) { picked = (await contains.innerText().catch(() => '')).trim(); await contains.click({ timeout: 1_500 }).catch(() => {}); }
  else await admin.keyboard.press('Escape').catch(() => {});
  await admin.waitForTimeout(400); await killAlarms(admin);
  return { picked, opts: optionTexts.slice(0, 20) };
}

/** 작업 분류 1/2/3 캐스케이드 선택(예: 그린>잔디보식>점적). */
export async function pickCategories(admin: Page, c1: string, c2?: string, c3?: string): Promise<string[]> {
  const out: string[] = [];
  out.push((await pickVSByText(admin, '1분류 선택', c1)).picked);
  if (c2) out.push((await pickVSByText(admin, '2분류 선택', c2)).picked);
  if (c3) out.push((await pickVSByText(admin, '3분류 선택', c3)).picked);
  return out;
}

/** 기타 카드 셰브론 인덱스(카드 순서). */
export const INVEST_CARD = { equip: 0, pesticide: 1, fertilizer: 2, etcMaterial: 3, external: 4 } as const;

/** 기타 카드 셰브론(idx) 클릭 → picker 열림 확인(expectTitle 가시). */
export async function openInvestCard(admin: Page, idx: number, expectTitle = '선택'): Promise<boolean> {
  const chev = admin.locator('.ico-right.cursor-pointer').nth(idx);
  if (!(await chev.count().catch(() => 0))) return false;
  await chev.scrollIntoViewIfNeeded().catch(() => {});
  await chev.click({ timeout: 2_500 }).catch(() => {});
  await admin.waitForTimeout(1_300); await killAlarms(admin);
  return admin.getByText(expectTitle, { exact: false }).first().isVisible({ timeout: 1_500 }).catch(() => false);
}

export interface PickerSelectResult { selected: Array<{ name: string; found: boolean; before?: boolean; after?: boolean; stock?: number; qty?: number }>; total: number | null; }

/** 열린 picker에서 names 항목 체크 + (withQty)투입량=floor(재고×pct). "선택 총 N" 반환. */
export async function selectInPicker(admin: Page, names: string[], withQty: boolean, pct: number): Promise<PickerSelectResult> {
  return await admin.evaluate(({ names, withQty, pct }) => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e as HTMLElement); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const totalEls = [...document.querySelectorAll('*')].filter((e) => /선택 총\s*\d+\s*개/.test((e as HTMLElement).innerText || '') && vis(e));
    const picker = totalEls.length ? (totalEls[totalEls.length - 1].closest('[class*="modal"], [class*="popup"], [class*="layer"]') as HTMLElement || document.body) : document.body;
    const setVal = (inp: HTMLInputElement, v: string) => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!; setter.call(inp, v); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
    const out: any[] = [];
    for (const name of names) {
      const nameEl = ([...picker.querySelectorAll('*')].find((e) => { const it = (e as HTMLElement).innerText || ''; return it.replace(/\s+/g, ' ').trim() === name && (e as HTMLElement).children.length === 0; }) as HTMLElement)
        || ([...picker.querySelectorAll('*')].find((e) => ((e as HTMLElement).innerText || '').includes(name) && (e as HTMLElement).innerText.length < 40) as HTMLElement);
      if (!nameEl) { out.push({ name, found: false }); continue; }
      let row: HTMLElement | null = nameEl;
      for (let i = 0; i < 8 && row; i++) { if (row.querySelector('input[type=checkbox]')) break; row = row.parentElement; }
      if (!row) { out.push({ name, found: true, row: false }); continue; }
      const cb = row.querySelector('input[type=checkbox]') as HTMLInputElement | null;
      const before = cb?.checked;
      if (cb && !cb.checked) { const visual = (row.querySelector('.checkbox, .check-icon, label[for], label') as HTMLElement) || cb; visual.click(); if (!cb.checked) cb.click(); }
      let stock = 0, qty = 0;
      if (withQty) {
        const m = (row.innerText || '').match(/재고\s*([\d,]+)/); stock = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
        qty = Math.max(1, Math.floor(stock * pct));
        const qi = [...row.querySelectorAll('input')].find((i) => /투입량|수량/.test(i.getAttribute('placeholder') || '')) as HTMLInputElement | undefined;
        if (qi) setVal(qi, String(qty));
      }
      out.push({ name, found: true, before, after: cb?.checked, stock, qty });
    }
    const tm = (picker.innerText || '').match(/선택 총\s*(\d+)\s*개/);
    return { selected: out, total: tm ? +tm[1] : null };
  }, { names, withQty, pct }).catch((e) => ({ selected: [], total: null, error: String(e) } as any));
}

/** picker 등록(오버레이가 DOM 마지막이라 .last()). */
export async function pickerRegister(admin: Page): Promise<void> {
  const reg = admin.getByRole('button', { name: /^등록$/ }).last();
  if (await reg.isVisible({ timeout: 1_000 }).catch(() => false)) { await reg.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin); }
}
/** picker 취소(비선택 시). */
export async function pickerCancel(admin: Page): Promise<void> {
  const cancel = admin.getByRole('button', { name: /^취소$/ }).last();
  if (await cancel.isVisible({ timeout: 700 }).catch(() => false)) await cancel.click({ timeout: 1_200 }).catch(() => {});
  await admin.waitForTimeout(500);
}

/** 장비 투입: 셰브론 nth(0) → 장비명 배열 전부 체크 → 등록. */
export async function investEquipment(admin: Page, equipNames: string[]): Promise<PickerSelectResult | null> {
  if (!equipNames.length) return null;
  if (!(await openInvestCard(admin, INVEST_CARD.equip, '장비 선택'))) return null;
  const sel = await selectInPicker(admin, equipNames, false, 0);
  const any = sel.selected.some((s) => s.found && s.after);
  if (any) await pickerRegister(admin); else await pickerCancel(admin);
  return sel;
}

/** 자재 투입: 셰브론 nth(1~4)를 전부 훑어(분류 분산 대응) 자재명 체크 + 투입량=재고×pct → 카드별 등록. */
export async function investMaterials(admin: Page, materialNames: string[], pct = 0.2): Promise<Array<{ idx: number; sel: PickerSelectResult }>> {
  const results: Array<{ idx: number; sel: PickerSelectResult }> = [];
  if (!materialNames.length) return results;
  for (let idx = 1; idx <= 4; idx++) {
    if (!(await openInvestCard(admin, idx, '선택'))) { continue; }
    const sel = await selectInPicker(admin, materialNames, true, pct);
    const any = sel.selected.some((s) => s.found && s.after);
    if (any) await pickerRegister(admin); else await pickerCancel(admin);
    results.push({ idx, sel });
  }
  return results;
}

/** 열린 picker에서 이름 무관 '첫 N개' 사용가능 항목을 체크(+material qty). 자산명 의존 제거(1~5건 가변 투입용).
 *  select-all 오클릭 방지: 데이터 leaf 텍스트에서 시작해 상위 체크박스로 올라감(thead 체크박스는 제외). */
export async function investFirstInCard(admin: Page, cardIdx: number, count: number, withQty: boolean, pct = 0.2): Promise<{ checked: number; total: number | null; names: string[] }> {
  if (count <= 0) return { checked: 0, total: null, names: [] };
  const expectTitle = cardIdx === INVEST_CARD.equip ? '장비 선택' : '선택';
  if (!(await openInvestCard(admin, cardIdx, expectTitle))) return { checked: 0, total: null, names: [] };
  const res = await admin.evaluate(({ count, withQty, pct }) => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e as HTMLElement); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const totalEls = [...document.querySelectorAll('*')].filter((e) => /선택 총\s*\d+\s*개/.test((e as HTMLElement).innerText || '') && vis(e));
    const picker = totalEls.length ? (totalEls[totalEls.length - 1].closest('[class*="modal"], [class*="popup"], [class*="layer"]') as HTMLElement || document.body) : document.body;
    const setVal = (inp: HTMLInputElement, v: string) => { const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!; setter.call(inp, v); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
    const SKIP = /^(전체|전체\s*선택|선택|재고|투입량|수량|등록|취소|검색|닫기|장비\s*선택|자재\s*선택|선택\s*총|단위|분류|번호|no\.?|명칭|재고량)$/i;
    const leaves = [...picker.querySelectorAll('*')].filter((e) => (e as HTMLElement).children.length === 0 && vis(e)) as HTMLElement[];
    const names: string[] = []; let checked = 0; const usedRows = new Set<Element>();
    for (const el of leaves) {
      if (checked >= count) break;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 40 || SKIP.test(t) || /^[\d,.\s원개%]+$/.test(t)) continue;
      let row: HTMLElement | null = el;
      for (let i = 0; i < 8 && row; i++) { if (row.querySelector && row.querySelector('input[type=checkbox]')) break; row = row.parentElement; }
      if (!row || !row.querySelector) continue;
      const cb = row.querySelector('input[type=checkbox]') as HTMLInputElement | null;
      if (!cb || cb.closest('thead')) continue;   // thead 체크박스=select-all 제외
      if (usedRows.has(row)) continue;
      if (cb.checked) { usedRows.add(row); continue; }
      const visual = (row.querySelector('.checkbox, .check-icon, label[for], label') as HTMLElement) || cb;
      visual.click(); if (!cb.checked) cb.click();
      if (!cb.checked) continue;
      usedRows.add(row); names.push(t);
      if (withQty) {
        const rt = row.innerText || ''; const m = rt.match(/재고\s*([\d,]+)/); const stock = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
        const qty = Math.max(1, Math.floor(stock * pct) || 1);
        const qi = [...row.querySelectorAll('input')].find((i) => /투입량|수량/.test(i.getAttribute('placeholder') || '')) as HTMLInputElement | undefined;
        if (qi) setVal(qi, String(qty));
      }
      checked++;
    }
    const tm = (picker.innerText || '').match(/선택 총\s*(\d+)\s*개/);
    return { checked, total: tm ? +tm[1] : null, names };
  }, { count, withQty, pct }).catch((e) => ({ checked: 0, total: null, names: [], error: String(e) } as any));
  if (res.checked > 0) await pickerRegister(admin); else await pickerCancel(admin);
  return res;
}

/** 장비 카드(0)에서 첫 N개 장비 투입. */
export async function investEquipmentFirst(admin: Page, count: number): Promise<{ checked: number; names: string[] }> {
  const r = await investFirstInCard(admin, INVEST_CARD.equip, count, false, 0);
  return { checked: r.checked, names: r.names };
}

/** 자재 카드(1~4, 분류 분산)를 훑어 누계 N개까지 자재 투입(투입량=재고×pct). */
export async function investMaterialsFirst(admin: Page, count: number, pct = 0.2): Promise<{ checked: number; names: string[] }> {
  let remaining = count; const names: string[] = [];
  for (let idx = 1; idx <= 4 && remaining > 0; idx++) {
    const r = await investFirstInCard(admin, idx, remaining, true, pct);
    remaining -= r.checked; names.push(...r.names);
  }
  return { checked: count - remaining, names };
}

/** 작업 유형(단일/반복) + 작업 위치("작업장소 해당사항 없음" 체크로 우회) — 필수 통과. */
export async function fillWorkorderRequired(admin: Page, workType: '단일' | '반복' = '단일'): Promise<void> {
  const scrollTo = async (kw: string) => admin.evaluate((k) => { const h = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && new RegExp(k).test((e as HTMLElement).innerText || '')); (h as HTMLElement)?.scrollIntoView({ block: 'start' }); }, kw).catch(() => {});
  await scrollTo('작업일시'); await admin.waitForTimeout(400);
  const typeLabel = workType === '단일' ? '단일 작업' : '반복 작업';
  const t = admin.getByText(typeLabel, { exact: false }).first();
  if (await t.isVisible({ timeout: 1_500 }).catch(() => false)) { await t.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(500); }
  await scrollTo('작업 위치'); await admin.waitForTimeout(400);
  const noLoc = admin.getByText('작업장소 해당사항 없음', { exact: false }).first();
  if (await noLoc.isVisible({ timeout: 1_500 }).catch(() => false)) { await noLoc.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(500); }
  await killAlarms(admin);
}

export interface WorkorderSpec {
  name?: string;                 // 작업명(미지정 시 분류 자동)
  categories: [string, string?, string?];  // 1/2/3분류
  fixedLead?: string;            // 고정직/장기 조장(필수)
  fixedMembers?: string[];       // 고정직/장기 조원(복수)
  tempLead?: string;             // 단기 임시직 조장
  tempMembers?: string[];        // 단기 임시직 조원(복수)
  equipment?: string[];          // 장비명(장비 카드)
  materials?: string[];          // 자재명(농약/비료/기타자재 카드 자동 분산)
  materialPct?: number;          // 자재 투입량 = 재고×pct (기본 0.2)
  workType?: '단일' | '반복';
}

/** 작업 지시 신규 등록 모달을 열고 스펙대로 채운 뒤 등록. 리스트 등장 여부 반환. (모달은 호출 전 '신규 작업 지시 등록' 클릭으로 열려 있어야 함) */
export async function fillAndRegisterWorkorder(admin: Page, spec: WorkorderSpec): Promise<{ report: any }> {
  const R: any = { spec: { name: spec.name, categories: spec.categories } };
  if (spec.name) await admin.getByPlaceholder('작업명 입력').first().fill(spec.name).catch(() => {});
  R.categories = await pickCategories(admin, spec.categories[0], spec.categories[1], spec.categories[2]);
  // 참여자(빈 폼 기준 nth: 고정직 조원=0, 단기 조원=1)
  if (spec.fixedLead) R.fixedLead = (await pickVSByText(admin, '조장 선택(필수)', spec.fixedLead)).picked;
  for (const m of spec.fixedMembers ?? []) await pickVSByText(admin, '조원 선택(복수 선택)', m, { nth: 0, typeSearch: true });
  if (spec.tempLead) R.tempLead = (await pickVSByText(admin, '조장 선택', spec.tempLead)).picked;
  for (const m of spec.tempMembers ?? []) await pickVSByText(admin, '조원 선택(복수 선택)', m, { nth: 1, typeSearch: true });

  await fillWorkorderRequired(admin, spec.workType ?? '단일');

  R.equip = await investEquipment(admin, spec.equipment ?? []);
  R.materials = await investMaterials(admin, spec.materials ?? [], spec.materialPct ?? 0.2);

  // 최종 등록
  const regBtn = admin.getByRole('button', { name: /^등록$/ }).last();
  if (await regBtn.isVisible({ timeout: 1_000 }).catch(() => false)) { await regBtn.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
  for (const lbl of ['확인', '예', '등록']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 800 }).catch(() => false)) { await b.click({ timeout: 1_500 }).catch(() => {}); break; } }
  await admin.waitForTimeout(2_500); await killAlarms(admin);
  if (spec.name) R.listed = await admin.getByText(spec.name, { exact: false }).first().isVisible({ timeout: 3_000 }).catch(() => false);
  return { report: R };
}
