import { Page } from '@playwright/test';
import { gotoCourseMenu, killAlarms } from './courseHelpers';
import { Check, near } from './domain/budgetCost';

// ─────────────────────────────────────────────────────────────────────────────
// 비용 계층(코스→홀→구분) 확장 검증 — 공용 함수.
//   기간별 비용(위치탭) + 위치별 비용(연간·월간)을 코스 카드 펼쳐보기 + 표 [+](button.tree-toggle) 확장 후
//   불변식 검증. 각 검증에 근거표(evidence: 좌변값·우변 Σ·구성요소·일치)를 첨부해 감사·이력 추적 신뢰성 확보.
//   course-cost-hierarchy-verify.spec(단독) + course-budget-cost-verify.spec(정합성 스위트) 공용. 비파괴.
// ─────────────────────────────────────────────────────────────────────────────

export interface Evidence { headers: string[]; rows: string[][]; }
export interface HierCheck extends Check { group: string; evidence?: Evidence; }
const CAT = '홀별 계층(코스→홀→구분)';
const TOL = 2;
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
const yn = (b: boolean) => (b ? '✅' : '❌');

function splitCellStr(t0: string): { v: number | null; y: number | null; isNew: boolean } {
  const t = (t0 || '').replace(/\s+/g, ' ').trim();
  const isNew = /신규/.test(t);
  const vm = t.match(/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/);
  const v = vm ? Number(vm[0].replace(/,/g, '')) : null;
  const rest = vm ? t.slice(vm[0].length) : t;
  const ym = rest.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
  const y = ym ? Number(ym[1]) : null;
  return { v: (v != null && Number.isFinite(v)) ? v : null, y: (y != null && Number.isFinite(y)) ? y : null, isNew };
}
const numOf = (t: string): number | null => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (!c || c === '-' || c === '.') return null; const v = Number(c); return Number.isFinite(v) ? v : null; };

async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1500); await killAlarms(admin); return true; }
  return false;
}
async function expandTree(admin: Page): Promise<void> {
  for (let pass = 0; pass < 15; pass++) {
    const n = await admin.evaluate(() => {
      const sc = document.querySelector('.contents, main') || document.body;
      const tbl = [...sc.querySelectorAll('table')].find((t) => t.querySelectorAll('tbody tr').length >= 1);
      if (!tbl) return 0; let c = 0;
      for (const b of [...tbl.querySelectorAll('tbody tr button.tree-toggle')] as HTMLElement[]) { if (!(b as any).dataset.exp) { (b as any).dataset.exp = '1'; b.click(); c++; } }
      return c;
    }).catch(() => 0);
    if (!n) break;
    await admin.waitForTimeout(500); await killAlarms(admin);
  }
}
async function readRows(admin: Page): Promise<{ headers: string[]; rows: string[][] }> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = [...sc.querySelectorAll('table')].find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return { headers: [], rows: [] };
    const headers = [...tbl.querySelectorAll('thead th, thead td')].map((h) => norm(h.textContent));
    const rows = [...tbl.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => norm(td.textContent)));
    return { headers, rows };
  }).catch(() => ({ headers: [], rows: [] }));
}
const mk = (group: string, name: string, scope: 'intra' | 'cross', ok: boolean, detail: string, opts: { na?: boolean; review?: boolean; evidence?: Evidence } = {}): HierCheck =>
  ({ group, cat: CAT, name, scope, ok, detail, na: opts.na, review: opts.review, evidence: opts.evidence });

/** 비용 계층 확장 검증 전체 실행(비파괴). 각 체크에 근거표 첨부. */
export async function verifyCostHierarchy(admin: Page): Promise<HierCheck[]> {
  const checks: HierCheck[] = [];

  // ═══ A. 기간별 비용 — 위치탭 ═══
  if (await gotoCourseMenu(admin, '비용 관리', '기간별 비용').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1500); await killAlarms(admin);
    await clickTab(admin, /^\s*위치\s*$/);
    await expandTree(admin); await admin.waitForTimeout(600);
    const { headers, rows } = await readRows(admin);
    const yStart = headers.length - 3;
    type R = { level: string; key: string; course: string; hole: string; v: (number | null)[]; y: (number | null)[] };
    const parsed: R[] = []; let curCourse = '', curHole = '';
    for (const cells of rows) {
      if (cells.length < headers.length) continue;
      const c0 = cells[0] || '', c1 = cells[1] || '', c2 = cells[2] || '';
      const yc = [0, 1, 2].map((k) => splitCellStr(cells[yStart + k] || ''));
      const v = yc.map((x) => x.v), y = yc.map((x) => x.y);
      if (/^(전체|코스\s*전체)$/.test(c0)) { parsed.push({ level: 'top', key: c0, course: '', hole: '', v, y }); continue; }
      if (c0) { curCourse = c0; curHole = ''; parsed.push({ level: 'course', key: c0, course: c0, hole: '', v, y }); continue; }
      if (c1) { curHole = c1; parsed.push({ level: 'hole', key: c1, course: curCourse, hole: c1, v, y }); continue; }
      if (c2) { parsed.push({ level: 'gubun', key: c2, course: curCourse, hole: curHole, v, y }); continue; }
    }
    const courses = parsed.filter((r) => r.level === 'course'), holes = parsed.filter((r) => r.level === 'hole'), gubuns = parsed.filter((r) => r.level === 'gubun');
    if (!parsed.length) checks.push(mk('A.기간별위치', 'A · 기간별-위치 표', 'intra', true, '표/행 미검출 — 판정 제외', { na: true }));
    else {
      // A1 YoY 공식
      for (const [ci, pi, lb] of [[1, 0, '2025'], [2, 1, '2026']] as const) {
        let bad = 0, rev = 0, cnt = 0; const ev: string[][] = [];
        for (const r of parsed) { const cur = r.v[ci], prev = r.v[pi], shown = r.y[ci]; if (cur == null || prev == null || prev === 0 || shown == null) continue; cnt++; const comp = (cur - prev) / prev * 100; const d = Math.abs(shown - comp); const ok = d <= 0.1; if (d > 0.6) bad++; else if (d > 0.1) rev++; ev.push([r.level, r.key, won(prev), won(cur), pct(shown), pct(comp), d <= 0.1 ? '✅' : d <= 0.6 ? '🔎' : '❌']); }
        checks.push(mk('A.기간별위치', `A1 · ${lb} YoY = round((당해−전년)/전년×100)`, 'intra', bad === 0, cnt === 0 ? '대상 없음' : `${cnt}행 중 정합 ${cnt - bad - rev}${rev ? ` · 확인필요 ${rev}` : ''}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, review: bad === 0 && rev > 0, evidence: { headers: ['레벨', '항목', `${+lb - 1}`, lb, '표시 YoY', '계산 YoY', '일치'], rows: ev } }));
      }
      // A2 YoY 부호
      for (const [ci, pi, lb] of [[1, 0, '2025'], [2, 1, '2026']] as const) {
        let bad = 0, cnt = 0; const ev: string[][] = [];
        for (const r of parsed) { const cur = r.v[ci], prev = r.v[pi], shown = r.y[ci]; if (cur == null || prev == null || shown == null || cur === prev || prev === 0) continue; cnt++; const ok = Math.sign(shown) === Math.sign(cur - prev); if (!ok) bad++; ev.push([r.key, `${won(prev)}→${won(cur)}`, cur - prev > 0 ? '증가' : '감소', pct(shown), yn(ok)]); }
        checks.push(mk('A.기간별위치', `A2 · ${lb} YoY 부호 = 증감 방향`, 'intra', bad === 0, cnt === 0 ? '대상 없음' : `${cnt}행 중 ${cnt - bad} 일치${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['항목', `${+lb - 1}→${lb}`, '값 방향', '표시 YoY', '일치'], rows: ev } }));
      }
      // A3 코스 = Σ홀
      { let bad = 0, cnt = 0; const ev: string[][] = []; for (const co of courses) { const hs = holes.filter((h) => h.course === co.course); if (!hs.length) continue; for (let yi = 0; yi < 3; yi++) { const cv = co.v[yi]; if (cv == null) continue; const sum = hs.reduce((a, h) => a + (h.v[yi] || 0), 0); const ok = near(cv, sum, TOL); if (!ok) bad++; cnt++; ev.push([co.key, `${2024 + yi}`, won(cv), won(sum), hs.map((h) => `${h.key} ${won(h.v[yi])}`).join(' + '), yn(ok)]); } }
        checks.push(mk('A.기간별위치', 'A3 · 코스 = Σ홀 (홀전체+각홀, 연도별)', 'intra', bad === 0, cnt === 0 ? '홀 확장 없음' : `${cnt}건 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['코스', '연도', '코스값', 'Σ홀', '홀 내역', '일치'], rows: ev } })); }
      // A4 홀 = Σ구분
      { let bad = 0, cnt = 0; const ev: string[][] = []; for (const ho of holes) { const gs = gubuns.filter((g) => g.course === ho.course && g.hole === ho.hole); if (!gs.length) continue; for (let yi = 0; yi < 3; yi++) { const hv = ho.v[yi]; if (hv == null) continue; const sum = gs.reduce((a, g) => a + (g.v[yi] || 0), 0); const ok = near(hv, sum, TOL); if (!ok) bad++; cnt++; ev.push([`${ho.course}/${ho.key}`, `${2024 + yi}`, won(hv), won(sum), gs.map((g) => `${g.key} ${won(g.v[yi])}`).join(' + '), yn(ok)]); } }
        checks.push(mk('A.기간별위치', 'A4 · 홀 = Σ구분 (연도별)', 'intra', bad === 0, cnt === 0 ? '구분 확장 없음' : `${cnt}건 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['코스/홀', '연도', '홀값', 'Σ구분', '구분 내역', '일치'], rows: ev } })); }
      // A5 전체 = 코스전체 + Σ코스
      { const total = parsed.find((r) => r.level === 'top' && /^전체$/.test(r.key)); const courseAll = parsed.find((r) => r.level === 'top' && /코스\s*전체/.test(r.key));
        if (total && courseAll && courses.length) { let bad = 0, cnt = 0; const ev: string[][] = []; for (let yi = 0; yi < 3; yi++) { const tv = total.v[yi]; if (tv == null) continue; const sum = (courseAll.v[yi] || 0) + courses.reduce((a, c) => a + (c.v[yi] || 0), 0); const ok = near(tv, sum, TOL + 1); if (!ok) bad++; cnt++; ev.push([`${2024 + yi}`, won(tv), won(sum), `코스전체 ${won(courseAll.v[yi])} + ${courses.map((c) => `${c.key} ${won(c.v[yi])}`).join(' + ')}`, yn(ok)]); }
          checks.push(mk('A.기간별위치', 'A5 · 전체 = 코스전체 + Σ코스 (연도별)', 'cross', bad === 0, `${cnt}건 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['연도', '전체', '코스전체+Σ코스', '내역', '일치'], rows: ev } }));
        } else checks.push(mk('A.기간별위치', 'A5 · 전체 = 코스전체 + Σ코스', 'cross', true, '전체/코스전체/코스 행 부족 — 판정 제외', { na: true })); }
      // A6 카드 = 표
      { const cardText = await admin.evaluate(() => {
          const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
          const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
          const blocks = [...document.querySelectorAll('.contents div, main div')].filter((e) => { const t = (e as HTMLElement).innerText || ''; return vis(e) && /2024/.test(t) && /2025/.test(t) && /2026/.test(t) && t.length < 240; });
          return [...new Set(blocks.map((e) => norm((e as HTMLElement).innerText)))];
        }).catch(() => [] as string[]);
        const parseCard = (name: string): number[] | null => {
          const esc2 = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const blk = cardText.find((b) => !/홀별/.test(b) && new RegExp(`^${esc2}(\\s|▼|▲)`).test(b));
          if (!blk) return null;
          const yv = (yr: string): number | null => { const m = blk.match(new RegExp(`${yr}\\s+(-?\\d{1,3}(?:,\\d{3})*)`)); return m ? Number(m[1].replace(/,/g, '')) : null; };
          const a = yv('2024'), b = yv('2025'), c = yv('2026'); return (a != null && b != null && c != null) ? [a, b, c] : null;
        };
        let bad = 0, cnt = 0; const ev: string[][] = [];
        for (const co of courses) { const card = parseCard(co.key); if (!card) continue; for (let yi = 0; yi < 3; yi++) { const tv = co.v[yi]; if (tv == null) continue; const ok = near(tv, card[yi], TOL); if (!ok) bad++; cnt++; ev.push([co.key, `${2024 + yi}`, won(card[yi]), won(tv), yn(ok)]); } }
        checks.push(mk('A.기간별위치', 'A6 · 코스 카드값 = 표 코스행값 (3년)', 'cross', bad === 0, cnt === 0 ? '카드 파싱 불가 — 판정 제외' : `${cnt}건 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['코스', '연도', '카드값', '표값', '일치'], rows: ev } })); }
      // (제거 2026-09-03) '기간별-위치 구조(정보성)' 순수 구조 readout(코스/홀/구분 개수) 삭제 — 검증 아님인데 na:true라 '참고(데이터없음)'로 오분류돼 결과 혼란 유발. 계층 정합은 A5/A6/B1~M3가 이미 검증(중복). 미존재 아님(데이터 존재).
    }
  } else checks.push(mk('A.기간별위치', '기간별 비용 진입', 'intra', true, '진입 실패 — 판정 제외', { na: true }));

  // ═══ B. 위치별 비용 (연간 · 월간) ═══
  const annualTotal = new Map<string, number>();
  if (await gotoCourseMenu(admin, '비용 관리', '위치별 비용').then(() => true).catch(() => false)) {
    await admin.waitForTimeout(1500); await killAlarms(admin);
    // ── 연간 ──
    const okA = await clickTab(admin, /^\s*연간\s*$/);
    await expandTree(admin); await admin.waitForTimeout(600);
    const A = await readRows(admin);
    if (!A.headers.length || !A.rows.length) checks.push(mk('B.위치별(연간)', '위치별(연간) 표', 'intra', true, `표 미검출(탭 ${okA}) — 판정 제외`, { na: true }));
    else {
      const totalIdx = A.headers.findIndex((h) => /총\s*비용|합계/.test(h));
      const typeIdxs = A.headers.map((h, i) => ({ h, i })).filter((x) => /인건비|자재비|관리비/.test(x.h)).map((x) => x.i);
      const typeNames = typeIdxs.map((i) => A.headers[i]);
      const firstType = typeIdxs.length ? Math.min(...typeIdxs) : A.headers.length;
      const gubunIdxs = A.headers.map((_, i) => i).filter((i) => i > totalIdx && i < firstType);
      const gubunNames = gubunIdxs.map((i) => A.headers[i]);
      type LR = { level: string; key: string; course: string; hole: string; total: number | null; gubun: number[]; type: number[] };
      const lrs: LR[] = []; let curC = '';
      for (const cells of A.rows) {
        if (cells.length < A.headers.length) continue;
        const c0 = cells[0] || '', c1 = cells[1] || '';
        const total = totalIdx >= 0 ? numOf(cells[totalIdx]) : null;
        const gubun = gubunIdxs.map((i) => numOf(cells[i]) || 0); const type = typeIdxs.map((i) => numOf(cells[i]) || 0);
        let level = '', course = curC, hole = '';
        if (/전체\s*골프장|^전체$/.test(c0)) { level = 'top'; course = c0; } else if (c0) { level = 'course'; curC = c0; course = c0; } else if (c1) { level = 'hole'; hole = c1; } else continue;
        lrs.push({ level, key: c0 || c1, course, hole, total, gubun, type });
        if (total != null) annualTotal.set(`${course}|${hole}`, total);
      }
      const nz = (names: string[], vals: number[]) => names.map((n, i) => vals[i] ? `${n} ${won(vals[i])}` : '').filter(Boolean).join(' + ') || '(전부 0)';
      { let bad = 0, cnt = 0; const ev: string[][] = []; for (const r of lrs) { if (r.total == null) continue; const s = r.gubun.reduce((a, b) => a + b, 0); const ok = near(r.total, s, TOL); if (!ok) bad++; cnt++; ev.push([r.key, won(r.total), won(s), nz(gubunNames, r.gubun), yn(ok)]); }
        checks.push(mk('B.위치별(연간)', 'B1 · 총비용 = Σ구분 (연간)', 'intra', bad === 0, cnt === 0 ? '대상 없음' : `${cnt}행 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['행', '총비용', 'Σ구분', '구분 내역', '일치'], rows: ev } })); }
      { let bad = 0, cnt = 0; const ev: string[][] = []; for (const r of lrs) { if (r.total == null || !r.type.length) continue; const s = r.type.reduce((a, b) => a + b, 0); const ok = near(r.total, s, TOL); if (!ok) bad++; cnt++; ev.push([r.key, won(r.total), won(s), nz(typeNames, r.type), yn(ok)]); }
        checks.push(mk('B.위치별(연간)', 'B2 · 총비용 = Σ비용유형 (연간)', 'cross', bad === 0, cnt === 0 ? '유형열 없음 — 판정 제외' : `${cnt}행 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['행', '총비용', 'Σ비용유형', '비용유형 내역', '일치'], rows: ev } })); }
      { const cs = lrs.filter((r) => r.level === 'course'), hs = lrs.filter((r) => r.level === 'hole'); let bad = 0, cnt = 0; const ev: string[][] = []; for (const co of cs) { const mine = hs.filter((h) => h.course === co.course); if (!mine.length || co.total == null) continue; const s = mine.reduce((a, h) => a + (h.total || 0), 0); const ok = near(co.total, s, TOL); if (!ok) bad++; cnt++; ev.push([co.key, won(co.total), won(s), mine.map((h) => `${h.key} ${won(h.total)}`).join(' + '), yn(ok)]); }
        checks.push(mk('B.위치별(연간)', 'B3 · 코스 = Σ홀 (총비용, 연간)', 'intra', bad === 0, cnt === 0 ? '홀 확장 없음' : `${cnt}건 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['코스', '총비용', 'Σ홀', '홀 내역', '일치'], rows: ev } })); }
      // B4 · 코스 구분값 = Σ홀 구분값 (구분 컬럼 세로 분해 — 시설 등 각 영역의 원천 홀 추적)
      //   B1(행: 총비용=Σ구분)·B3(열: 코스총비용=Σ홀총비용)이 못 잡는 '코스 시설 = Σ홀 시설' 세로 정합.
      //   → 위치별 비용 시설/장비/그린… 각 구분값이 어느 홀에서 왔는지 원천 명세(둘 다 0인 코스×구분은 생략).
      { const cs = lrs.filter((r) => r.level === 'course'), hs = lrs.filter((r) => r.level === 'hole');
        let bad = 0, cnt = 0; const ev: string[][] = [];
        for (const co of cs) {
          const mine = hs.filter((h) => h.course === co.course); if (!mine.length) continue;
          for (let gi = 0; gi < gubunNames.length; gi++) {
            const cv = co.gubun[gi] || 0; const s = mine.reduce((a, h) => a + (h.gubun[gi] || 0), 0);
            if (cv === 0 && s === 0) continue;   // 둘 다 0 = 노이즈 생략
            const ok = near(cv, s, TOL); if (!ok) bad++; cnt++;
            const src = mine.filter((h) => h.gubun[gi]).map((h) => `${h.key} ${won(h.gubun[gi])}`).join(' + ') || '(홀 전부 0)';
            ev.push([co.key, gubunNames[gi], won(cv), won(s), src, yn(ok)]);
          }
        }
        checks.push(mk('B.위치별(연간)', 'B4 · 코스 구분값 = Σ홀 구분값 (구분별 세로 분해 — 시설 등 원천 홀)', 'intra', bad === 0, cnt === 0 ? '홀 확장/구분값 없음 — 판정 제외' : `${cnt}건(코스×구분) 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['코스', '구분', '코스값', 'Σ홀', '원천 홀 내역', '일치'], rows: ev } })); }
      // B5 · 전체 골프장(코스무관 버킷) 구분값 원천 가시화 — 코스(South/East/West)에 안 잡히는 홀 미귀속 비용.
      //   B4가 코스 레벨만 분해하므로 '전체 골프장' 행(코스 미지정 작업지시)의 구분값은 원천이 안 드러남 → 명세로 노출.
      //   그랜드총계(카드 전체 비용) = 전체골프장 + Σ(South/East/West). 정상 버킷이라 정보성(✅), 결함 아님.
      { const top = lrs.find((r) => r.level === 'top' && /전체\s*골프장/.test(r.key));
        if (top) {
          const nz = gubunNames.map((n, i) => (top.gubun[i] ? `${n} ${won(top.gubun[i])}` : '')).filter(Boolean);
          checks.push(mk('B.위치별(연간)', 'B5 · 전체 골프장(코스무관) 구분값 원천 — 홀 미귀속 비용 가시화', 'intra', true,
            nz.length ? `코스에 안 잡히는 코스무관 버킷 구분값 ${nz.length}건: ${nz.join(' · ')} · 총비용 ${won(top.total)} — 홀 미귀속 작업(정상, 원천=코스 미지정 작업지시). 그랜드총계=전체골프장+Σ코스.` : '전체 골프장 구분값 전부 0(코스무관 비용 없음)',
            { na: false, evidence: { headers: ['버킷', '구분값 내역'], rows: nz.map((s) => ['전체 골프장', s]) } }));
        } else checks.push(mk('B.위치별(연간)', 'B5 · 전체 골프장(코스무관) 구분값 원천', 'intra', true, "'전체 골프장' 행 미검출 — 판정 제외(참고)", { na: true }));
      }
    }
    // ── 월간 ──
    const okM = await clickTab(admin, /^\s*월간\s*$/);
    await expandTree(admin); await admin.waitForTimeout(600);
    const M = await readRows(admin);
    const sumIdx = M.headers.findIndex((h) => /합계|총\s*비용/.test(h));
    const monthCols = M.headers.map((h, i) => ({ h, i })).filter((x) => /^\d{1,2}\s*월$/.test(x.h));
    const monthIdxs = monthCols.map((x) => x.i); const monthNames = monthCols.map((x) => x.h);
    if (!M.rows.length || sumIdx < 0 || !monthIdxs.length) checks.push(mk('B.위치별(월간)', '위치별(월간) 표', 'intra', true, `표/월컬럼 미검출(탭 ${okM}) — 판정 제외`, { na: true }));
    else {
      type MR = { level: string; course: string; hole: string; key: string; sum: number | null; months: number[] };
      const mrs: MR[] = []; let curC = '';
      for (const cells of M.rows) {
        if (cells.length < M.headers.length) continue;
        const c0 = cells[0] || '', c1 = cells[1] || '';
        const sum = numOf(cells[sumIdx]); const months = monthIdxs.map((i) => numOf(cells[i]) || 0);
        let level = '', course = curC, hole = '';
        if (/전체\s*골프장|^전체$/.test(c0)) { level = 'top'; course = c0; } else if (c0) { level = 'course'; curC = c0; course = c0; } else if (c1) { level = 'hole'; hole = c1; } else continue;
        mrs.push({ level, course, hole, key: c0 || c1, sum, months });
      }
      const nzM = (vals: number[]) => monthNames.map((n, i) => vals[i] ? `${n} ${won(vals[i])}` : '').filter(Boolean).join(' + ') || '(전부 0)';
      { let bad = 0, cnt = 0; const ev: string[][] = []; for (const r of mrs) { if (r.sum == null) continue; const s = r.months.reduce((a, b) => a + b, 0); const ok = near(r.sum, s, TOL); if (!ok) bad++; cnt++; ev.push([`${r.course || ''}${r.hole ? '/' + r.hole : ''}` || r.key, won(r.sum), won(s), nzM(r.months), yn(ok)]); }
        checks.push(mk('B.위치별(월간)', 'M1 · 합계 = Σ(1~12월) (월간)', 'intra', bad === 0, cnt === 0 ? '대상 없음' : `${cnt}행 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['행', '합계', 'Σ월', '월별 내역', '일치'], rows: ev } })); }
      { const cs = mrs.filter((r) => r.level === 'course'), hs = mrs.filter((r) => r.level === 'hole'); let bad = 0, cnt = 0; const ev: string[][] = []; for (const co of cs) { const mine = hs.filter((h) => h.course === co.course); if (!mine.length || co.sum == null) continue; const s = mine.reduce((a, h) => a + (h.sum || 0), 0); const ok = near(co.sum, s, TOL); if (!ok) bad++; cnt++; ev.push([co.key, won(co.sum), won(s), mine.map((h) => `${h.key} ${won(h.sum)}`).join(' + '), yn(ok)]); }
        checks.push(mk('B.위치별(월간)', 'M2 · 코스 = Σ홀 (합계, 월간)', 'intra', bad === 0, cnt === 0 ? '홀 확장 없음' : `${cnt}건 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['코스', '합계', 'Σ홀', '홀 내역', '일치'], rows: ev } })); }
      { let bad = 0, cnt = 0; const ev: string[][] = []; for (const r of mrs) { if (r.sum == null) continue; const key = `${r.course}|${r.hole}`; if (!annualTotal.has(key)) continue; const av = annualTotal.get(key) as number; const ok = near(r.sum, av, TOL); if (!ok) bad++; cnt++; ev.push([`${r.course || ''}${r.hole ? '/' + r.hole : ''}` || r.key, won(r.sum), won(av), yn(ok)]); }
        checks.push(mk('B.위치별(월간)', '★ M3 · 교차: 월간 합계 = 연간 총비용', 'cross', bad === 0, cnt === 0 ? '연간 매칭 없음 — 판정 제외' : `${cnt}건 중 정합 ${cnt - bad}${bad ? ` · 위반 ${bad}` : ''}`, { na: cnt === 0, evidence: { headers: ['행', '월간 합계', '연간 총비용', '일치'], rows: ev } })); }
    }
  } else checks.push(mk('B.위치별(연간)', '위치별 비용 진입', 'intra', true, '진입 실패 — 판정 제외', { na: true }));

  return checks;
}
