import { Page } from '@playwright/test';
import { gotoCourseMenu, killAlarms, setCourseOneYear } from './courseHelpers';

// ──────────────────────────────────────────────────────────────
//  예산·비용 원천 화면 캡처 공통 헬퍼(비파괴) — 테이블/카드 수집 + 페이지네이션 순회 + rowspan 격자 재구성.
//  course-budget-cost-verify 의 로컬 헬퍼를 공유화(신규 독립 재집계 스펙과 공용). 동작 동일.
// ──────────────────────────────────────────────────────────────

export interface Cell { t: string; rs: number; cs: number; }
export interface Tbl { heads: string[]; cells: Cell[][]; }
export interface Grab { cards: string[]; tables: Tbl[]; }

// 현재 화면 본문의 카드(숫자 포함 요약) + 테이블(최대 4개, 각 140행) 수집.
export async function grab(admin: Page): Promise<Grab> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const scope = document.querySelector('.contents, main') || document.body;
    const cards = Array.from(scope.querySelectorAll('[class*="card"], [class*="summary"], [class*="total"], [class*="amount"]'))
      .map((e) => norm(e.textContent)).filter((t) => t && t.length < 120 && /[0-9]/.test(t));
    const tables = Array.from(scope.querySelectorAll('table')).slice(0, 4).map((t) => ({
      heads: Array.from(t.querySelectorAll('thead th, thead td')).map((e) => norm(e.textContent)).filter(Boolean),
      cells: Array.from(t.querySelectorAll('tbody tr')).slice(0, 140).map((tr) => Array.from(tr.children).map((td) => ({ t: norm(td.textContent), rs: (td as HTMLTableCellElement).rowSpan || 1, cs: (td as HTMLTableCellElement).colSpan || 1 }))),
    }));
    return { cards: Array.from(new Set(cards)), tables };
  }).catch(() => ({ cards: [], tables: [] }));
}

// rowspan/colspan을 채워 완전한 격자(string[][])로 재구성.
export function gridOf(T: Tbl | undefined): { cols: number; grid: string[][] } {
  if (!T) return { cols: 0, grid: [] };
  const cols = Math.max(T.heads.length, ...T.cells.map((r) => r.reduce((a, c) => a + (c.cs || 1), 0)), 1);
  const carry: ({ t: string; rem: number } | null)[] = new Array(cols).fill(null);
  const grid: string[][] = [];
  for (const row of T.cells) {
    const out = new Array(cols).fill(''); let col = 0, ci = 0;
    while (col < cols) {
      if (carry[col] && carry[col]!.rem > 0) { out[col] = carry[col]!.t; carry[col]!.rem--; col++; continue; }
      if (ci < row.length) {
        const cell = row[ci++]; const span = cell.cs || 1;
        for (let k = 0; k < span && col + k < cols; k++) { out[col + k] = cell.t; if ((cell.rs || 1) > 1) carry[col + k] = { t: cell.t, rem: (cell.rs || 1) - 1 }; }
        col += span;
      } else col++;
    }
    grid.push(out);
  }
  return { cols, grid };
}

// 페이지네이션 전 페이지 순회 수집(원천 화면=인력/장비/자재는 페이지 분할) — 다음 페이지 클릭하며 행 누적.
export async function grabPaged(admin: Page, menu: string, sub: string, maxPages = 25, oneYear = false): Promise<Grab | null> {
  if (!(await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false))) return null;
  await admin.waitForTimeout(1500); await killAlarms(admin);
  // 비용 화면(datepicker 기본 3개월→빈값)은 검색기간 1년 설정 후 수집(작업별 비용 등).
  if (oneYear) { await setCourseOneYear(admin).catch(() => {}); await admin.waitForTimeout(1200); await killAlarms(admin); }
  const first = await grab(admin);
  if (!first.tables[0]) return first;
  const combined: Grab = { cards: first.cards, tables: [{ heads: first.tables[0].heads, cells: [...first.tables[0].cells] }] };
  let page = 1; let prevSig = first.tables[0].cells.map((r) => r.map((c) => c.t).join('|')).join('#');
  for (let i = 0; i < maxPages; i++) {
    const clicked = await admin.evaluate((target) => {
      const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && !(e as HTMLButtonElement).disabled;
      const norm = (s: string | null) => (s || '').trim();
      const cls = (e: Element) => (typeof e.className === 'string' ? e.className : '');
      const inPag = (e: Element) => { let p: Element | null = e; for (let k = 0; k < 4 && p; k++) { if (/pag/i.test(cls(p))) return true; p = p.parentElement; } return false; };
      const all = Array.from(document.querySelectorAll('button, a, li'));
      const nums = all.filter((e) => vis(e) && norm(e.textContent) === target);
      const btn = nums.find(inPag) || nums[nums.length - 1];
      if (btn) { (btn as HTMLElement).click(); return true; }
      const arrow = all.find((e) => vis(e) && (/next|다음/i.test(cls(e) + (e.getAttribute('aria-label') || '')) || /^[›❯»>]$/.test(norm(e.textContent))));
      if (arrow) { (arrow as HTMLElement).click(); return true; }
      return false;
    }, String(page + 1)).catch(() => false);
    if (!clicked) break;
    await admin.waitForTimeout(900); await killAlarms(admin);
    const g = await grab(admin); const cells = g.tables[0]?.cells || [];
    const sig = cells.map((r) => r.map((c) => c.t).join('|')).join('#');
    if (!cells.length || sig === prevSig) break;
    combined.tables[0].cells.push(...cells); prevSig = sig; page++;
  }
  return combined;
}

export const colIdx = (T: Tbl | undefined, re: RegExp): number => (T ? T.heads.findIndex((h) => re.test(h)) : -1);
