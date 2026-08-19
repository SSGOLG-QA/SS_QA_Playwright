import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  그린 분석 팝업 탭 — leaf DOM 정밀 프로브 + 클릭 전략 bake-off (진단 전용, 비파괴).
//  실행: npm run course:auth 후 npm run course:green-probe
//  목적: course:green 의 미해결 4항목(6탭 전환/더보기/제목/보기)의 근본원인 규명 —
//    ① 팝업 탭 바의 실제 leaf 요소·클릭 가능 조상 체인을 정밀 덤프
//    ② 탭 클릭 3전략(Playwright leaf / Playwright ancestor / in-page 네이티브 dispatch)을
//       한 타깃 탭에 bake-off → 콘텐츠 실제 변경으로 '동작하는 전략' 판정
//    ③ 승자 전략으로 6탭 전 sweep + 각 탭의 더보기/제목/보기 요소 구조 덤프
//  산출: analysis/_green-tab-probe.json + reports/green-tab-probe.html (콘솔에도 요약)
//  ⚠ 팝업 열린 동안 killAlarms 금지(그린 정보 팝업 [확인]을 오클릭해 닫음).
// ──────────────────────────────────────────────────────────────

const P = '코스 현황 관리 > 그린 분석';
const M = (p: Page) => p.locator('.contents, main').first();
const TOAST_RE = /그린 영역이 설정되어 있지 않습니다|그린 영역을 먼저 등록/;
const TAB_LABELS = ['기상 정보', '잔디 정보', '발병 정보', '일상 점검', '그린 이슈', '작업 지시 리스트'];

// 홀 이미지 클릭 → 팝업(탭 렌더)까지 폴링. (green-deep 검증 방식 재사용)
async function clickHole(admin: Page, i: number): Promise<{ opened: boolean; toast: boolean }> {
  await M(admin).locator('img').nth(i).click({ timeout: 2_000, force: true }).catch(() => {});
  let toast = false; let opened = false; let ready = false;
  for (let w = 0; w < 12; w++) {
    await admin.waitForTimeout(600);
    toast = await admin.evaluate((re) => new RegExp(re).test(document.body.textContent || ''), TOAST_RE.source).catch(() => false);
    if (toast) break;
    const cap = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
        .filter((mo) => (mo as HTMLElement).offsetParent && /그린 정보/.test(mo.textContent || ''));
      const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
      if (!md) return { opened: false, ready: false };
      const t = norm(md.textContent);
      return { opened: true, ready: /기상\s*정보|작업\s*지시|잔디\s*정보/.test(t) };
    }).catch(() => ({ opened: false, ready: false }));
    opened = cap.opened;
    if (cap.opened && cap.ready) { ready = true; break; }
  }
  return { opened: opened && ready, toast };
}

async function backToGreen(admin: Page) {
  if (!/\/monitor\/green/.test(admin.url())) { await gotoCourseMenu(admin, '코스 현황 관리', '그린 분석').catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
}
async function closePopup(admin: Page) {
  await admin.evaluate(() => {
    const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => (mo as HTMLElement).offsetParent && /그린 정보/.test(mo.textContent || ''));
    const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
    if (md) { const btn = Array.from(md.querySelectorAll('button')).find((b) => /^\s*확인\s*$/.test(b.textContent || '')); if (btn) (btn as HTMLElement).click(); }
  }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {});
  await admin.waitForTimeout(400);
}

// ── in-page 진단 유틸(문자열로 주입되어 page context 에서 실행) ──
// getMd: 그린 정보 modal 재선택(Vue 리렌더 대응 — 매 호출 fresh). findLeaf/ancestorChain/contentSig/fireNative.
const INPAGE = `
const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
const tight = (s) => (s || '').replace(/\\s+/g, '');
function vis(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; }   // ⚠ offsetParent 는 position:fixed 모달서 null → rect 기반 가시성
function getMd() {
  const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
    .filter((mo) => vis(mo) && /그린 정보/.test(mo.textContent || ''));
  return mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] || null;
}
function activeTab() { const md = getMd(); if (!md) return ''; const t = md.querySelector('.tab-group .active'); return t ? norm(t.textContent) : ''; }
function snap() {
  const md = getMd();
  const moreEls = md ? Array.from(md.querySelectorAll('*')).filter((e) => /더보기/.test(e.textContent || '') && !Array.from(e.children).some((c) => /더보기/.test(c.textContent || ''))) : [];
  const viewEls = md ? Array.from(md.querySelectorAll('button, a, [class*="btn"]')).filter((e) => /^\\s*보기\\s*$/.test(e.textContent || '')) : [];
  const firstRow = md ? md.querySelector('tbody tr') : null;
  const tabDivs = md ? Array.from(md.querySelectorAll('.tab-group.tab-type-box > div')).map((d) => ({ text: norm(d.textContent), active: /(^|\\s)active(\\s|$)/.test(typeof d.className === 'string' ? d.className : '') })) : [];
  const modalGroups = Array.from(document.querySelectorAll('[class*="modal-group"]')).filter((m) => { const r = m.getBoundingClientRect(); return r.width > 1 && r.height > 1 && /그린 정보/.test(m.textContent || ''); }).length;
  return {
    modalOpen: !!md, url: location.pathname, active: activeTab(),
    tabDivs, tabDivCount: tabDivs.length, modalGroups,
    rows: md ? md.querySelectorAll('tbody tr').length : 0,
    tables: md ? md.querySelectorAll('table').length : 0,
    more: moreEls.length, views: viewEls.length,
    moreDesc: moreEls.slice(0, 2).map((e) => ({ ...desc(e), clickTarget: desc(clickableAncestor(e)) })),
    viewDesc: viewEls.slice(0, 2).map((e) => desc(e)),
    firstRow: firstRow ? Array.from(firstRow.children).slice(0, 6).map((td) => { const inner = td.querySelector('a, [class*="link"], [class*="cursor"], button'); return { cellText: norm(td.textContent).slice(0, 24), innerClickable: inner ? desc(inner) : null }; }) : [],
  };
}
function desc(el) {
  if (!el) return null;
  const cls = typeof el.className === 'string' ? el.className : '';
  const cur = (getComputedStyle(el).cursor || '');
  return {
    tag: el.tagName.toLowerCase(),
    cls: cls.slice(0, 120),
    role: el.getAttribute('role') || '',
    cursor: cur,
    clickable: /^(button|a|li)$/.test(el.tagName.toLowerCase()) || el.getAttribute('role') === 'tab' || /tab|pointer|clickable|cursor/i.test(cls) || cur === 'pointer',
    text: norm(el.textContent).slice(0, 40),
    dataAttrs: Array.from(el.attributes).filter((a) => /^data-|^@|^v-|aria-selected/.test(a.name)).map((a) => a.name + '=' + a.value).slice(0, 6),
  };
}
function findLeaf(md, label) {
  if (!md) return null;
  const target = tight(label);
  const all = Array.from(md.querySelectorAll('*'));
  const matches = all.filter((e) => tight(e.textContent).includes(target));
  // leaf = 자식 중 동일 매칭 없는 최심 요소 중 텍스트 최단(가장 구체)
  const leaves = matches.filter((e) => !Array.from(e.children).some((c) => tight(c.textContent).includes(target)));
  leaves.sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
  return leaves[0] || null;
}
function ancestorChain(leaf) {
  const chain = [];
  let el = leaf;
  for (let i = 0; el && i < 7; i++) { chain.push(desc(el)); el = el.parentElement; }
  return chain;
}
function clickableAncestor(leaf) {
  let el = leaf;
  for (let i = 0; el && i < 7; i++) {
    const cls = typeof el.className === 'string' ? el.className : '';
    const cur = getComputedStyle(el).cursor || '';
    if (/^(button|a|li)$/.test(el.tagName.toLowerCase()) || el.getAttribute('role') === 'tab' || /tab-|tab_|-tab|pointer|clickable/i.test(cls) || cur === 'pointer') return el;
    el = el.parentElement;
  }
  return leaf;
}
function fireNative(el) {
  if (!el) return false;
  for (const type of ['pointerover','pointerenter','pointerdown','mousedown','pointerup','mouseup','click']) {
    try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
  }
  return true;
}
function contentSig() {
  const md = getMd();
  if (!md) return { len: 0, head: '', tables: 0, rows: 0 };
  const t = norm(md.innerText);
  return { len: t.length, head: t.slice(0, 200), tables: md.querySelectorAll('table').length, rows: md.querySelectorAll('tbody tr').length };
}
`;

interface ProbeOut {
  ts: string;
  entered: boolean;
  popupOpened: boolean;
  tabBarHTML: string;
  tabsFound: string[];
  leafDump: Record<string, unknown>;
  initialSnap: unknown;
  bakeoff: { target: string; strategies: { name: string; changed: boolean; before: unknown; after: unknown }[]; winner: string | null };
  sweep: { tab: string; strategy: string; switched: boolean; sig: unknown; more: unknown; titleCells: unknown; viewBtns: unknown }[];
  notes: string[];
}

test('그린 분석 팝업 탭 — leaf DOM 정밀 프로브 + 클릭 bake-off(진단)', async ({ page, context }) => {
  test.setTimeout(500_000);
  const admin = await openCourseAdmin(page, context);
  const out: ProbeOut = { ts: new Date().toISOString().slice(0, 19).replace('T', ' '), entered: false, popupOpened: false, tabBarHTML: '', tabsFound: [], leafDump: {}, initialSnap: null, bakeoff: { target: '', strategies: [], winner: null }, sweep: [], notes: [] };

  const finish = async () => {
    if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
    if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync(path.join('analysis', '_green-tab-probe.json'), JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join('reports', 'green-tab-probe.html'), renderHtml(out));
    console.log('\n══ 그린 탭 프로브 요약 ══');
    console.log(`진입 ${out.entered} · 팝업 ${out.popupOpened} · 탭 발견 ${out.tabsFound.length}종`);
    console.log(`bake-off 타깃 "${out.bakeoff.target}" → 승자 전략: ${out.bakeoff.winner ?? '없음(전 전략 실패)'}`);
    for (const s of out.bakeoff.strategies) console.log(`  · ${s.name}: ${s.changed ? '✅ 콘텐츠 변경' : '✗ 무변화'}`);
    console.log(`sweep 전환 성공: ${out.sweep.filter((s) => s.switched).length}/${out.sweep.length}탭`);
    const isnap = out.initialSnap as { tabDivCount?: number; modalGroups?: number; active?: string; tabDivs?: { text: string; active: boolean }[] } | null;
    if (isnap) console.log(`resting: 탭div ${isnap.tabDivCount}개 · modal-group ${isnap.modalGroups}개 · active "${isnap.active}" · 탭텍스트 [${(isnap.tabDivs || []).map((t) => t.text).join(' | ')}]`);
    for (const n of out.notes) console.log(`  [note] ${n}`);
    console.log(`[out] analysis/_green-tab-probe.json · reports/green-tab-probe.html`);
  };

  // ── 진입 ──
  if (!(await gotoCourseMenu(admin, '코스 현황 관리', '그린 분석').then(() => true).catch(() => false))) { out.notes.push('진입 실패(세션 만료 추정) — npm run course:auth 후 재실행'); await finish(); return; }
  out.entered = true;
  await admin.waitForTimeout(2_500); await killAlarms(admin);

  // 세션 생존 확인: SNB/홀 이미지/코스 탭이 전무하면 로그아웃(빈 화면) → 데이터 의존과 구분.
  const alive = await admin.evaluate(() => {
    const imgs = document.querySelectorAll('.contents img, main img').length;
    const hasTab = /West|East|South/.test(document.querySelector('.contents, main')?.textContent || '');
    const snb = document.querySelectorAll('[class*="depth"], nav a, aside a').length;
    return { imgs, hasTab, snb };
  }).catch(() => ({ imgs: 0, hasTab: false, snb: 0 }));
  if (!alive.imgs && !alive.hasTab) {
    out.notes.push(`⚠ 세션 만료 추정 — 그린 분석 화면 빈 값(홀 이미지 0·코스 탭 없음·SNB 링크 ${alive.snb}). npm run course:auth 후 재실행 필요.`);
    await finish(); return;
  }

  // ── 그린 등록 홀 팝업 오픈 ──
  let opened = false;
  for (let i = 0; i < 9 && !opened; i++) { const r = await clickHole(admin, i); if (r.opened) { opened = true; break; } if (!r.toast) await closePopup(admin); }
  // 다른 코스 탭(East/South)도 시도
  if (!opened) {
    const tg = M(admin).locator('.tab-group').filter({ hasText: /West|East|South/ }).first();
    for (const course of ['East', 'South']) {
      if (opened) break;
      await tg.getByText(course, { exact: true }).first().click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin);
      const n = await M(admin).locator('img').count().catch(() => 0);
      for (let i = 0; i < Math.min(n, 12) && !opened; i++) { const r = await clickHole(admin, i); if (r.opened) { opened = true; break; } if (!r.toast) await closePopup(admin); }
    }
  }
  if (!opened) { out.notes.push('그린 등록 홀 팝업 미검출(전 홀 미등록/데이터 의존)'); await finish(); return; }
  out.popupOpened = true;

  // ── Phase 1: leaf DOM 정밀 덤프 ──
  const dump = await admin.evaluate(`(() => { ${INPAGE}
    const md = getMd();
    if (!md) return null;
    // 탭 바 컨테이너 추정: 탭 라벨 leaf 들의 공통 조상(첫 라벨 leaf 의 3~4단 조상)
    const labels = ${JSON.stringify(TAB_LABELS)};
    const found = [];
    const leafDump = {};
    let tabBar = null;
    for (const lb of labels) {
      const leaf = findLeaf(md, lb);
      if (!leaf) { leafDump[lb] = { present: false }; continue; }
      found.push(lb);
      const anc = clickableAncestor(leaf);
      leafDump[lb] = { present: true, leaf: desc(leaf), clickTarget: desc(anc), sameAsLeaf: anc === leaf, chain: ancestorChain(leaf) };
      if (!tabBar && anc && anc.parentElement) tabBar = anc.parentElement;
    }
    const tabBarHTML = tabBar ? tabBar.outerHTML.replace(/\\s+/g, ' ').slice(0, 2400) : '';
    return { found, leafDump, tabBarHTML };
  })()`).catch((e) => { out.notes.push('Phase1 evaluate 실패: ' + String(e).slice(0, 120)); return null; }) as { found: string[]; leafDump: Record<string, unknown>; tabBarHTML: string } | null;

  if (dump) { out.tabsFound = dump.found; out.leafDump = dump.leafDump; out.tabBarHTML = dump.tabBarHTML; }
  if (!dump || !dump.found.length) { out.notes.push('탭 라벨 leaf 미검출'); await closePopup(admin); await finish(); return; }

  // 클릭 전 resting 상태: 6탭 div 텍스트·active·modal 개수 → tabDiv 미발견/닫힘 원인 규명 기준선.
  out.initialSnap = await admin.evaluate(`(() => { ${INPAGE} return snap(); })()`).catch(() => null);

  // 탭 로케이터 = tab-group 직속 div(정확). 텍스트 공백 가변 → \s* 매칭.
  const tabLoc = (label: string) => admin.locator('.tab-group.tab-type-box > div').filter({ hasText: new RegExp(`^\\s*${label.replace(/ /g, '\\s*')}\\s*$`) }).first();
  const snap = () => admin.evaluate(`(() => { ${INPAGE} return snap(); })()`).catch(() => null) as Promise<Record<string, unknown> | null>;
  const tight = (s: string) => (s || '').replace(/\s/g, '');
  const isActive = (s: Record<string, unknown> | null, tab: string) => !!(s && s.modalOpen && tight(String(s.active || '')) === tight(tab));
  const clickNative = (tab: string) => admin.evaluate(`(() => { ${INPAGE} const md=getMd(); if(!md) return; const leaf=findLeaf(md, ${JSON.stringify(tab)}); if(leaf) fireNative(clickableAncestor(leaf)); })()`).catch(() => {});
  const reopen = async () => { await closePopup(admin); await backToGreen(admin); for (let i = 0; i < 9; i++) { const r = await clickHole(admin, i); if (r.opened) return true; if (!r.toast) await closePopup(admin); } return false; };

  // ── Phase 2: 클릭 방식 확정(먼 탭에서 A: Playwright vs C: 네이티브, active 클래스 이동으로 판정) ──
  const target = dump.found.includes('작업 지시 리스트') ? '작업 지시 리스트' : dump.found.find((x) => x !== '기상 정보') || dump.found[0];
  out.bakeoff.target = target;
  {
    // A: Playwright 탭 div 클릭
    const b4 = await snap();
    await tabLoc(target).click({ timeout: 1_500 }).catch(() => {});
    await admin.waitForTimeout(900);
    let af = await snap();
    const aOk = isActive(af, target);
    out.bakeoff.strategies.push({ name: 'A: Playwright click(tab-group div)', changed: aOk, before: b4, after: af });
    if (aOk) out.bakeoff.winner = 'A';
    // 기상 복귀 후 C 시도(A 성공 여부와 무관하게 대조군 확보)
    await tabLoc('기상 정보').click({ timeout: 1_500 }).catch(() => {});
    await admin.waitForTimeout(700);
    const c4 = await snap();
    await clickNative(target);
    await admin.waitForTimeout(900);
    af = await snap();
    const cOk = isActive(af, target);
    out.bakeoff.strategies.push({ name: 'C: 네이티브 dispatch(pointer+mouse+click)', changed: cOk, before: c4, after: af });
    if (!out.bakeoff.winner && cOk) out.bakeoff.winner = 'C';
    await tabLoc('기상 정보').click({ timeout: 1_500 }).catch(() => {});
    await admin.waitForTimeout(600);
    if (!isActive(await snap(), '기상 정보') && !(await snap())?.modalOpen) await reopen();
  }
  const winner = out.bakeoff.winner ?? 'A';

  // ── Phase 3: 승자 전략으로 6탭 sweep(active 판정) + 각 탭 더보기/제목/보기 구조 덤프 ──
  for (const tab of dump.found) {
    let after = await snap();
    if (!after?.modalOpen) { if (!(await reopen())) { out.notes.push(`[${tab}] 팝업 재오픈 실패 — sweep 중단`); break; } }
    // 승자 전략 클릭
    if (winner === 'A') { await tabLoc(tab).click({ timeout: 1_500 }).catch(() => {}); } else { await clickNative(tab); }
    await admin.waitForTimeout(900);
    after = await snap();
    let method = winner;
    // 실패 시 반대 전략 폴백
    if (!isActive(after, tab)) {
      if (winner === 'A') await clickNative(tab); else await tabLoc(tab).click({ timeout: 1_500 }).catch(() => {});
      await admin.waitForTimeout(900);
      const retry = await snap();
      if (isActive(retry, tab)) { after = retry; method = winner === 'A' ? 'C(fallback)' : 'A(fallback)'; }
    }
    const switched = isActive(after, tab);
    out.sweep.push({ tab, strategy: switched ? method : `${method} 실패`, switched, sig: after, more: after?.moreDesc, titleCells: after?.firstRow, viewBtns: after?.viewDesc });
    if (after && !after.modalOpen) out.notes.push(`[${tab}] 클릭 후 팝업 닫힘/네비게이션(url=${after.url}) — in-modal 전환 아님(별도 처리 필요).`);
  }

  const okN = out.sweep.filter((s) => s.switched).length;
  if (okN === 0) out.notes.push('⚠ 6탭 전부 active 전환 실패 — tab-group active 셀렉터/타이밍 재점검 필요.');
  else out.notes.push(`✅ 6탭 전환 ${okN}/${out.sweep.length} 성공(판정: .tab-group .active 이동) · 권장 전략 ${winner} → course-green-deep.spec.ts 탭 클릭을 tabLoc + active 검증으로 교체.`);

  await closePopup(admin); await killAlarms(admin);
  await finish();
});

function esc(s: string): string { return (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string)); }
function renderHtml(o: ProbeOut): string {
  const j = (v: unknown) => esc(JSON.stringify(v, null, 2));
  const bake = o.bakeoff.strategies.map((s) => `<tr class="${s.changed ? 'ok' : 'ng'}"><td>${esc(s.name)}</td><td>${s.changed ? '✅ 변경' : '✗ 무변화'}</td></tr>`).join('');
  const sweep = o.sweep.map((s) => `<tr class="${s.switched ? 'ok' : 'ng'}"><td>${esc(s.tab)}</td><td>${s.switched ? '✅' : '✗'}</td><td>${esc(String((s.sig as { rows?: number })?.rows ?? '-'))}행</td><td>${Array.isArray(s.more) ? (s.more as unknown[]).length : 0}</td><td>${Array.isArray(s.viewBtns) ? (s.viewBtns as unknown[]).length : 0}</td></tr>`).join('');
  return `<style>body{font:14px/1.5 'Malgun Gothic',sans-serif;max-width:1000px;margin:0 auto;padding:20px;color:#1a1d24}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}pre{background:#161b22}}h1{font-size:20px}h2{font-size:15px;border-bottom:2px solid #ccc;padding-bottom:4px;margin-top:24px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #ccc;padding:5px 8px;text-align:left}tr.ok td{background:rgba(63,185,80,.12)}tr.ng td{background:rgba(248,81,73,.10)}pre{background:#f6f8fb;padding:10px;border-radius:6px;overflow:auto;font-size:11.5px;max-height:360px}</style>
<h1>그린 분석 팝업 탭 — leaf DOM 정밀 프로브</h1>
<p>수집 ${esc(o.ts)} · 진입 ${o.entered} · 팝업 ${o.popupOpened} · 탭 발견 ${o.tabsFound.length}종(${esc(o.tabsFound.join(', '))})</p>
<h2>클릭 전략 bake-off — 타깃 "${esc(o.bakeoff.target)}" · 승자 ${esc(o.bakeoff.winner ?? '없음')}</h2>
<table><thead><tr><th>전략</th><th>결과</th></tr></thead><tbody>${bake}</tbody></table>
<h2>6탭 sweep(승자 전략)</h2>
<table><thead><tr><th>탭</th><th>전환</th><th>테이블 행</th><th>더보기</th><th>보기</th></tr></thead><tbody>${sweep}</tbody></table>
<h2>resting 상태(클릭 전) — 탭 div 목록·active·modal 개수</h2><pre>${j(o.initialSnap)}</pre>
<h2>탭 바 outerHTML(정밀)</h2><pre>${esc(o.tabBarHTML || '(미검출)')}</pre>
<h2>탭별 leaf/클릭타깃 덤프</h2><pre>${j(o.leafDump)}</pre>
<h2>탭별 더보기/제목/보기 구조</h2><pre>${j(o.sweep.map((s) => ({ tab: s.tab, switched: s.switched, more: s.more, titleCells: s.titleCells, viewBtns: s.viewBtns })))}</pre>
<h2>notes</h2><pre>${esc(o.notes.join('\n'))}</pre>`;
}
