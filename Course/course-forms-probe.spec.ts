import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  코스관리 — 폼 SKIP 화면 진입점 규명 프로브(진단 전용, 비파괴). vn-ev-probe 일반화.
//  실행: npm run course:auth 후 npm run course:forms-probe  (기본: 의심 SKIP 화면 / PROBE_SCREENS env로 지정)
//  목적: forms-e2e-all 이 폼 미검출(SKIP)한 화면의 실제 [등록]/[수정]/[작성]/[추가]/인라인 구조 확정.
//  산출: analysis/코스관리_폼진입점.json
//  ⚠ 비파괴: 후보 버튼 클릭 → 폼 열림 관찰 → [취소]/Escape. 저장/등록 submit 절대 클릭 금지.
//  ⛔ 지도 화면 제외.
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

// [대메뉴, 소메뉴] — 의심 SKIP(폼 있을 가능성). PROBE_SCREENS="작업 관리>작업 일보;시설 관리>시설 총괄" 로 오버라이드.
const DEFAULT: [string, string][] = [
  ['사진 관리', '정보별 사진'], ['사진 관리', '위치별 사진'],
  ['작업 관리', '작업 계획'], ['작업 관리', '예측 정보'], ['작업 관리', '작업 일보'],
  ['인력 관리', '근태 관리'], ['인력 관리', '투입 관리'], ['인력 관리', '권한관리'],
  ['자재 관리', '자재 수불(품목별)'], ['시설 관리', '시설 총괄'],
  ['예산 관리', '예산 상세'], ['예산 관리', '실적 관리'],
];

async function scanScreen(admin: Page) {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (el: Element) => (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''));
    const scope = document.querySelector('.contents, main') || document.body;
    const buttons = [...new Set(Array.from(scope.querySelectorAll('button')).filter(vis).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 40);
    const btnCls = Array.from(scope.querySelectorAll('button')).filter(vis).slice(0, 30).map((b) => ({ t: norm(b.textContent).slice(0, 20), c: clsOf(b).slice(0, 40) }));
    const rows = scope.querySelectorAll('tbody tr').length;
    const heads = Array.from(scope.querySelectorAll('thead th')).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 20);
    const rowBtns = [...new Set(Array.from(scope.querySelectorAll('tbody button')).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 20);
    const inlineInputs = Array.from(scope.querySelectorAll('input:not([type=file]):not([type=hidden]):not([readonly]), textarea')).filter(vis).length;
    const pageSave = Array.from(scope.querySelectorAll('button')).some((b) => /^\s*저장\s*$/.test(b.textContent || '') && vis(b));
    return { url: location.pathname, buttons, btnCls, rows, heads, rowBtns, inlineInputs, pageSave };
  }).catch((e) => ({ ERROR: String(e).slice(0, 200) }));
}

async function tryOpen(admin: Page, label: string) {
  const out: Record<string, unknown> = { label };
  const btn = M(admin).getByRole('button', { name: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
  if (!(await btn.count().catch(() => 0))) { out['exists'] = false; return out; }
  out['exists'] = true;
  const beforeModals = await admin.locator('.modal-group').count().catch(() => 0);
  const beforeSave = await M(admin).getByRole('button', { name: /^\s*저장\s*$/ }).count().catch(() => 0);
  if (!(await btn.isVisible({ timeout: 800 }).catch(() => false))) { await btn.locator('xpath=ancestor::tr[1]').hover({ timeout: 800 }).catch(() => {}); await admin.waitForTimeout(300); }
  await btn.click({ force: true, timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_200); await killAlarms(admin);
  const afterModals = await admin.locator('.modal-group').count().catch(() => 0);
  const afterSave = await M(admin).getByRole('button', { name: /^\s*저장\s*$/ }).count().catch(() => 0);
  const snap = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (el: Element) => (typeof el.className === 'string' ? el.className : '');
    const modal = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m) && !/alarm/.test(clsOf(m))).sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
    if (!modal) return null;
    return { title: norm((modal.querySelector('.modal-header, .header-title, h1,h2,h3') || {} as Element).textContent || '').slice(0, 40), inputs: modal.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea').length, btns: [...new Set(Array.from(modal.querySelectorAll('button')).filter(vis).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 12) };
  }).catch(() => null);
  out['result'] = { modalOpened: afterModals > beforeModals, pageForm: afterSave > beforeSave, snap };
  await admin.evaluate(() => { const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }; const md = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((m) => vis(m)).pop(); const sc = md || document.querySelector('.contents, main'); const c = sc ? Array.from(sc.querySelectorAll('button')).find((b) => /^\s*(취소|닫기)\s*$/.test(b.textContent || '') && !/저장|등록/.test(b.textContent || '')) : null; if (c) (c as HTMLElement).click(); }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); await killAlarms(admin);
  return out;
}

test('폼 SKIP 화면 진입점 규명(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  const admin = await openCourseAdmin(page, context);
  const out: Record<string, unknown> = { ts: new Date().toISOString().slice(0, 19).replace('T', ' ') };
  const list: [string, string][] = (process.env.PROBE_SCREENS || '').trim()
    ? process.env.PROBE_SCREENS!.split(';').map((s) => s.split('>').map((x) => x.trim()) as [string, string])
    : DEFAULT;

  for (const [menu, sub] of list) {
    const rec: Record<string, unknown> = {};
    if (!(await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false))) { rec['_진입'] = false; out[`${menu} > ${sub}`] = rec; continue; }
    await admin.waitForTimeout(1_200); await killAlarms(admin);
    const sc = await scanScreen(admin); rec['scan'] = sc;
    rec['opens'] = [];
    for (const label of ['신규 등록', '등록', '추가', '작성', '사진 등록', '영상정보 등록', '업로드', '수정']) {
      const r = await tryOpen(admin, label);
      if (r['exists']) (rec['opens'] as unknown[]).push(r);
      if (r['result'] && ((r['result'] as any).modalOpened || (r['result'] as any).pageForm)) { rec['_확정진입'] = label; break; }
    }
    // 인라인 편집형 판정
    if (!rec['_확정진입'] && (sc as any).pageSave && (sc as any).inlineInputs >= 3) rec['_확정진입'] = '인라인 편집(저장 상주)';
    out[`${menu} > ${sub}`] = rec;
  }

  if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
  fs.writeFileSync(path.join('analysis', '코스관리_폼진입점.json'), JSON.stringify(out, null, 2));
  for (const [menu, sub] of list) {
    const r = out[`${menu} > ${sub}`] as any; if (!r) continue; const sc = r.scan || {};
    console.log(`\n══ ${menu} > ${sub} ══ url=${sc.url} 행 ${sc.rows} 인라인입력 ${sc.inlineInputs} 저장상주 ${sc.pageSave}`);
    console.log(`  버튼[${(sc.buttons || []).join(', ')}] 행버튼[${(sc.rowBtns || []).join(', ')}]`);
    console.log(`  → 확정 진입점: ${r._확정진입 || '없음(읽기전용 추정)'}`);
    for (const o of (r.opens || [])) if (o.result && (o.result.modalOpened || o.result.pageForm)) console.log(`     [${o.label}] modal=${o.result.modalOpened} page=${o.result.pageForm} title="${o.result.snap?.title}" inputs=${o.result.snap?.inputs}`);
  }
  console.log('\n[out] analysis/코스관리_폼진입점.json');
});
