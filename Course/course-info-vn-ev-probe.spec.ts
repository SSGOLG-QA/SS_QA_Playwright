import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  정보 관리 > 거래처 정보 / 관리 기준 정보 — 폼 진입점 규명 프로브(진단 전용, 비파괴).
//  실행: npm run course:auth 후 npm run course:info-vnev-probe
//  목적: E2E 배터리가 폼 미검출(SKIP)한 2화면의 [신규 등록]/[등록]/[추가]/[수정] 실제 버튼·모달/페이지 구조 확정.
//  산출: analysis/코스관리_거래처_관리기준_폼.json
//  ⚠ 비파괴: 후보 버튼 클릭 → 폼 열림 관찰 → [취소]/Escape. 저장/등록 submit 절대 클릭 금지.
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

async function scanScreen(admin: Page) {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (el: Element) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''));
    const scope = document.querySelector('.contents, main') || document.body;
    const buttons = Array.from(scope.querySelectorAll('button')).filter(vis).map((b) => ({ text: norm(b.textContent), cls: clsOf(b).slice(0, 50), disabled: (b as HTMLButtonElement).disabled }));
    const links = Array.from(scope.querySelectorAll('a')).filter(vis).map((a) => norm(a.textContent)).filter(Boolean).slice(0, 20);
    const tables = scope.querySelectorAll('table').length;
    const rows = scope.querySelectorAll('tbody tr').length;
    const heads = Array.from(scope.querySelectorAll('thead th')).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 20);
    // 행 내부 액션 버튼(hover 노출 포함, DOM 존재 기준)
    const rowBtns = [...new Set(Array.from(scope.querySelectorAll('tbody button')).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 20);
    const info = [...new Set(Array.from(scope.querySelectorAll('.info-box-text, [class*="info"], p')).filter(vis).map((e) => norm((e as HTMLElement).innerText)).filter((t) => t && t.length > 8 && t.length < 200))].slice(0, 6);
    return { url: location.pathname, buttons: buttons.slice(0, 40), links, tables, rows, heads, rowBtns, info };
  }).catch((e) => ({ ERROR: String(e).slice(0, 200) }));
}

// 후보 버튼 클릭 → 폼(모달/페이지) 열림 관찰 → 닫기(비파괴). 저장/등록 submit 클릭 금지.
async function tryOpen(admin: Page, label: string) {
  const out: Record<string, unknown> = { label };
  const btn = M(admin).getByRole('button', { name: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
  const exists = await btn.count().catch(() => 0);
  if (!exists) { out['exists'] = false; return out; }
  out['exists'] = true;
  out['visible'] = await btn.isVisible({ timeout: 800 }).catch(() => false);
  const beforeModals = await admin.locator('.modal-group').count().catch(() => 0);
  const beforeUrl = admin.url();
  const beforeSave = await M(admin).getByRole('button', { name: /^\s*저장\s*$/ }).count().catch(() => 0);
  if (!out['visible']) { await btn.locator('xpath=ancestor::tr[1]').hover({ timeout: 800 }).catch(() => {}); await admin.waitForTimeout(300); }
  await btn.click({ force: true, timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_300); await killAlarms(admin);
  const afterModals = await admin.locator('.modal-group').count().catch(() => 0);
  const afterSave = await M(admin).getByRole('button', { name: /^\s*저장\s*$/ }).count().catch(() => 0);
  const urlChanged = admin.url() !== beforeUrl;
  // 열린 폼 스냅샷
  const snap = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (el: Element) => (typeof el.className === 'string' ? el.className : '');
    const modal = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m) && !/alarm/.test(clsOf(m))).sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
    const root = (modal || document.querySelector('.contents, main')) as HTMLElement;
    if (!root) return null;
    const title = norm((root.querySelector('.modal-header, h1, h2, h3, .header-title, [class*="title"]') || {} as Element).textContent || '').slice(0, 50);
    const inputs = root.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea').length;
    const btns = [...new Set(Array.from(root.querySelectorAll('button')).filter(vis).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 15);
    return { isModal: !!modal, title, inputs, btns };
  }).catch(() => null);
  out['result'] = { modalOpened: afterModals > beforeModals, pageForm: afterSave > beforeSave, urlChanged, snap };
  // 닫기(비파괴)
  await admin.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m)).pop();
    const scope = md || document.querySelector('.contents, main');
    const c = scope ? Array.from(scope.querySelectorAll('button')).find((b) => /^\s*(취소|닫기)\s*$/.test(b.textContent || '') && !/저장|등록/.test(b.textContent || '')) : null;
    if (c) (c as HTMLElement).click();
  }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin);
  // 페이지폼이면 취소로 리스트 복귀 재확인
  if (out['result'] && (out['result'] as any).pageForm) { await admin.evaluate(() => { const sc = document.querySelector('.contents, main'); const c = sc ? Array.from(sc.querySelectorAll('button')).find((b) => /^\s*취소\s*$/.test(b.textContent || '')) : null; if (c) (c as HTMLElement).click(); }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin); }
  return out;
}

test('거래처/관리 기준 — 폼 진입점 규명(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  const admin = await openCourseAdmin(page, context);
  const out: Record<string, unknown> = { ts: new Date().toISOString().slice(0, 19).replace('T', ' ') };

  for (const sub of ['거래처 정보', '관리 기준 정보']) {
    const rec: Record<string, unknown> = {};
    const ok = await gotoCourseMenu(admin, '정보 관리', sub).then(() => true).catch(() => false);
    if (!ok) { rec['_진입'] = false; out[sub] = rec; continue; }
    await admin.waitForTimeout(1_300); await killAlarms(admin);
    rec['scan'] = await scanScreen(admin);
    // 후보 진입점 순회(존재 시 클릭 관찰)
    rec['opens'] = [];
    for (const label of ['신규 등록', '등록', '추가', '거래처 등록', '기준 등록', '항목 추가', '수정']) {
      const r = await tryOpen(admin, label);
      (rec['opens'] as unknown[]).push(r);
      // 폼이 열렸으면 그 라벨로 확정 — 추가 시도 중단
      if (r['result'] && ((r['result'] as any).modalOpened || (r['result'] as any).pageForm)) { rec['_확정진입'] = label; break; }
    }
    out[sub] = rec;
  }

  if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
  fs.writeFileSync(path.join('analysis', '코스관리_거래처_관리기준_폼.json'), JSON.stringify(out, null, 2));
  for (const sub of ['거래처 정보', '관리 기준 정보']) {
    const r = out[sub] as any;
    const sc = r?.scan || {};
    console.log(`\n══ ${sub} ══ url=${sc.url} · 버튼[${(sc.buttons || []).map((b: any) => b.text).filter(Boolean).join(', ')}] · 행 ${sc.rows} · 행버튼[${(sc.rowBtns || []).join(', ')}]`);
    console.log(`  확정 진입점: ${r?._확정진입 || '미검출'}`);
    for (const o of (r?.opens || [])) if (o.exists) console.log(`   · [${o.label}] exists=${o.exists} vis=${o.visible} → modal=${o.result?.modalOpened} page=${o.result?.pageForm} title="${o.result?.snap?.title}" inputs=${o.result?.snap?.inputs} btns[${(o.result?.snap?.btns || []).join('/')}]`);
  }
  console.log('\n[out] analysis/코스관리_거래처_관리기준_폼.json');
});
