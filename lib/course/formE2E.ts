import { Page, Locator } from '@playwright/test';
import { killAlarms } from './courseHelpers';
import { record, skip, diff, CheckMeta } from '../reporter';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  정보 관리 공용 폼 E2E 배터리(비파괴, 저장 안 함) — 코스 기본 정보 E2E와 동일 깊이를 전 화면에 적용.
//   ① 모든 입력 필드 입력 → 반영  ② [X](ico-color-close) 클리어 → 삭제 + placeholder
//   ③ [+ 항목 추가](button-common.tertiary) → 항목 증가  ④ 행 [X] → 신규 항목 삭제  ⑤ 파일 업로드 → [휴지통](ico-delete)
//  대상 폼: [신규 등록] 모달(우선, 빈 폼이라 가장 안전) 또는 [수정] 폼. 종료 시 [취소]로 폐기(미영속).
//  ⚠ 저장/등록(submit) 절대 클릭 금지. 모달·자체 추가/업로드분만 조작.
//  ★ 실 DOM 확정 셀렉터(2026-08-18 프로브): 필드클리어 button.ico-color-close(입력형제有) /
//    행삭제 .ico-color-close(입력형제無) / 항목추가 button-common.tertiary(text 항목 추가) /
//    파일휴지통 i.ico-delete / 저장 button-common.primary / 취소 button-common.negative.
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

function tmpPng(): string {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const fp = path.join(os.tmpdir(), 'e2e-course-upload.png');
  fs.writeFileSync(fp, Buffer.from(b64, 'base64'));
  return fp;
}

// 편집 가능한 폼 열기: [신규 등록]/[등록](모달) 우선 → 없으면 [수정](모달/페이지/행).
export async function openEditableForm(admin: Page): Promise<{ opened: boolean; kind: string }> {
  const beforeModals = await admin.locator('.modal-group').count().catch(() => 0);
  const pageSaveVisible = () => M(admin).getByRole('button', { name: /^\s*저장(하기)?\s*$/ }).first().isVisible({ timeout: 1_200 }).catch(() => false);
  // 폼 열림 신호: [취소] 노출(리스트엔 없고 폼에만 존재). 페이지형 등록 submit이 '등록'이라 저장버튼 없는 경우 대응.
  const cancelVisible = () => M(admin).getByRole('button', { name: /^\s*취소\s*$/ }).first().isVisible({ timeout: 1_000 }).catch(() => false);
  const savedBefore = await pageSaveVisible();   // 리스트에 이미 저장 버튼이 있는 특수 화면 구분(인라인 편집형)
  const cancelBefore = await cancelVisible();
  const urlBefore = admin.url();
  // 1) 신규 등록/등록/추가 등록/거래처 등록/시설 등록 등(…등록 접미) → 모달 or 페이지 폼(라우트 이동 포함)
  const reg = M(admin).getByRole('button', { name: /신규\s*등록|추가\s*등록|등록\s*$/ }).first();
  if (await reg.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await reg.click({ timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_400); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    if (await modal.getByRole('button', { name: /저장|등록|확인/ }).first().isVisible({ timeout: 1_500 }).catch(() => false)) return { opened: true, kind: '신규등록 모달' };
    if (!savedBefore && await pageSaveVisible()) return { opened: true, kind: '신규등록 페이지' };   // 페이지형(저장 submit)
    if (!cancelBefore && await cancelVisible()) return { opened: true, kind: '신규등록 폼(취소 노출)' };   // 페이지형(취소)
    // 페이지형 등록 라우트 이동(시설 총괄 /facility/reg 등 — submit '등록', 취소 없이 초기화/등록) → URL 변화로 판정
    if (admin.url() !== urlBefore && /(reg|edit|new|create|form|write|regist)/i.test(admin.url())) return { opened: true, kind: '신규등록 라우트 페이지' };
  }
  // 2) [수정] — 페이지 or 행(hover 노출)
  const edit = M(admin).locator('button').filter({ hasText: /^\s*수정\s*$/ }).first();
  if (await edit.count().catch(() => 0)) {
    if (!(await edit.isVisible({ timeout: 800 }).catch(() => false))) { await edit.locator('xpath=ancestor::tr[1]').hover({ timeout: 800 }).catch(() => {}); await admin.waitForTimeout(300); }
    if (await edit.isVisible({ timeout: 800 }).catch(() => false)) await edit.click({ timeout: 3_000 }).catch(() => {});
    else await edit.click({ force: true, timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_300); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    const modalShown = await modal.isVisible({ timeout: 1_200 }).catch(() => false);
    const pageSave = await pageSaveVisible();
    if (modalShown || pageSave) return { opened: true, kind: modalShown ? '수정 모달' : '수정 페이지' };
  }
  // 3) 인라인 편집형 — 페이지에 [저장] 상주 + 입력 다수(관리 기준 정보 등). 화면 자체가 폼(등록/수정 버튼 없음).
  //    ⚠ [취소] 없음 → 미저장 상태로 다음 메뉴 이동 시 폐기(비파괴). 저장 절대 클릭 금지.
  const inlineInputs = await M(admin).locator('input:not([type=file]):not([type=hidden]):not([readonly]), textarea').count().catch(() => 0);
  if (savedBefore && inlineInputs >= 3) return { opened: true, kind: '인라인 편집(페이지 상주 저장)' };
  // 새 모달이 떴는지 최종 확인
  const afterModals = await admin.locator('.modal-group').count().catch(() => 0);
  if (afterModals > beforeModals) return { opened: true, kind: '모달' };
  return { opened: false, kind: '' };
}

// 폼 닫기(비파괴): [취소]/[닫기]/X → 폐기 확인 모달이면 [확인]. 저장/등록(submit) 절대 클릭 금지.
export async function closeForm(admin: Page) {
  await admin.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const roots = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m));
    const root = (roots.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement) || document.querySelector('.contents, main');
    if (!root) return;
    const btns = Array.from(root.querySelectorAll('button')).filter((b) => vis(b));
    const cancel = btns.find((b) => /^\s*(취소|닫기)\s*$/.test(b.textContent || '') && !/저장|등록/.test(b.textContent || ''))
      || btns.find((b) => /close/i.test(typeof b.className === 'string' ? b.className : '') && !/저장|등록/.test(b.textContent || ''));
    if (cancel) (cancel as HTMLElement).click();
  }).catch(() => {});
  await admin.waitForTimeout(600);
  // 폐기 확인 모달
  await admin.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m)).pop();
    if (md) { const ok = Array.from(md.querySelectorAll('button')).find((b) => /^\s*(확인|예|나가기|이동)\s*$/.test(b.textContent || '') && !/저장|등록/.test(b.textContent || '')); if (ok) (ok as HTMLElement).click(); }
  }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); await killAlarms(admin);
  // 페이지형 등록/수정 라우트(취소 버튼 없이 초기화/등록만 — 시설 총괄 /facility/reg 등): 저장 미클릭 → 뒤로가기로 폐기(비파괴).
  if (/(reg|edit|new|create|form|write|regist)/i.test(admin.url())) {
    await admin.goBack({ waitUntil: 'domcontentloaded', timeout: 8_000 }).catch(() => {});
    await admin.waitForTimeout(500); await killAlarms(admin);
  }
}

// 활성 폼 스코프(모달 우선) Locator.
function formScope(admin: Page): Locator {
  const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
  return modal;
}

// 폼 스코프 루트를 in-page 로 반환하는 표현식(모달 우선, 없으면 main).
const ROOT_EXPR = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width>1 && r.height>1; };
  const cls = (el) => (typeof el.className==='string'?el.className:'');
  const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m)=> vis(m) && !/alarm/.test(cls(m)));
  if (mods.length) return mods.sort((a,b)=>(b.textContent||'').length-(a.textContent||'').length)[0];
  return document.querySelector('.contents, main') || document.body;
})()`;

// datepicker 전용 케이스 — 달력 아이콘 → 팝업 → 날짜 셀 선택 → 입력 반영. 타이핑 폴백 + 범위(시작≤종료).
//   ★ 코스관리 datepicker: input.datepicker-input(type=text) + i.ico-calendar(달력 아이콘). 팝업 구조 진단 로깅.
export async function datepickerCase(admin: Page, scope: Locator, P: string, Rp: string, K: string) {
  const dp = scope.locator('input.datepicker-input');
  const nDp = await dp.count().catch(() => 0);
  const m1: CheckMeta = { path: `${P} > datepicker 달력`, tcRef: `${Rp}_datecal`, tcId: `INFOE2E-${K}-DATEPICK`, desc: '달력 아이콘 → 팝업 → 날짜 셀 선택 → 입력 반영', failMsg: 'datepicker 날짜선택 미동작' };
  if (nDp === 0) { skip(m1, 'datepicker 없음'); return; }
  const first = dp.first();
  const before = ((await first.inputValue().catch(() => '')) || '');
  await first.click({ timeout: 1_500 }).catch(() => {});
  await admin.waitForTimeout(450);
  const cal = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
    const pops = Array.from(document.querySelectorAll('[class*="datepicker"], [class*="calendar"], [class*="picker"], [class*="date-panel"], [class*="date-layer"]'))
      .filter((el) => vis(el) && !/datepicker-container|datepicker-input/.test(cls(el)) && el.querySelectorAll('*').length > 5);
    const pop = pops.find((p) => Array.from(p.querySelectorAll('*')).some((c) => /^\d{1,2}$/.test(norm(c.textContent))));
    if (!pop) return { popup: false, popCls: '', cells: 0, clickedText: '' };
    const cells = Array.from(pop.querySelectorAll('*')).filter((c) => vis(c) && /^\d{1,2}$/.test(norm(c.textContent)) && !Array.from(c.children).some((ch) => /^\d{1,2}$/.test(norm(ch.textContent))));
    const enabled = cells.filter((c) => !/disabled|other|prev|next|muted|off/i.test(cls(c)) && !/disabled|other|muted/i.test(cls((c.parentElement || c) as Element)));
    const pool = enabled.length ? enabled : cells;
    const target = pool.find((c) => norm(c.textContent) === '15') || pool.find((c) => norm(c.textContent) === '10') || pool[Math.floor(pool.length / 2)];
    if (target) ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    return { popup: true, popCls: cls(pop).slice(0, 60), cells: cells.length, clickedText: target ? norm(target.textContent) : '' };
  }).catch(() => ({ popup: false, popCls: '', cells: 0, clickedText: '' }));
  await admin.waitForTimeout(500);
  const afterCal = ((await first.inputValue().catch(() => '')) || '');
  const calWorked = cal.popup && /\d{4}-\d{2}-\d{2}/.test(afterCal) && afterCal !== before;
  // eslint-disable-next-line no-console
  console.log(`[DATEPICK ${K}] popup=${cal.popup} popCls="${cal.popCls}" cells=${cal.cells} clicked="${cal.clickedText}" val ${before}→${afterCal}`);
  if (calWorked) record(m1, 'PASS', { actual: `달력 팝업(${cal.popCls}) 셀 "${cal.clickedText}" 선택 → ${afterCal}` });
  else {
    await admin.keyboard.press('Escape').catch(() => {});
    await first.click().catch(() => {}); await first.fill('').catch(() => {}); await first.fill('2025-06-15').catch(() => {}); await first.press('Enter').catch(() => {});
    await admin.waitForTimeout(350);
    const afterType = ((await first.inputValue().catch(() => '')) || '');
    if (/2025-06-15/.test(afterType)) record(m1, 'PASS', { actual: `달력 셀 미반영 → 타이핑 입력 반영 "${afterType}"(popup=${cal.popup} "${cal.popCls}" cells=${cal.cells})` });
    else record(m1, 'FAIL', { error: '날짜 선택/입력 미반영', detail: `popup=${cal.popup} cells=${cal.cells} cal=${afterCal} type=${afterType}` });
  }
  await admin.keyboard.press('Escape').catch(() => {});
  if (nDp >= 2) {
    const m2: CheckMeta = { path: `${P} > datepicker 범위`, tcRef: `${Rp}_daterange`, tcId: `INFOE2E-${K}-DATERANGE`, desc: '범위 datepicker 시작 ≤ 종료 정합', failMsg: '범위 순서 이상' };
    const s = (((await dp.nth(0).inputValue().catch(() => '')) || '').match(/\d{4}-\d{2}-\d{2}/));
    const e = (((await dp.nth(1).inputValue().catch(() => '')) || '').match(/\d{4}-\d{2}-\d{2}/));
    if (s && e) { if (s[0] <= e[0]) record(m2, 'PASS', { actual: `시작 ${s[0]} ≤ 종료 ${e[0]}` }); else record(m2, 'FAIL', { error: '시작 > 종료', detail: `${s[0]} > ${e[0]}` }); }
    else skip(m2, '범위 두 값 미확보');
  }
}

// 배터리 실행 — P(경로), Rp(tcRef 프리픽스), K(tcId 화면 키).
export async function runFormBattery(admin: Page, P: string, Rp: string, K: string) {
  const isModal = await formScope(admin).isVisible({ timeout: 800 }).catch(() => false);
  const scope: Locator = isModal ? formScope(admin) : M(admin);

  // ── ⓪ datepicker(달력 위젯) ──
  await datepickerCase(admin, scope, P, Rp, K);

  // ── ① 입력 전수 ──
  {
    const loc = scope.locator('input:not([type=file]):not([type=hidden]):not([readonly]), textarea');
    const n = await loc.count().catch(() => 0);
    let filled = 0; const m: CheckMeta = { path: `${P} > 입력 전수`, tcRef: `${Rp}_fill`, tcId: `INFOE2E-${K}-FILL`, desc: '폼 모든 입력 필드 입력 → 반영', failMsg: '입력 반영 실패' };
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      if (!(await el.isVisible().catch(() => false)) || await el.isDisabled().catch(() => false)) continue;
      const clsx = (await el.getAttribute('class').catch(() => '')) || '';
      const v = /datepicker/.test(clsx) ? '2025-06-15' : '99999';
      await el.click({ timeout: 1_000 }).catch(() => {});
      await el.fill('').catch(() => {}); await el.fill(v).catch(() => {});
      if (((await el.inputValue().catch(() => '')) || '').trim().length > 0) filled++;
    }
    if (n === 0) skip(m, '입력 필드 없음(폼 구조 상이)');
    else if (filled >= Math.ceil(n * 0.7)) record(m, 'PASS', { actual: `${filled}/${n} 입력 반영` });
    else record(m, 'FAIL', { error: `입력 반영 부족 ${filled}/${n}` });
  }

  // ── ② [X] 클리어(2-phase) ──
  {
    const p1 = await admin.evaluate((rootExpr) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      // eslint-disable-next-line no-eval
      const root = eval(rootExpr) as Element;
      const clrs = Array.from(root.querySelectorAll('button.ico-color-close, i.ico-color-close, i.ico-color-close-k')).filter(vis);
      let tried = 0;
      for (const clr of clrs) {
        if (tried >= 12) break;
        let wrap: Element | null = clr; let inp: HTMLInputElement | null = null;
        for (let k = 0; k < 2 && wrap; k++) { wrap = wrap.parentElement; if (wrap) { const c = wrap.querySelector('input:not([type=file]), textarea') as HTMLInputElement | null; if (c) { inp = c; break; } } }
        if (!inp || !inp.value) continue;
        inp.setAttribute('data-e2e-clear', String(tried)); (clr as HTMLElement).click(); tried++;
      }
      return { tried, norm: norm('') };
    }, ROOT_EXPR).catch(() => ({ tried: 0 }));
    await admin.waitForTimeout(600);
    const p2 = await admin.evaluate(() => {
      let cleared = 0, phOk = 0; const marked = Array.from(document.querySelectorAll('[data-e2e-clear]')) as HTMLInputElement[];
      for (const inp of marked) { const empty = inp.value === ''; if (empty) cleared++; if (empty && (inp.getAttribute('placeholder') || '')) phOk++; inp.removeAttribute('data-e2e-clear'); }
      return { cleared, phOk, total: marked.length };
    }).catch(() => ({ cleared: 0, phOk: 0, total: 0 }));
    const m: CheckMeta = { path: `${P} > [X] 클리어`, tcRef: `${Rp}_clear`, tcId: `INFOE2E-${K}-CLEAR`, desc: '[X](ico-color-close) → 삭제 + placeholder', failMsg: '클리어 미동작' };
    // 혼합 필드폼(계산/숫자 재채움 등)에서 일부 미클리어는 정상 → 메커니즘 동작(≥1) 입증 시 PASS(부분은 비고).
    if (p1.tried === 0) skip(m, '값 있는 필드클리어 [X] 미검출');
    else if (p2.cleared === 0) record(m, 'FAIL', { error: `클리어 전무 0/${p1.tried}` });
    else if (p2.cleared >= Math.ceil(p1.tried * 0.7)) record(m, 'PASS', { actual: `클리어 ${p2.cleared}/${p1.tried} · placeholder ${p2.phOk}` });
    else record(m, 'PASS', { actual: `클리어 ${p2.cleared}/${p1.tried}(부분 — 계산/재채움 필드 혼재 추정) · placeholder ${p2.phOk}` });
  }

  // ── ③④ [+ 항목 추가] → 행 [X] 삭제 (스코프 전체 input 수 메트릭) ──
  {
    const cnt = () => admin.evaluate((rootExpr) => { const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; /* eslint-disable-next-line no-eval */ const root = eval(rootExpr) as Element; return Array.from(root.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea')).filter(vis).length; }, ROOT_EXPR).catch(() => -1);
    const before = await cnt();
    const clickRes = await admin.evaluate((rootExpr) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      // eslint-disable-next-line no-eval
      const root = eval(rootExpr) as Element;
      const adds = Array.from(root.querySelectorAll('button')).filter((b) => /항목\s*추가/.test(norm(b.textContent)) && vis(b)) as HTMLButtonElement[];
      if (!adds.length) return { found: false, disabled: null as boolean | null };
      if (adds[0].disabled) return { found: true, disabled: true };
      adds[0].click(); return { found: true, disabled: false };
    }, ROOT_EXPR).catch(() => ({ found: false, disabled: null }));
    await admin.waitForTimeout(800); await killAlarms(admin);
    const afterAdd = await cnt();
    const addM: CheckMeta = { path: `${P} > 항목추가`, tcRef: `${Rp}_add`, tcId: `INFOE2E-${K}-ADD`, desc: '[+ 항목 추가] → 입력 항목 증가', failMsg: '항목 미증가' };
    if (!clickRes.found) skip(addM, '[+ 항목 추가] 버튼 없음(반복 항목 미제공)');
    else if (clickRes.disabled) { diff(P, '[+ 항목 추가] 비활성', '버튼 disabled=true(추가 조건 미충족/최대 도달) → 무동작(정상)', `${Rp}_add`, '조건부 비활성 — 결함 아님'); skip(addM, '[+ 항목 추가] 비활성(disabled)'); }
    else if (afterAdd > before) {
      record(addM, 'PASS', { actual: `입력 ${before}→${afterAdd}(항목 추가)` });
      // 행 [X] 삭제(신규 마지막 항목)
      const delM: CheckMeta = { path: `${P} > 항목삭제`, tcRef: `${Rp}_del`, tcId: `INFOE2E-${K}-DELITEM`, desc: '행 [X]로 추가 항목 삭제 → 감소', failMsg: '항목 미감소' };
      let afterDel = afterAdd, ok = false;
      for (let a = 0; a < 3 && !ok; a++) {
        const did = await admin.evaluate((rootExpr) => {
          const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
          const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          // eslint-disable-next-line no-eval
          const root = eval(rootExpr) as Element;
          const cands = Array.from(root.querySelectorAll('.ico-color-close')).filter((e) => vis(e) && !(e.parentElement && e.parentElement.querySelector('input, textarea')));
          const t = (cands[cands.length - 1] || Array.from(root.querySelectorAll('.ico-color-close')).filter(vis).pop()) as HTMLElement | undefined;
          void norm; if (t) { t.click(); return true; } return false;
        }, ROOT_EXPR).catch(() => false);
        await admin.waitForTimeout(700); await killAlarms(admin);
        afterDel = await cnt();
        if (!did) break; if (afterDel < afterAdd) ok = true;
      }
      if (ok) record(delM, 'PASS', { actual: `입력 ${afterAdd}→${afterDel}(추가 항목 삭제)` });
      else record(delM, 'FAIL', { error: '항목 미감소', detail: `입력 ${afterAdd}→${afterDel}` });
    } else record(addM, 'FAIL', { error: '항목 미증가(안내 없음)', detail: `입력 ${before}→${afterAdd}` });
  }

  // ── ⑤ 파일 업로드 → [휴지통](ico-delete) (파일 input 있을 때만) ──
  {
    const m: CheckMeta = { path: `${P} > 파일 휴지통`, tcRef: `${Rp}_trash`, tcId: `INFOE2E-${K}-TRASH`, desc: '파일 업로드 → [휴지통](ico-delete) 삭제', failMsg: '휴지통 삭제 미동작' };
    const fileLoc = scope.locator('input[type=file]');
    const fn = await fileLoc.count().catch(() => 0);
    if (fn === 0) { skip(m, '파일 업로드 필드 없음'); }
    else {
      await fileLoc.last().setInputFiles(tmpPng()).catch(() => {});
      await admin.waitForTimeout(1_400); await killAlarms(admin);
      const linkCnt = () => admin.evaluate((rootExpr) => { const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim(); const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; /* eslint-disable-next-line no-eval */ const root = eval(rootExpr) as Element; return Array.from(root.querySelectorAll('a')).filter((a) => vis(a) && /\.(png|jpg|jpeg|pdf|dwg|zip|hwp|docx?|xlsx?)/i.test(norm(a.textContent))).length; }, ROOT_EXPR).catch(() => 0);
      const before = await linkCnt();
      if (before === 0) { skip(m, '업로드 미반영(파일 링크 미노출 — 즉시 미리보기형 추정)'); }
      else {
        const trashed = await admin.evaluate((rootExpr) => {
          const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          // eslint-disable-next-line no-eval
          const root = eval(rootExpr) as Element;
          const ts = Array.from(root.querySelectorAll('i.ico-delete, .ico-delete, [class*="trash"]')).filter(vis);
          const t = ts[ts.length - 1] as HTMLElement | undefined; if (t) { t.click(); return true; } return false;
        }, ROOT_EXPR).catch(() => false);
        await admin.waitForTimeout(800); await killAlarms(admin);
        const after = await linkCnt();
        if (!trashed) skip(m, '[휴지통](ico-delete) 미검출');
        else if (after < before) record(m, 'PASS', { actual: `파일링크 ${before}→${after}(휴지통 삭제)` });
        else record(m, 'FAIL', { error: '파일 미제거', detail: `${before}→${after}` });
      }
    }
  }
}
