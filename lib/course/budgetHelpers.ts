import { Page } from '@playwright/test';
import { killAlarms } from './courseHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// 코스관리 예산 상세 / 실적 관리 테스트 데이터 생성 공용 헬퍼.
//   3개 스펙(budget-testdata·budget-money·perf-testdata)에 중복돼 있던 값 공식 + 그리드 메커니즘 통합.
//   ⚠ 실적(perf)이 예산(budget)과 **동일 공식**을 참조하도록 일원화 — 이전엔 amountFor 기본값이
//      예산 1,000,000 vs 실적 100,000으로 불일치했음(미매칭 소분류에서 예산≠실적 기준). 여기선 1,000,000로 통일.
// ─────────────────────────────────────────────────────────────────────────────

/** 월별 변동계수(1~12월). 만원 단위 반올림과 함께 매월 다른 값 생성. */
export const FACTORS = [1.00, 0.90, 1.10, 0.95, 1.15, 1.05, 0.85, 1.00, 1.20, 0.92, 1.08, 1.30];

/** FNV-1a 해시(안정적 의사난수 — 중분류/소분류별 상이값). */
export function hashN(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// 고정직 인건비 소분류(부분일치) → 월 기준액(원). ⚠ 순서 중요: '퇴직'을 '급여'보다 먼저.
const AMT: [RegExp, number][] = [
  [/퇴직/, 2_500_000], [/급여/, 30_000_000],
  [/임금|일당|잡급|시급|용역/, 8_000_000], [/상여/, 2_000_000], [/수당/, 1_500_000],
  [/국민연금/, 1_350_000], [/건강보험/, 1_060_000], [/고용보험/, 270_000], [/산재/, 180_000], [/장기요양/, 137_000],
  [/식대/, 600_000], [/피복/, 200_000], [/간식/, 150_000], [/회식/, 300_000], [/명절/, 500_000],
];
export function amountFor(label: string): number { for (const [re, v] of AMT) if (re.test(label)) return v; return 1_000_000; }

export interface Grp { head: number; femaleHead: number; days: number; rate: number }
/** 임시직 작업그룹(중분류)별 인원/투입일/단가 — 그룹마다 금액 차별화(고정직의 80~90% 목표). */
export function groupParams(mid: string): Grp {
  if (/그린모아/.test(mid)) return { head: 8, femaleHead: 5, days: 8, rate: 105_000 };
  if (/볼마크/.test(mid)) return { head: 4, femaleHead: 3, days: 6, rate: 100_000 };
  if (/일반관리/.test(mid)) return { head: 6, femaleHead: 4, days: 7, rate: 115_000 };
  if (/기타/.test(mid)) return { head: 5, femaleHead: 3, days: 6, rate: 95_000 };
  return { head: 5, femaleHead: 3, days: 6, rate: 100_000 };
}

/** 고정직 12개월 값(base × FACTORS, 만원 반올림). */
export function monthVals(base: number): number[] { return FACTORS.map((f) => Math.round((base * f) / 10_000) * 10_000); }

/** 탭·중분류·소분류·월(0-index)로 예산 월 금액 계산(고정직/임시직/금액형 자동 분기). 실적 variance 기준. */
export function budgetMonth(tab: string, mid: string, sub: string, m: number): number {
  const f = FACTORS[m];
  if (/고정직/.test(tab)) return Math.round((amountFor(sub || mid) * f) / 10_000) * 10_000;
  if (/임시직/.test(tab)) {
    const g = groupParams(mid);
    const head = /여자/.test(sub) ? g.femaleHead : g.head;
    const qty = Math.max(1, Math.round(head * f));
    const days = Math.min(28, Math.max(1, Math.round(g.days * f)));
    const rate = Math.round((g.rate * f) / 1_000) * 1_000;
    return qty * days * rate;
  }
  // 금액형(자재비/장비 관리비/기타 관리비): 단가 × 수량
  const danga = 4_000 + (hashN(`${mid}_${sub}_x`) % 16) * 2_000;
  const qtyBase = 25 + (hashN(`${mid}_${sub}`) % 16) * 5;
  const qty = Math.max(1, Math.round(qtyBase * f));
  return danga * qty;
}

// ── 그리드 메커니즘 ──────────────────────────────────────────────────────────
/** 예산 상세 탭 클릭 + [수정] 진입. editOptional=true면 수정 버튼 없어도(실적처럼 상주 입력칸) 통과. */
export async function enterBudgetTabEdit(admin: Page, tab: string, editOptional = false): Promise<boolean> {
  const t = admin.getByText(tab, { exact: true }).first();
  if (await t.isVisible({ timeout: 2_000 }).catch(() => false)) { await t.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_200); }
  await killAlarms(admin);
  const edit = admin.getByRole('button', { name: '수정', exact: true }).last();
  if (await edit.isVisible({ timeout: 2_000 }).catch(() => false)) { await edit.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(1_200); await killAlarms(admin); return true; }
  return editOptional;
}

/** 수정 모드 저장(저장/적용 → 확인). */
export async function saveBudgetGrid(admin: Page): Promise<boolean> {
  let saved = false;
  for (const lbl of ['저장', '적용', '확인']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 800 }).catch(() => false) && await b.isEnabled().catch(() => false)) { await b.click({ timeout: 2_500 }).catch(() => {}); saved = true; break; } }
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  for (const lbl of ['확인', '예', '저장']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 700 }).catch(() => false)) { await b.click({ timeout: 1_500 }).catch(() => {}); break; } }
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  return saved;
}

/** tbody 각 행의 중분류/소분류(rowspan 이월). 데이터 행(입력칸 보유)에서만 carry 갱신(소계 오염 방지). */
export async function mapRowMeta(admin: Page): Promise<{ mid: string; sub: string }[]> {
  return await admin.evaluate(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    let mid = '', sub = '';
    return rows.map((tr) => {
      const hasInput = !!tr.querySelector('input');
      const tds = [...tr.children];
      const leading: string[] = [];
      for (const td of tds) { if (td.querySelector('input')) break; const t = (td.textContent || '').replace(/\s+/g, ' ').trim(); if (t) leading.push(t); }
      if (hasInput) { if (leading.length >= 2) { mid = leading[0]; sub = leading[1]; } else if (leading.length === 1) { sub = leading[0]; } }
      return { mid, sub };
    });
  }).catch(() => [] as { mid: string; sub: string }[]);
}

/** 헤더 X좌표로 각 입력칸의 컬럼 식별 + 중분류/소분류 이월(금액-컬럼형 탭). */
export async function detectColumnPlan(admin: Page): Promise<{ cols: string[]; plan: { mid: string; sub: string; col: string }[] }> {
  return await admin.evaluate(() => {
    const ths = [...document.querySelectorAll('table thead th')].map((th) => { const r = th.getBoundingClientRect(); return { name: (th.textContent || '').replace(/\s+/g, ' ').trim(), x1: r.left, x2: r.right }; });
    const colOf = (x: number) => { for (const c of ths) if (x >= c.x1 && x < c.x2) return c.name; return ''; };
    const rows = [...document.querySelectorAll('table tbody tr')];
    let mid = '', sub = '';
    const plan: { mid: string; sub: string; col: string }[] = [];
    for (const tr of rows) {
      const tds = [...tr.children];
      let rMid = '', rSub = '';
      for (const td of tds) { if (td.querySelector('input')) continue; const r = (td as HTMLElement).getBoundingClientRect(); const col = colOf(r.left + r.width / 2); const t = (td.textContent || '').replace(/\s+/g, ' ').trim(); if (col === '중분류' && t) rMid = t; if (col === '소분류' && t) rSub = t; }
      if (rMid) mid = rMid; if (rSub) sub = rSub;
      for (const inp of [...tr.querySelectorAll('input')]) { const r = (inp as HTMLElement).getBoundingClientRect(); plan.push({ mid, sub, col: colOf(r.left + r.width / 2) }); }
    }
    return { cols: ths.map((t) => t.name), plan };
  }).catch((e) => ({ cols: [], plan: [], error: String(e) } as any));
}
