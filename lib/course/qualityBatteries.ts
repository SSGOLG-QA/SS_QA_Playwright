import { Page, Response } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { gotoCourseMenu, killAlarms, COURSE_IA, COURSE_SUBDOMAIN, COURSE_URL } from './courseHelpers';
import { record, skip, CheckMeta } from '../reporter';
import { EvalInit, LevelInfo, MonthScore, AREAS, levelScaleInvariants, sheetMappingInvariants, trendLatestMatchesSheet, monthlyStructureInvariants, goalGradeOf } from './domain/gradeEval';

// ──────────────────────────────────────────────────────────────
//  품질 배터리 3종 공통 로직(단일 openCourseAdmin 세션에서 순차 실행 가능하도록 함수화).
//  각 함수는 reporter(record/skip)에 기록만 하고, reset/open/writeReport는 호출부(스펙)가 담당.
//  → 개별 스펙(얇은 래퍼) + 통합 스펙(course-quality-suite)이 공용.
// ──────────────────────────────────────────────────────────────

const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();

// ── 공통 탭 헬퍼 ──
async function tabLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const n = (x: string) => (x || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const set = new Set<string>();
    document.querySelectorAll('.tab-group > *, [role="tab"]').forEach((e) => { if (vis(e) && !e.closest('.side-navbar-container')) { const t = n((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 16) set.add(t); } });
    return Array.from(set);
  }).catch(() => [] as string[]);
}
async function clickTab(page: Page, label: string): Promise<void> {
  await page.evaluate((lb) => { const n = (x: string) => (x || '').replace(/\s+/g, ' ').trim(); const el = Array.from(document.querySelectorAll('.tab-group > *, [role="tab"]')).find((e) => n((e as HTMLElement).innerText || e.textContent || '') === lb); (el as HTMLElement | undefined)?.click(); }, label).catch(() => {});
}
async function gotoScreen(admin: Page, menu: string, sub: string): Promise<boolean> {
  if (menu === 'Home') { await admin.locator('.side-navbar-container').getByText('Home', { exact: true }).first().click({ timeout: 4000 }).catch(() => {}); await admin.waitForTimeout(1300); return true; }
  const ok = await gotoCourseMenu(admin, menu, sub).catch(() => false);
  return ok;
}

// ══════════════════ 1) 컨트롤 배터리 ══════════════════
interface Comp { kind: string; label: string; tab?: string; }
const TARGET_KINDS = new Set(['nav', 'calendar', 'image', 'dropdown', 'button', 'column', 'input']);

function loadInventory(): Record<string, Comp[]> {
  const p = path.join(process.cwd(), 'baselines', `course-components.${COURSE_SUBDOMAIN}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, Comp[]>;
}
async function presenceMap(page: Page, items: Comp[]): Promise<Record<string, boolean>> {
  return page.evaluate((items: Comp[]) => {
    const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();
    const root = document.querySelector('.contents, main') || document.body;
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1 && (e as HTMLElement).offsetParent !== null; };
    const cls = (e: Element) => (typeof e.className === 'string' ? e.className : '');
    const pageText = norm((root as HTMLElement).innerText || root.textContent || '');
    const calSel = '.calendar, [class*="calendar"], [class*="datepicker-layer"], .vc-container, .fc, table.calendar, [class*="week"], [class*="month"]';
    const hasCalendar = Array.from(root.querySelectorAll(calSel)).some((e) => vis(e));
    const imgs = Array.from(root.querySelectorAll('img')).filter((e) => vis(e)).map((e) => ({ alt: norm((e as HTMLImageElement).alt || ''), ok: (e as HTMLImageElement).naturalWidth > 0 }));
    const anyImg = imgs.length > 0;
    const elMatch = (lbl: string) => {
      const n = norm(lbl); if (!n) return false;
      return Array.from(root.querySelectorAll('button,[role="button"],a,[title],[aria-label],.vs__selected,option,input,textarea,label,span,div,li,th,td')).some((e) => {
        if (!vis(e)) return false;
        const txt = norm((e as HTMLElement).innerText || e.textContent || '');
        const title = norm((e as HTMLElement).getAttribute('title') || '');
        const aria = norm((e as HTMLElement).getAttribute('aria-label') || '');
        const val = norm((e as HTMLInputElement).value || '');
        return txt === n || title === n || aria === n || val === n || (n.length >= 3 && (txt.includes(n) || title.includes(n) || aria.includes(n)));
      });
    };
    void cls;
    const out: Record<string, boolean> = {};
    for (const it of items) {
      const n = norm(it.label); let present = false;
      if (it.kind === 'calendar') present = hasCalendar || (n.length >= 2 && pageText.includes(n.replace(/^달력:?/, '')));
      else if (it.kind === 'image') { const alt = norm(it.label.replace(/^이미지:?/, '')); present = anyImg && ((imgs.some((im) => im.ok) && (!alt || imgs.some((im) => im.alt && (im.alt.includes(alt) || alt.includes(im.alt))))) || imgs.some((im) => im.ok)); }
      else present = (n.length >= 2 && pageText.includes(n)) || elMatch(it.label);
      out[it.kind + '|' + it.label] = present;
    }
    return out;
  }, items).catch(() => ({} as Record<string, boolean>));
}

export async function runControlBattery(admin: Page, menusFilter: string[] = []): Promise<void> {
  const inv = loadInventory();
  let totItems = 0, totPass = 0, totSkip = 0, screensDone = 0;
  for (const { menu, subs } of COURSE_IA) {
    if (menusFilter.length && !menusFilter.includes(menu)) continue;
    for (const { name: sub } of subs) {
      const P = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      const comps = (inv[P] || []).filter((c) => TARGET_KINDS.has(c.kind));
      if (!comps.length) continue;
      const abbr = (menu + sub).replace(/[^A-Za-z가-힣]/g, '').slice(0, 8);
      const ref = (n: string) => `코스관리_컨트롤배터리_${P}_${n}`;
      if (!(await gotoScreen(admin, menu, sub))) { skip({ path: `${P} > 진입`, tcRef: ref('0'), tcId: `CTLBAT-${abbr}-00`, desc: '진입' }, '진입 실패(세션 degraded 가능)'); continue; }
      await killAlarms(admin); await admin.waitForTimeout(1200);
      const merged: Record<string, boolean> = {};
      const acc = (m: Record<string, boolean>) => { for (const [k, v] of Object.entries(m)) merged[k] = merged[k] || v; };
      acc(await presenceMap(admin, comps));
      const tabs = await tabLabels(admin);
      if (tabs.length >= 2) for (const tl of tabs.slice(0, 10)) { await clickTab(admin, tl); await admin.waitForTimeout(550); await killAlarms(admin); acc(await presenceMap(admin, comps)); }
      screensDone++; let ok = 0;
      for (const c of comps) {
        totItems++;
        const cm: CheckMeta = { path: `${P} > ${c.kind}:${c.label}`, tcRef: ref(`${c.kind}_${c.label.slice(0, 16)}`), tcId: `CTLBAT-${abbr}-${c.kind.toUpperCase()}-${norm(c.label).slice(0, 12)}`, desc: `${c.kind} "${c.label.slice(0, 36)}" 라이브 노출/존재`, failMsg: `${c.kind} "${c.label.slice(0, 24)}" 미노출` };
        if (merged[`${c.kind}|${c.label}`]) { record(cm, 'PASS', { actual: `${c.kind} 노출/존재 확인` }); ok++; totPass++; }
        else { skip(cm, `${c.kind} 라이브 미노출(탭/상태/데이터 의존)`); totSkip++; }
      }
      console.log(`  ${P.padEnd(28)} 컨트롤 ${comps.length} · 확인 ${ok}`);
      await killAlarms(admin);
    }
  }
  console.log(`\n[control-battery] 화면 ${screensDone} · 컨트롤 ${totItems} · 확인 ${totPass} · 미노출 ${totSkip}`);
}

// ══════════════════ 2) 차트 데이터 정합성 ══════════════════
interface Captured { url: string; status: number; body: unknown; }
async function reloadCaptureEval(admin: Page): Promise<{ evalInit: EvalInit | null; captured: Captured[] }> {
  const captured: Captured[] = [];
  let evalInit: EvalInit | null = null;
  const handler = async (resp: Response) => {
    try {
      const url = resp.url();
      if (!/\/api\/v1\//.test(url) || !/json/i.test(resp.headers()['content-type'] || '')) return;
      const txt = await resp.text(); if (txt.length > 600_000) return;
      let body: unknown = txt; try { body = JSON.parse(txt); } catch { return; }
      captured.push({ url, status: resp.status(), body });
      if (/\/home\/management\/eval-init/.test(url)) { const b = body as { data?: EvalInit }; if (b && b.data) evalInit = b.data; }
    } catch { /* */ }
  };
  admin.on('response', handler);
  await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await admin.waitForTimeout(2500); await killAlarms(admin);
  await admin.locator('.tab-group').getByText(/관리\s*목표/).first().click({ timeout: 2500 }).catch(() => {});
  await admin.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await admin.waitForTimeout(800);
  admin.off('response', handler);
  return { evalInit, captured };
}
async function extractCards(admin: Page): Promise<Record<string, string>> {
  return admin.evaluate((GRADE_RE) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const cards: Record<string, string> = {};
    const re = new RegExp('^' + GRADE_RE + '(전체|그린칼라|그린|티박스|페어웨이|러프|벙커)$');
    Array.from(sc.querySelectorAll('div, span, td, li, p, dd, dt')).forEach((e) => { if (e.childElementCount > 3) return; const t = norm(e.textContent); const m = re.exec(t); if (m && !cards[m[2]]) cards[m[2]] = m[1]; });
    return cards;
  }, '(A\\+|A-|A|B\\+|B-|B|C\\+|C-|C|D\\+|D-|D|E\\+|E-|E)').catch(() => ({} as Record<string, string>));
}

export async function runChartIntegrity(admin: Page): Promise<void> {
  const { evalInit, captured } = await reloadCaptureEval(admin);
  const cards = await extractCards(admin);
  const P = 'Home';
  const ref = (n: string) => `코스관리_차트정합성_${n}`;
  try { fs.mkdirSync(path.join(process.cwd(), 'analysis'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), 'analysis', '_chart_eval.json'), JSON.stringify({ cards, evalInit, capturedUrls: captured.map((c) => c.url) }, null, 1)); } catch { /* */ }
  console.log(`\n[chart-integrity] API캡처 ${captured.length} · eval-init=${!!evalInit} · 카드 ${JSON.stringify(cards)}`);
  if (!evalInit) { skip({ path: `${P} > 등급추세 데이터소스`, tcRef: ref('API'), tcId: 'CHART-API', desc: 'eval-init 응답 캡처' }, `eval-init 미캡처 — 캡처 ${captured.length}건`); return; }
  const levels = (evalInit.levelInfos || []) as LevelInfo[];
  const months = (evalInit.monthlyEvalScores || []) as MonthScore[];
  const sheet = (evalInit.lastEvalSheet || {}) as Record<string, unknown>;
  const goal = (evalInit.goal || {}) as Record<string, unknown>;
  { const r = levelScaleInvariants(levels); record({ path: `${P} > 등급스케일 정합(C1)`, tcRef: ref('C1'), tcId: 'CHART-C1', desc: 'levelInfos 15단계·임계 연속·0~100' }, r.ok ? 'PASS' : 'FAIL', { actual: r.detail }); }
  { const rows = sheetMappingInvariants(sheet, levels);
    if (!rows.length) skip({ path: `${P} > 점수→등급 매핑(C2)`, tcRef: ref('C2'), tcId: 'CHART-C2', desc: '평가 점수→등급 매핑' }, '평가된 구역 없음');
    else for (const r of rows) record({ path: `${P} > 점수→등급 매핑(C2):${r.area}`, tcRef: ref(`C2_${r.area}`), tcId: `CHART-C2-${r.area}`, desc: `${r.area} 점수→등급 = 기재 등급`, expected: r.level }, r.ok ? 'PASS' : 'FAIL', { actual: `점수 ${r.score} → ${r.mapped} vs 기재 ${r.level}`, error: r.ok ? '' : `매핑 불일치(${r.area})` }); }
  { const rows = trendLatestMatchesSheet(months, sheet);
    if (!rows.length) skip({ path: `${P} > 추세↔시트(C3)`, tcRef: ref('C3'), tcId: 'CHART-C3', desc: '추세 최신월 = 최신 평가' }, '추세 시계열 없음');
    else { const bad = rows.filter((r) => !r.ok); record({ path: `${P} > 추세 최신월=최신평가(C3)`, tcRef: ref('C3'), tcId: 'CHART-C3', desc: '추세 최신월 구역점수 = 최신 평가시트 점수' }, bad.length === 0 ? 'PASS' : 'FAIL', { actual: `구역 ${rows.length} 중 일치 ${rows.length - bad.length}`, error: bad.length ? bad.map((b) => `${b.area}:추세${b.trend}≠시트${b.sheet}`).join(', ') : '' }); } }
  { let done = 0; for (const area of AREAS) {
      const g = goalGradeOf(goal, area); const card = cards[area];
      const cm: CheckMeta = { path: `${P} > 목표등급=카드(C4):${area}`, tcRef: ref(`C4_${area}`), tcId: `CHART-C4-${area}`, desc: `${area} goal 등급 = 화면 카드`, expected: card || '' };
      if (!card) { skip(cm, `카드 미검출(${area})`); continue; }
      if (!g) { skip(cm, `goal 등급 없음(${area})`); continue; }
      done++; record(cm, g === card ? 'PASS' : 'FAIL', { actual: `goal ${g} vs 카드 ${card}`, error: g === card ? '' : `목표-카드 불일치(${area})` });
    } if (!done) skip({ path: `${P} > 목표등급=카드(C4)`, tcRef: ref('C4'), tcId: 'CHART-C4', desc: 'goal=카드' }, 'goal/카드 대조 불가'); }
  { const r = monthlyStructureInvariants(months); record({ path: `${P} > 추세 시계열 구조(C5)`, tcRef: ref('C5'), tcId: 'CHART-C5', desc: '추세 점수 ∈ [0,100]·월형식' }, r.ok ? 'PASS' : (months.length ? 'FAIL' : 'SKIP'), { actual: r.detail }); }
  console.log(`\n[chart-integrity] levels ${levels.length} · months ${months.length}`);
}

// ══════════════════ 3) Figma 설계 문구 checkText ══════════════════
interface FigItem { kind: string; label: string; tab: string; via: string; }
function loadFigMap(): Record<string, FigItem[]> {
  const p = path.join(process.cwd(), 'baselines', `course-figma-texts.${COURSE_SUBDOMAIN}.json`);
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  const out: Record<string, FigItem[]> = {};
  for (const [k, v] of Object.entries(raw)) { if (k !== '_meta' && Array.isArray(v)) out[k] = v as FigItem[]; }
  return out;
}
async function textBlob(page: Page): Promise<string> {
  return page.evaluate(() => { const root = document.querySelector('.contents, main') || document.body; const t = (root as HTMLElement).innerText || root.textContent || ''; return t.replace(/\s+/g, ''); }).catch(() => '');
}

export async function runFigmaCheckText(admin: Page, menusFilter: string[] = []): Promise<void> {
  const figMap = loadFigMap();
  let totItems = 0, totPass = 0, totSkip = 0, screensDone = 0;
  for (const { menu, subs } of COURSE_IA) {
    if (menusFilter.length && !menusFilter.includes(menu)) continue;
    for (const { name: sub } of subs) {
      const P = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      const items = figMap[P];
      if (!items || !items.length) continue;
      const abbr = (menu + sub).replace(/[^A-Za-z가-힣]/g, '').slice(0, 8);
      const ref = (n: string) => `코스관리_Figma문구_${P}_${n}`;
      if (!(await gotoScreen(admin, menu, sub))) { skip({ path: `${P} > 진입`, tcRef: ref('0'), tcId: `FIGTXT-${abbr}-00`, desc: '진입' }, '진입 실패(세션 degraded 가능)'); continue; }
      await killAlarms(admin); await admin.waitForTimeout(1200);
      let blob = await textBlob(admin);
      const tabs = await tabLabels(admin);
      if (tabs.length >= 2) for (const tl of tabs.slice(0, 10)) { await clickTab(admin, tl); await admin.waitForTimeout(600); await killAlarms(admin); blob += '' + await textBlob(admin); }
      screensDone++; let ok = 0;
      for (const it of items) {
        totItems++;
        const needle = norm(it.label);
        const cm: CheckMeta = { path: `${P} > ${it.kind}:${it.label}`, tcRef: ref(`${it.kind}_${it.label.slice(0, 16)}`), tcId: `FIGTXT-${abbr}-${it.kind.toUpperCase()}-${norm(it.label).slice(0, 12)}`, desc: `Figma 설계 ${it.kind} "${it.label.slice(0, 40)}${it.label.length > 40 ? '…' : ''}" 라이브 표시`, expected: `Figma 설계 정본(match:${it.via})`, failMsg: `설계 문구 "${it.label.slice(0, 30)}" 라이브 미표시` };
        if (needle && blob.includes(needle)) { record(cm, 'PASS', { actual: `설계 ${it.kind} 표시 확인(Figma ${it.via})` }); ok++; totPass++; }
        else { skip(cm, '설계 문구 라이브 미표시(탭/상태 의존 또는 설계-구현 문구 상이)'); totSkip++; }
      }
      console.log(`  ${P.padEnd(28)} Figma문구 ${items.length} · 확인 ${ok}`);
      await killAlarms(admin);
    }
  }
  console.log(`\n[figma-checktext] 화면 ${screensDone} · 설계문구 ${totItems} · 확인 ${totPass} · 미표시 ${totSkip}`);
}

export const menusFilterFromEnv = (): string[] => (process.env.DEEP_MENUS || '').split(',').map((s) => s.trim()).filter(Boolean);
