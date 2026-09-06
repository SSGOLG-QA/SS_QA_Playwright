import { Page } from '@playwright/test';
import { GraphCard } from './domain/graphCardRollup';

// ──────────────────────────────────────────────────────────────
//  그래프 카드 파싱(공용, 비파괴) — [전체 카드 + 카테고리 카드]가 노출되는 화면에서
//   카테고리별 {예산·사용·잔여·초과}를 텍스트로 긁어온다(예산 분석 연간 그래프 등).
//   앵커(연간예산 + 잔여 예산)를 함께 포함한 짧은 div 블록을 카드로 보고, 카테고리명 프리픽스로 매칭.
// ──────────────────────────────────────────────────────────────

export interface ParseOpts {
  budgetAnchor?: string;  // 카드 식별 앵커1(기본 '연간예산')
  remainAnchor?: string;  // 카드 식별 앵커2(기본 '잔여\\s*예산')
  budgetLabel?: string;   // 예산 값 라벨(기본 '연간예산')
  usedLabel?: string;     // 사용 값 라벨(기본 '누적\\s*사용')
  remainLabel?: string;   // 잔여 값 라벨(기본 '잔여\\s*예산')
}

/** cats(전체+카테고리명) → {cat: {budget,used,remain,over}}. 파싱 실패는 빈 객체(호출부가 na 처리). */
export async function parseGraphCards(admin: Page, cats: string[], opts: ParseOpts = {}): Promise<Record<string, GraphCard>> {
  const ba = opts.budgetAnchor ?? '연간예산';
  const ra = opts.remainAnchor ?? '잔여\\s*예산';
  const bl = opts.budgetLabel ?? '연간예산';
  const ul = opts.usedLabel ?? '누적\\s*사용';
  const rl = opts.remainLabel ?? '잔여\\s*예산';
  return admin.evaluate((p: { cats: string[]; ba: string; ra: string; bl: string; ul: string; rl: string }) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const numAfter = (t: string, label: string) => { const m = t.match(new RegExp(label + '\\s*(-?[\\d,]+)')); return m ? Number(m[1].replace(/,/g, '')) : null; };
    const sc = document.querySelector('.contents, main') || document.body;
    const blocks = Array.from(sc.querySelectorAll('div')).filter((d) => { const t = norm(d.textContent); return new RegExp(p.ba).test(t) && new RegExp(p.ra).test(t) && t.length < 600; });
    const out: Record<string, { budget: number | null; used: number | null; remain: number | null; over: number | null }> = {};
    for (const cat of p.cats) {
      const key = cat.replace(/\s/g, '');
      const cand = blocks.filter((d) => norm(d.textContent).replace(/\s/g, '').startsWith(key));
      cand.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
      const card = cand[0]; if (!card) continue;
      const t = norm(card.textContent);
      out[cat] = { budget: numAfter(t, p.bl), used: numAfter(t, p.ul), remain: numAfter(t, p.rl), over: numAfter(t, '초과') };
    }
    return out;
  }, { cats, ba, ra, bl, ul, rl }).catch(() => ({} as Record<string, GraphCard>));
}
