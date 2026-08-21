import { test, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openCourseAdmin, killAlarms } from '../lib/course/courseHelpers';
import { grab, gridOf, grabPaged, Grab } from '../lib/course/budgetCapture';
import { num } from '../lib/course/domain/budgetCost';
import { Atom, reconcileIndependent, sanityBatch, findCol, atomsFromGrid } from '../lib/course/domain/budgetReconcile';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  P1 — 예산·비용 교차 맹점 보완: 독립 재집계(Tier A) + 이상치·정상성(Tier E) 검증(비파괴).
//  실행: npm run course:auth 후 npm run course:reconcile
//  배경: 교차(③)는 표시 집계끼리 비교 → 모든 화면이 같은 오값이면 통과(맹점).
//    Tier A: 원자 원천(수량×단가 또는 행별 금액)에서 총액을 **독립 재구성** → 비용집계 표시 총액과 대조
//            → 집계·롤업·매핑 오류를 포착(같은 오값 통과 방지).
//    Tier E: 원천 단가/임률/시간당비용의 정상성(음수·0·자릿수·범위) — 명백한 입력 오류 저비용 포착.
//  ⚠ 원자 컬럼(출고량·운용시간·행별 금액)은 화면별로 상이 → 적응형(정규식 탐지). 첫 런은 구조를
//     analysis/_source_atoms.json 으로 덤프(프로브 겸용). 컬럼 미발견 시 정직 SKIP(판정 제외).
//  ⚠ 한계: 원자 입력값 자체 오류는 재집계도 같은 입력을 쓰므로 못 잡음(Tier C=외부 대장 대조 몫).
// ──────────────────────────────────────────────────────────────

const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();
// 관리비유형 라벨 → 비용집계 표시 총액 매칭.
const MGMT = ['고정직 인건비', '임시직 인건비', '코스 자재비', '장비 관리비', '기타 관리비'];

// 비용 집계 grid에서 관리비유형별 표시 총액 추출(행에 유형 라벨 포함 → 그 행 최대 숫자=총액 추정).
function aggTotals(g: Grab | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!g) return out;
  for (const T of g.tables) {
    const { grid } = gridOf(T);
    for (const r of grid) {
      const rowTxt = norm(r.join(' '));
      for (const m of MGMT) {
        if (out[m] != null) continue;
        if (rowTxt.includes(norm(m))) {
          const nums = r.map((c) => num(c)).filter((v): v is number => v != null);
          if (nums.length) out[m] = Math.max(...nums);   // 총액 추정(행 내 최대) — 프로브로 검증
        }
      }
    }
  }
  return out;
}

// 화면 grid의 헤더 + 샘플행 덤프(프로브).
function dumpScreen(tag: string, g: Grab | null): unknown {
  if (!g) return { tag, loaded: false };
  return { tag, loaded: true, cards: g.cards.slice(0, 8), tables: g.tables.map((T) => ({ heads: T.heads, sample: gridOf(T).grid.slice(0, 4) })) };
}

test('P1 독립 재집계(A) + 이상치(E) — 예산·비용 교차 맹점 보완(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const P = '비용 관리 > 비용 집계';
  const ref = (n: string) => `코스관리_독립재집계_${n}`;
  const probe: Record<string, unknown> = {};
  const rec = (c: { name: string; ok: boolean; na?: boolean; detail: string }, tcId: string) => {
    const cm: CheckMeta = { path: `${P} > ${c.name}`, tcRef: ref(c.name.slice(0, 20)), tcId, desc: c.name, failMsg: c.detail.slice(0, 80) };
    if (c.na) skip(cm, c.detail); else record(cm, c.ok ? 'PASS' : 'FAIL', c.ok ? { actual: c.detail } : { error: c.detail });
  };

  // ── 표시 집계(비용 집계 관리비유형 총액) ──
  const aggG = await grabPaged(admin, '비용 관리', '비용 집계');
  probe['비용집계'] = dumpScreen('비용집계', aggG);
  const agg = aggTotals(aggG);
  const 자재비 = agg['코스 자재비'] ?? null;
  const 장비비 = agg['장비 관리비'] ?? null;

  // ── 원자 원천 수집 ──
  const matG = await grabPaged(admin, '자재 관리', '자재 수불(품목별)');
  probe['자재수불'] = dumpScreen('자재수불', matG);
  const eqG = await grabPaged(admin, '장비 관리', '장비 총괄');
  probe['장비총괄'] = dumpScreen('장비총괄', eqG);
  const matSumG = await grabPaged(admin, '자재 관리', '자재 총괄');
  probe['자재총괄'] = dumpScreen('자재총괄', matSumG);
  const hrG = await grabPaged(admin, '인력 관리', '인력 관리');
  probe['인력관리'] = dumpScreen('인력관리', hrG);

  try { fs.mkdirSync(path.join(process.cwd(), 'analysis'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), 'analysis', '_source_atoms.json'), JSON.stringify({ agg, probe }, null, 1).slice(0, 3_000_000)); } catch { /* */ }
  console.log(`\n[reconcile] 표시 집계 ${JSON.stringify(agg)} → analysis/_source_atoms.json (구조 덤프)`);

  // ── Tier A: 자재비 독립 재집계 ──
  //   원자 후보: 행별 '출고금액'(직접 합) 우선, 없으면 '출고량 × 단위당원가'.
  {
    const T = matG?.tables[0]; const { grid } = gridOf(T); const heads = T?.heads || [];
    const amtCol = findCol(heads, /출고금액|출고액|금액/);
    const qtyCol = findCol(heads, /출고량|출고수량|사용량/);
    const unitCol = findCol(heads, /단위당원가|단가|단위원가/);
    const nameCol = findCol(heads, /자재명|품목|품명/);
    let atoms: Atom[] = [];
    if (amtCol >= 0) atoms = grid.map((r) => ({ label: nameCol >= 0 ? r[nameCol] || '' : '', qty: 1, unit: num(r[amtCol]) ?? 0 })).filter((a) => a.unit !== 0);
    else atoms = atomsFromGrid(grid, nameCol, qtyCol, unitCol);
    rec(reconcileIndependent('코스 자재비 독립 재집계(A) = Σ원자 vs 비용집계 표시', atoms, 자재비), 'RECON-A-MAT');
  }

  // ── Tier A: 장비 관리비 독립 재집계 ──
  {
    const T = eqG?.tables[0]; const { grid } = gridOf(T); const heads = T?.heads || [];
    const amtCol = findCol(heads, /관리비|유지비|발생비용|비용/);
    const qtyCol = findCol(heads, /운용시간|가동시간|사용시간/);
    const unitCol = findCol(heads, /시간당비용|시간당|단가/);
    const nameCol = findCol(heads, /장비명|장비|자산명/);
    let atoms: Atom[] = [];
    if (amtCol >= 0) atoms = grid.map((r) => ({ label: nameCol >= 0 ? r[nameCol] || '' : '', qty: 1, unit: num(r[amtCol]) ?? 0 })).filter((a) => a.unit !== 0);
    else atoms = atomsFromGrid(grid, nameCol, qtyCol, unitCol);
    rec(reconcileIndependent('장비 관리비 독립 재집계(A) = Σ원자 vs 비용집계 표시', atoms, 장비비), 'RECON-A-EQ');
  }

  // ── Tier E: 원천 단가/임률/시간당비용 정상성 ──
  {
    // 자재 단위당원가
    const T = matSumG?.tables[0]; const { grid } = gridOf(T); const heads = T?.heads || [];
    const ui = findCol(heads, /단위당원가|단가/), ni = findCol(heads, /자재명|품목|품명/);
    const vals = ui >= 0 ? grid.map((r) => ({ label: ni >= 0 ? r[ni] || '' : '', v: num(r[ui]) })) : [];
    rec(sanityBatch('자재 단위당원가 정상성(E) — 음수·0·자릿수', vals, { min: 1, max: 100_000_000 }), 'RECON-E-MAT');
  }
  {
    // 장비 시간당비용
    const T = eqG?.tables[0]; const { grid } = gridOf(T); const heads = T?.heads || [];
    const hi = findCol(heads, /시간당비용|시간당/), ni = findCol(heads, /장비명|장비/);
    const vals = hi >= 0 ? grid.map((r) => ({ label: ni >= 0 ? r[ni] || '' : '', v: num(r[hi]) })) : [];
    rec(sanityBatch('장비 시간당비용 정상성(E)', vals, { min: 1, max: 10_000_000 }), 'RECON-E-EQ');
  }
  {
    // 인력 시간당 임률(있으면)
    const T = hrG?.tables[0]; const { grid } = gridOf(T); const heads = T?.heads || [];
    const ri = findCol(heads, /임률|시급|시간당/), ni = findCol(heads, /이름|성명|인력/);
    const vals = ri >= 0 ? grid.map((r) => ({ label: ni >= 0 ? r[ni] || '' : '', v: num(r[ri]) })) : [];
    rec(sanityBatch('인력 시간당 임률 정상성(E)', vals, { min: 1, max: 10_000_000 }), 'RECON-E-HR');
  }

  await killAlarms(admin);
  await writeReport('코스관리_예산비용_독립재집계');
});
