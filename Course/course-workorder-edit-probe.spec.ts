import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { closeForm } from '../lib/course/formE2E';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  작업 관리 > 작업 지시 [수정] 폼 — datepicker·반복항목 삭제 정밀 프로브(진단, 비파괴).
//  실행: npm run course:auth 후 npm run course:workorder-edit-probe
//  목적: 전메뉴 심화 E2E에서 이 화면만 난 2건 FAIL의 실결함/하네스갭 확정 —
//    ① datepicker: 팝업은 뜨나(popup=true, 32셀) 셀 선택 값 미변경 + fill 거부 → 위젯 구조·상호작용 진단
//    ② 항목삭제: [+항목추가] 20→24는 되나 행 [X] 삭제 24→24 미감소 → 삭제 컨트롤 후보 전수 덤프
//  산출: analysis/코스관리_작업지시_수정폼.json
//  ⚠ 비파괴: 수정 진입 → 관찰(+datepicker 셀클릭·항목추가/삭제 시도는 폼 내 미저장 조작) → [취소]. 저장 절대 안 함.
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();
const ROOT_EXPR = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width>1 && r.height>1; };
  const cls = (el) => (typeof el.className==='string'?el.className:'');
  const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m)=> vis(m) && !/alarm/.test(cls(m)));
  if (mods.length) return mods.sort((a,b)=>(b.textContent||'').length-(a.textContent||'').length)[0];
  return document.querySelector('.contents, main') || document.body;
})()`;

test('작업 지시 [수정] 폼 — datepicker·반복항목 삭제 정밀 프로브(진단)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin = await openCourseAdmin(page, context);
  const out: Record<string, unknown> = { ts: new Date().toISOString().slice(0, 19).replace('T', ' ') };

  const finish = async () => {
    if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
    fs.writeFileSync(path.join('analysis', '코스관리_작업지시_수정폼.json'), JSON.stringify(out, null, 2));
    console.log('\n══ 작업 지시 수정 폼 프로브 요약 ══');
    console.log(JSON.stringify({ datepicker: out['datepicker'], repeat: out['repeat'], note: out['_note'] }, null, 1).slice(0, 2500));
    console.log('[out] analysis/코스관리_작업지시_수정폼.json');
  };

  // 워밍업: 콜드 네비 레이스/전환 미확장 대비 — 정보 관리 먼저 거친 뒤 대상으로(full 런 성공 경로 재현).
  await gotoCourseMenu(admin, '정보 관리', '코스 기본 정보').catch(() => {});
  await admin.waitForTimeout(800); await killAlarms(admin);
  let entered = await gotoCourseMenu(admin, '작업 관리', '작업 지시').catch(() => false);
  if (!entered) { await admin.waitForTimeout(1_200); entered = await gotoCourseMenu(admin, '작업 관리', '작업 지시').catch(() => false); }
  if (!entered) { out['_note'] = '진입 실패(depth-2 미확장 — 세션 degraded 추정, course:auth 재인증 필요)'; await finish(); return; }
  await admin.waitForTimeout(1_500); await killAlarms(admin);

  // [수정] 진입(행 hover 노출 대응). 없으면 [신규 등록]으로 폼 확보.
  let opened = false; let via = '';
  const edit = M(admin).locator('button').filter({ hasText: /^\s*수정\s*$/ }).first();
  if (await edit.count().catch(() => 0)) {
    if (!(await edit.isVisible({ timeout: 800 }).catch(() => false))) { await edit.locator('xpath=ancestor::tr[1]').hover({ timeout: 800 }).catch(() => {}); await admin.waitForTimeout(300); }
    await edit.click({ force: true, timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_500); await killAlarms(admin);
    opened = await M(admin).getByRole('button', { name: /^\s*(저장|취소)\s*$/ }).first().isVisible({ timeout: 1_500 }).catch(() => false)
      || await admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last().isVisible({ timeout: 1_000 }).catch(() => false);
    if (opened) via = '수정';
  }
  if (!opened) {
    const reg = M(admin).getByRole('button', { name: /신규\s*등록|^\s*등록\s*$/ }).first();
    if (await reg.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await reg.click({ timeout: 3_000 }).catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin);
      opened = true; via = '신규등록(수정 미노출 폴백)';
    }
  }
  if (!opened) { out['_note'] = '[수정]/[신규 등록] 폼 미오픈'; await finish(); return; }
  out['formVia'] = via;

  // ── ① datepicker 위젯 구조 + 상호작용 진단 ──
  {
    const dp = await admin.evaluate((rootExpr) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
      // eslint-disable-next-line no-eval
      const root = eval(rootExpr) as Element;
      const inputs = Array.from(root.querySelectorAll('input.datepicker-input, input[type=date], [class*="datepicker"] input')).filter(vis) as HTMLInputElement[];
      return {
        count: inputs.length,
        fields: inputs.slice(0, 6).map((e) => ({
          value: e.value || '', readonly: e.hasAttribute('readonly'), disabled: e.disabled,
          maxlength: e.getAttribute('maxlength') || '', ph: e.getAttribute('placeholder') || '',
          cls: cls(e).slice(0, 60), wrapCls: cls((e.parentElement || e)).slice(0, 60),
          calIconSibling: !!(e.parentElement && e.parentElement.querySelector('i.ico-calendar, [class*="calendar"], [class*="ico-date"]')),
        })),
        note: inputs.length ? '' : 'datepicker input 없음',
      };
    }, ROOT_EXPR).catch(() => ({ count: 0, fields: [], note: 'evaluate 실패' }));

    // 상호작용: 첫 datepicker 클릭 → 팝업 구조 캡처 → 현재값과 다른 셀 클릭 → 값 변화 관찰
    let interact: any = { attempted: false };
    if ((dp as any).count > 0) {
      const first = admin.locator('input.datepicker-input, input[type=date]').first();
      const before = (await first.inputValue().catch(() => '')) || '';
      await first.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(500);
      const pop = await admin.evaluate(() => {
        const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
        const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
        const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
        const pops = Array.from(document.querySelectorAll('[class*="datepicker"], [class*="calendar"], [class*="picker"], [class*="date-panel"], [class*="date-layer"]'))
          .filter((el) => vis(el) && !/datepicker-input/.test(cls(el)) && el.querySelectorAll('*').length > 5);
        const popEl = pops.find((p) => Array.from(p.querySelectorAll('*')).some((c) => /^\d{1,2}$/.test(norm(c.textContent))));
        if (!popEl) return { popup: false };
        const cells = Array.from(popEl.querySelectorAll('*')).filter((c) => vis(c) && /^\d{1,2}$/.test(norm(c.textContent)) && !Array.from(c.children).some((ch) => /^\d{1,2}$/.test(norm(ch.textContent))));
        const sample = cells.slice(0, 3).map((c) => ({ text: norm(c.textContent), tag: c.tagName.toLowerCase(), cls: cls(c).slice(0, 50), parentCls: cls((c.parentElement || c)).slice(0, 50) }));
        // 현재값과 다른 셀(값 변화 확인용) — '20' 우선
        const target = cells.find((c) => norm(c.textContent) === '20') || cells.find((c) => norm(c.textContent) === '5') || cells[Math.floor(cells.length / 2)];
        let clicked = '';
        if (target) { clicked = norm(target.textContent); ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); }
        return { popup: true, popCls: cls(popEl).slice(0, 60), cells: cells.length, sample, clicked };
      }).catch(() => ({ popup: false }));
      await admin.waitForTimeout(500);
      const afterCell = (await first.inputValue().catch(() => '')) || '';
      // 타이핑 폴백 진단
      await admin.keyboard.press('Escape').catch(() => {});
      await first.click().catch(() => {});
      const typed = await first.evaluate((el: HTMLInputElement) => { el.focus(); return { readonly: el.hasAttribute('readonly'), disabled: el.disabled }; }).catch(() => ({ readonly: null, disabled: null }));
      await first.fill('2025-06-20').catch(() => {});
      const afterFill = (await first.inputValue().catch(() => '')) || '';
      await first.pressSequentially('20250620', { delay: 40 }).catch(() => {});
      const afterSeq = (await first.inputValue().catch(() => '')) || '';
      interact = { attempted: true, before, ...pop, afterCell, cellChanged: afterCell !== before && /\d{4}-\d{2}-\d{2}/.test(afterCell), typed, afterFill, fillWorked: /2025-06-20/.test(afterFill), afterSeq, seqWorked: /2025.?06.?20/.test(afterSeq) };
    }
    out['datepicker'] = { widget: dp, interact };
  }

  // ── ② 반복항목: [+항목추가] → 새 행 구조 + 삭제 컨트롤 후보 전수 ──
  {
    const cnt = () => admin.evaluate((rootExpr) => { const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; /* eslint-disable-next-line no-eval */ const root = eval(rootExpr) as Element; return Array.from(root.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea')).filter(vis).length; }, ROOT_EXPR).catch(() => -1);
    const before = await cnt();
    const addRes = await admin.evaluate((rootExpr) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      // eslint-disable-next-line no-eval
      const root = eval(rootExpr) as Element;
      const adds = Array.from(root.querySelectorAll('button')).filter((b) => /항목\s*추가|추가/.test(norm(b.textContent)) && vis(b)) as HTMLButtonElement[];
      if (!adds.length) return { found: false, labels: [] as string[] };
      adds[0].setAttribute('data-e2e-add', '1'); adds[0].click();
      return { found: true, labels: adds.map((b) => norm(b.textContent)).slice(0, 5) };
    }, ROOT_EXPR).catch(() => ({ found: false, labels: [] }));
    await admin.waitForTimeout(800); await killAlarms(admin);
    const afterAdd = await cnt();

    // 삭제 컨트롤 후보 전수 덤프(추가된 마지막 행 주변)
    const delCands = await admin.evaluate((rootExpr) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
      // eslint-disable-next-line no-eval
      const root = eval(rootExpr) as Element;
      const SEL = 'i.ico-color-close, .ico-color-close, i.ico-delete, .ico-delete, [class*="trash"], [class*="remove"], [class*="del"], button[class*="close"], svg[class*="close"], .btn-del, .row-del';
      const cands = Array.from(root.querySelectorAll(SEL)).filter(vis);
      return {
        total: cands.length,
        sample: cands.slice(-8).map((c) => ({
          tag: c.tagName.toLowerCase(), cls: cls(c).slice(0, 60),
          hasInputSibling: !!(c.parentElement && c.parentElement.querySelector('input:not([type=file]), textarea')),
          parentCls: cls((c.parentElement || c)).slice(0, 60),
          grandCls: cls(((c.parentElement && c.parentElement.parentElement) || c)).slice(0, 60),
          html: (c as HTMLElement).outerHTML.replace(/\s+/g, ' ').slice(0, 120),
        })),
      };
    }, ROOT_EXPR).catch(() => ({ total: 0, sample: [] }));

    // 실제 삭제 시도(마지막 후보, 입력형제 없는 것 우선) → 감소 관찰
    let delRes: any = { attempted: false };
    if (afterAdd > before) {
      const did = await admin.evaluate((rootExpr) => {
        const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
        // eslint-disable-next-line no-eval
        const root = eval(rootExpr) as Element;
        const noInput = Array.from(root.querySelectorAll('.ico-color-close, i.ico-delete, .ico-delete, [class*="trash"], [class*="remove"]')).filter((e) => vis(e) && !(e.parentElement && e.parentElement.querySelector('input, textarea')));
        const t = (noInput[noInput.length - 1]) as HTMLElement | undefined;
        if (t) { t.click(); return true; } return false;
      }, ROOT_EXPR).catch(() => false);
      await admin.waitForTimeout(700); await killAlarms(admin);
      const afterDel = await cnt();
      delRes = { attempted: true, clicked: did, afterDel, decreased: afterDel < afterAdd };
    }
    out['repeat'] = { before, addFound: (addRes as any).found, addLabels: (addRes as any).labels, afterAdd, added: afterAdd > before, delCands, delRes };
  }

  await closeForm(admin).catch(() => {});
  await killAlarms(admin);
  await finish();
});
