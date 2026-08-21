import { test, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { openCourseAdmin, killAlarms } from '../lib/course/courseHelpers';
import { grab, gridOf, grabPaged, Grab } from '../lib/course/budgetCapture';
import { num } from '../lib/course/domain/budgetCost';
import { Atom, reconcileIndependent, sanityBatch, findCol } from '../lib/course/domain/budgetReconcile';
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

// 비용 집계 grid에서 관리비유형/합계 표시 총액 추출.
//   ⚠ 실측(프로브): 관리비유형은 '컬럼'(항목·합계·고정직 인건비·…·기타 관리비), 행은 발생원(작업지시 비용 합계 등).
//   → 유형별 총액 = 해당 컬럼의 본문 행 합. '합계' 컬럼 = 총계.
function aggTotals(g: Grab | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!g) return out;
  for (const T of g.tables) {
    const { grid } = gridOf(T); const heads = T.heads || [];
    const colFor = (label: RegExp) => heads.findIndex((h) => label.test(norm(h)));
    const sumCol = (ci: number) => ci < 0 ? null : grid.reduce((a, r) => { const v = num(r[ci]); return v == null ? a : a + v; }, 0);
    const map: [string, RegExp][] = [['합계', /^합계$|^총계$|^전체$/], ['고정직 인건비', /고정직인건비/], ['임시직 인건비', /임시직인건비/], ['코스 자재비', /코스자재비|자재비/], ['장비 관리비', /장비관리비/], ['기타 관리비', /기타관리비/]];
    for (const [k, re] of map) { if (out[k] != null) continue; const ci = colFor(re); const s = sumCol(ci); if (s != null) out[k] = s; }
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

  // ── 표시 집계(비용 집계) ──
  const aggG = await grabPaged(admin, '비용 관리', '비용 집계');
  probe['비용집계'] = dumpScreen('비용집계', aggG);
  const agg = aggTotals(aggG);
  const 총계 = agg['합계'] ?? null;

  // ── 원자 원천: 작업별 비용(작업지시별 발생 비용 = 비용집계의 실제 원천) ──
  //   ⚠ 실측: 비용집계 관리비유형은 작업지시(work order)에서 파생 → 마스터(자재수불/장비운용) 단순합 아님.
  //     독립 재집계의 참 원자 = 작업별 비용(작업지시 단위 비용). Σ(작업별 비용) = 비용집계 총계 여야 함.
  const taskG = await grabPaged(admin, '비용 관리', '작업별 비용', 25, true);   // oneYear: 기본 3개월→빈값 방지
  probe['작업별비용'] = dumpScreen('작업별비용', taskG);
  // 참고 마스터(단가·정상성용 + 향후 유형별 재집계 설계 근거) 덤프.
  const eqG = await grabPaged(admin, '장비 관리', '장비 총괄');
  probe['장비총괄'] = dumpScreen('장비총괄', eqG);
  const matSumG = await grabPaged(admin, '자재 관리', '자재 총괄');
  probe['자재총괄'] = dumpScreen('자재총괄', matSumG);
  const hrG = await grabPaged(admin, '인력 관리', '인력 관리');
  probe['인력관리'] = dumpScreen('인력관리', hrG);

  try { fs.mkdirSync(path.join(process.cwd(), 'analysis'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), 'analysis', '_source_atoms.json'), JSON.stringify({ agg, probe }, null, 1).slice(0, 3_000_000)); } catch { /* */ }
  console.log(`\n[reconcile] 표시 집계 ${JSON.stringify(agg)} → analysis/_source_atoms.json (구조 덤프)`);

  // ── Tier A: 작업별 비용(작업지시 원자) → 총계·유형별 독립 재집계 = 비용집계 대조 ──
  //   작업별 비용 = 작업지시 단위 원자 비용(총 비용 + 유형별 컬럼) → 원자에서 다시 쌓아 비용집계와 대조.
  //   ⚠ 스코프: 작업별=날짜필터(1년) / 비용집계=시작연도 → 크로스이어 경계 항목 차이 가능(불일치 시 상세에 명시).
  {
    const T = taskG?.tables[0]; const { grid } = gridOf(T); const heads = T?.heads || [];
    // 빈 화면("비용 발생 내역이 없습니다") 필터
    const rows = grid.filter((r) => !r.some((c) => /비용 발생 내역이 없습니다/.test(c)));
    const nameCol = findCol(heads, /작업명|작업번호/);
    const colOf = (re: RegExp) => heads.findIndex((h) => re.test(norm(h)));
    // 총계 = Σ(작업별 총 비용)
    const totalCol = colOf(/^총비용$|^총액$|^합계$/);
    const totalAtoms: Atom[] = totalCol >= 0 ? rows.map((r) => ({ label: nameCol >= 0 ? r[nameCol] || '' : '', qty: 1, unit: num(r[totalCol]) ?? 0 })).filter((a) => a.unit !== 0) : [];
    rec(reconcileIndependent('비용집계 총계 = Σ(작업별 총 비용)  [독립 재집계 A·스코프주의]', totalAtoms, 총계), 'RECON-A-TASK-TOT');
    // 유형별 = Σ(작업별 유형 컬럼) vs 비용집계 유형
    const types: [string, RegExp][] = [['코스 자재비', /코스자재비|자재비/], ['장비 관리비', /장비관리비/], ['고정직 인건비', /고정직인건비/], ['임시직 인건비', /임시직인건비/], ['기타 관리비', /기타관리비/]];
    for (const [label, re] of types) {
      const ci = colOf(re); const disp = agg[label] ?? null;
      const atoms: Atom[] = (ci >= 0 && rows.length) ? rows.map((r) => ({ label: nameCol >= 0 ? r[nameCol] || '' : '', qty: 1, unit: num(r[ci]) ?? 0 })).filter((a) => a.unit !== 0) : [];
      // s를 직접 쓰기보다 reconcileIndependent로 원자합=표시 대조(원자 없으면 na)
      rec(reconcileIndependent(`${label} = Σ(작업별 ${label} 컬럼)  [유형별 독립 재집계 A]`, atoms, disp), `RECON-A-${label.replace(/[^가-힣]/g, '').slice(0, 4)}`);
    }
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
    const hi = findCol(heads, /시간당비용|시간당/), ni = findCol(heads, /장비명/);
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
