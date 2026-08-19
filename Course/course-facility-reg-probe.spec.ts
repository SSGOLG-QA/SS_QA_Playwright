import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  시설 관리 > 시설 총괄 [시설 등록] — 진입점 정밀 규명 프로브(진단 전용, 비파괴).
//  실행: npm run course:auth 후 npm run course:facility-reg-probe
//  목적: forms-e2e-all 이 시설 총괄 폼 미검출(SKIP)한 원인 규명 —
//    [시설 등록] 버튼 상태(disabled/class) + 클릭 시 실제 동작(모달/페이지폼/알럿/토스트/무동작) 전수 캡처.
//  산출: analysis/코스관리_시설등록_진입점.json
//  ⚠ 비파괴: 클릭 후 관찰만 → [취소]/Escape. 저장/등록 submit 절대 클릭 금지.
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

function snapDom() {
  return {
    expr: `(() => {
      const norm = (s) => (s||'').replace(/\\s+/g,' ').trim();
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width>1 && r.height>1; };
      const cls = (el) => (typeof el.className==='string'?el.className:'');
      const scope = document.querySelector('.contents, main') || document.body;
      const modals = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter(m=>vis(m)).map(m=>({cls:cls(m).slice(0,50), title:norm((m.querySelector('.modal-header,.header-title,h1,h2,h3')||{}).textContent||'').slice(0,50), isAlarm:/alarm/.test(cls(m)), text:norm(m.textContent).slice(0,140), btns:[...new Set(Array.from(m.querySelectorAll('button')).filter(vis).map(b=>norm(b.textContent)).filter(Boolean))].slice(0,12)}));
      const toasts = Array.from(document.querySelectorAll('.toast-box, .toast, [class*="toast"], [class*="alert"], [class*="snackbar"]')).filter(vis).map(t=>norm(t.textContent).slice(0,120)).filter(Boolean);
      const buttons = [...new Set(Array.from(scope.querySelectorAll('button')).filter(vis).map(b=>norm(b.textContent)).filter(Boolean))].slice(0,40);
      const inputs = scope.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea').length;
      return { url: location.pathname, modals, toasts, buttons, inputs, bodyLen: norm(document.body.innerText).length };
    })()`,
  };
}

test('시설 총괄 [시설 등록] — 진입점 정밀 규명(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  const admin = await openCourseAdmin(page, context);
  const out: Record<string, unknown> = { ts: new Date().toISOString().slice(0, 19).replace('T', ' ') };
  const S = snapDom().expr;

  if (!(await gotoCourseMenu(admin, '시설 관리', '시설 총괄').then(() => true).catch(() => false))) { out['_note'] = '진입 실패(세션 만료 — course:auth)'; fs.writeFileSync('analysis/코스관리_시설등록_진입점.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out)); return; }
  await admin.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await admin.waitForTimeout(1_500); await killAlarms(admin);

  // ── 1) [시설 등록] 버튼 상태 정밀 ──
  out['regButton'] = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const cls = (el: Element) => (typeof el.className === 'string' ? el.className : '');
    const btns = Array.from(document.querySelectorAll('button'));
    const reg = btns.filter((b) => /시설\s*등록|신규\s*등록|^\s*등록\s*$/.test(norm(b.textContent)));
    return reg.map((b) => ({ text: norm(b.textContent), cls: cls(b).slice(0, 60), disabled: (b as HTMLButtonElement).disabled, visible: vis(b), html: b.outerHTML.replace(/\s+/g, ' ').slice(0, 200) }));
  }).catch(() => []);

  // ── 2) 클릭 전 스냅 ──
  out['before'] = await admin.evaluate(S).catch(() => null);

  // ── 3) 다이얼로그(native alert/confirm) 리스너 + 클릭 ──
  const dialogs: string[] = [];
  admin.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message().slice(0, 120)}`); d.dismiss().catch(() => {}); });
  const btn = M(admin).getByRole('button', { name: /^\s*시설\s*등록\s*$/ }).first();
  const clickable = await btn.isVisible({ timeout: 2_000 }).catch(() => false);
  out['clickAttempt'] = { found: (await btn.count().catch(() => 0)) > 0, visible: clickable };
  if (clickable) {
    // Playwright 클릭
    await btn.click({ timeout: 3_000 }).catch((e) => { (out['clickAttempt'] as any).pwError = String(e).slice(0, 120); });
    await admin.waitForTimeout(1_600);
    out['afterPwClick'] = await admin.evaluate(S).catch(() => null);
    // 변화 없으면 네이티브 dispatch 재시도
    const changed = JSON.stringify((out['afterPwClick'] as any)?.modals || []) !== JSON.stringify((out['before'] as any)?.modals || []) || (out['afterPwClick'] as any)?.url !== (out['before'] as any)?.url;
    if (!changed) {
      await admin.evaluate(() => {
        const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
        const b = Array.from(document.querySelectorAll('button')).find((x) => /^\s*시설\s*등록\s*$/.test(norm(x.textContent)));
        if (b) ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
      }).catch(() => {});
      await admin.waitForTimeout(1_600);
      out['afterNativeClick'] = await admin.evaluate(S).catch(() => null);
    }
  }
  out['dialogs'] = dialogs;

  // ── 4) 닫기(비파괴) ──
  await admin.evaluate(() => { const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m)).pop(); const sc = md || document.querySelector('.contents, main'); const c = sc ? Array.from(sc.querySelectorAll('button')).find((b) => /^\s*(취소|닫기)\s*$/.test(b.textContent || '') && !/저장|등록/.test(b.textContent || '')) : null; if (c) (c as HTMLElement).click(); }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); await killAlarms(admin);

  fs.writeFileSync('analysis/코스관리_시설등록_진입점.json', JSON.stringify(out, null, 2));
  console.log('\n══ 시설 총괄 [시설 등록] 규명 ══');
  console.log('버튼:', JSON.stringify(out['regButton']));
  console.log('클릭:', JSON.stringify(out['clickAttempt']));
  console.log('다이얼로그:', JSON.stringify(dialogs));
  const bef = out['before'] as any, pw = out['afterPwClick'] as any, nat = out['afterNativeClick'] as any;
  console.log(`before: url=${bef?.url} modals=${bef?.modals?.length} inputs=${bef?.inputs} toasts=${JSON.stringify(bef?.toasts)}`);
  if (pw) console.log(`afterPwClick: url=${pw.url} modals=${JSON.stringify(pw.modals)} inputs=${pw.inputs} toasts=${JSON.stringify(pw.toasts)} btns=[${(pw.buttons || []).join(', ')}]`);
  if (nat) console.log(`afterNativeClick: url=${nat.url} modals=${JSON.stringify(nat.modals)} inputs=${nat.inputs} toasts=${JSON.stringify(nat.toasts)}`);
  console.log('[out] analysis/코스관리_시설등록_진입점.json');
});
