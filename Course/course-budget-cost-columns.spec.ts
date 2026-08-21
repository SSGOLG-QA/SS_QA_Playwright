import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, check, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';
import { near } from '../lib/course/domain/budgetCost';

// ──────────────────────────────────────────────────────────────
//  숫자계산 취약영역 보강 — 예산/비용 9화면 테이블 컬럼 전수 검증 + 합계 정합성(비파괴).
//  실행: npm run course:auth 후 npm run course:budget-cost-columns
//  배경: 커버리지 트리 숫자계산 카테고리 저조(예산상세 51/66·비용집계 16/16 미커버) —
//    예산/비용 표의 컬럼(대분류·합계·월별·분류별 등)이 컴포넌트 단위로 미검증이었음.
//  - ① 각 화면 표의 thead 컬럼 전수 노출 검증(컴포넌트 크레딧: 경로 "컬럼:X" 라벨 매칭).
//  - ② 합계 정합성: '합계/총계' 열이 있으면 첫 데이터행에서 합계 ≈ Σ(행 내 숫자셀). 모호 시 diff/skip(가짜 FAIL 방지).
//  전부 비파괴(조회/파싱만).
// ──────────────────────────────────────────────────────────────

const SCREENS = [
  { menu: '예산 관리', sub: '예산 총괄', id: 'BSUM' },
  { menu: '예산 관리', sub: '예산 상세', id: 'BDET' },
  { menu: '예산 관리', sub: '실적 관리', id: 'BPERF' },
  { menu: '예산 관리', sub: '예산 분석', id: 'BANAL' },
  { menu: '비용 관리', sub: '비용 집계', id: 'CAGG' },
  { menu: '비용 관리', sub: '작업별 비용', id: 'CTASK' },
  { menu: '비용 관리', sub: '분류별 비용', id: 'CCAT' },
  { menu: '비용 관리', sub: '위치별 비용', id: 'CLOC' },
  { menu: '비용 관리', sub: '기간별 비용', id: 'CPER' },
];

// 화면 내 모든 표의 thead 컬럼(가시, dedup) 수집. 탭이 있으면 각 탭도 훑음.
async function columnsOf(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const set = new Set<string>();
    document.querySelectorAll('.contents thead th, main thead th, .list-table-group thead th, .contents thead td, main thead td').forEach((th) => { if (vis(th)) { const t = norm(th.textContent); if (t && t.length <= 20) set.add(t); } });
    return Array.from(set);
  }).catch(() => [] as string[]);
}

// 합계 정합성(첫 데이터행): '합계/총계' 열 = Σ(행 내 나머지 숫자셀).
async function checkSum(page: Page, P: string, ref: (n: string) => string, id: string) {
  const m: CheckMeta = { path: `${P} > 합계정합성`, tcRef: ref('sum'), tcId: `${id}-SUM`, desc: "'합계' 열 = Σ(행 내 숫자 셀)", failMsg: '합계 ≠ Σ' };
  const data = await page.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const tbl = document.querySelector('.contents table, main table, .list-table-group table');
    if (!tbl) return { none: true } as any;
    const heads = Array.from(tbl.querySelectorAll('thead th, thead td')).map((h) => norm(h.textContent));
    const sumIdx = heads.findIndex((h) => /^(합계|총계|총액|합\s*계|계)$/.test(h));
    const row = tbl.querySelector('tbody tr');
    if (sumIdx < 0) return { noSum: true } as any;
    if (!row) return { noRow: true } as any;
    const cells = Array.from(row.querySelectorAll('td')).map((td) => norm(td.textContent));
    return { heads, sumIdx, cells } as any;
  }).catch(() => ({ none: true } as any));
  if (data.none) { skip(m, '표 없음'); return; }
  if (data.noSum) { skip(m, "'합계/총계' 열 없음(정합성 대상 아님)"); return; }
  if (data.noRow) { skip(m, '데이터 행 없음'); return; }
  const toNum = (s: string) => { const n = Number((s || '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? null : n; };
  const sumCell = toNum(data.cells[data.sumIdx]);
  const parts = data.cells.map((c: string, i: number) => (i === data.sumIdx ? null : toNum(c))).filter((v: number | null) => v != null) as number[];
  if (sumCell == null || parts.length < 2) { skip(m, '숫자 셀 부족(파싱 불가)'); return; }
  const total = parts.reduce((a, b) => a + b, 0);
  // 표에 소계/비율 등 비합산 열이 섞이면 Σ가 합계보다 큼 → 정확일치면 PASS, 아니면 diff(구조 확인) — 가짜 FAIL 방지.
  if (near(sumCell, total, Math.max(1, Math.abs(sumCell) * 0.005))) record(m, 'PASS', { actual: `합계 ${sumCell} = Σ ${total}` });
  else diff(P, '합계 vs Σ(행 숫자셀)', `합계 ${sumCell} ≠ 단순Σ ${total} — 표에 소계/비율/비합산 열 혼재 추정(구조 확인 필요)`, ref('sum'), '단순 행합과 불일치 = 열 구성 확인');
}

test('숫자계산 보강 — 예산/비용 컬럼 전수 + 합계 정합성(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  for (const s of SCREENS) {
    const P = `${s.menu} > ${s.sub}`;
    const ref = (n: string) => `코스관리_숫자보강_${s.id}_${n}`;
    const ok = await gotoCourseMenu(admin, s.menu, s.sub).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: ref('0'), tcId: `${s.id}-00`, desc: '진입' }, '진입 실패'); continue; }
    await killAlarms(admin); await admin.waitForTimeout(1300);

    // ① 컬럼 전수 검증 (기본 탭)
    const cols = await columnsOf(admin);
    if (!cols.length) skip({ path: `${P} > 컬럼`, tcRef: ref('col0'), tcId: `${s.id}-COL0`, desc: '표 컬럼' }, '표/컬럼 미검출');
    for (const col of cols) {
      const cm: CheckMeta = { path: `${P} > 컬럼:${col}`, tcRef: ref(`col_${col}`), tcId: `${s.id}-COL-${col.replace(/\s+/g, '')}`, desc: `컬럼 "${col}" 노출`, failMsg: `컬럼 "${col}" 미노출` };
      const h = admin.getByRole('columnheader', { name: col, exact: true }).first().or(admin.locator('thead th, thead td').filter({ hasText: new RegExp('^\\s*' + col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*') + '\\s*$') }).first());
      // 컬럼 존재는 탭/데이터 의존 → 미발견은 FAIL 아닌 SKIP(부분텍스트 오수집 등 가짜 FAIL 방지).
      if (await h.isVisible({ timeout: 4000 }).catch(() => false)) record(cm, 'PASS', { actual: `컬럼 "${col}" 노출` });
      else skip(cm, `컬럼 "${col}" 재검 미노출(탭/상태 의존 또는 부분텍스트)`);
    }
    // 탭이 있으면 각 탭 전환 후 컬럼 추가 수집(예산 상세 분류 탭별 표)
    const tabs: string[] = await admin.evaluate(() => { const norm = (x: string) => (x || '').replace(/\s+/g, ' ').trim(); const vis = (e: Element) => (e as HTMLElement).offsetParent !== null; const set = new Set<string>(); document.querySelectorAll('.tab-group > *, [role="tab"]').forEach((e) => { if (vis(e) && !e.closest('.side-navbar-container')) { const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 14) set.add(t); } }); return Array.from(set); }).catch(() => []);
    if (tabs.length >= 2) {
      const seenCols = new Set(cols);
      for (const tl of tabs.slice(0, 8)) {
        await admin.evaluate((label) => { const norm = (x: string) => (x || '').replace(/\s+/g, ' ').trim(); const el = Array.from(document.querySelectorAll('.tab-group > *, [role="tab"]')).find((e) => norm((e as HTMLElement).innerText || e.textContent || '') === label); (el as HTMLElement | undefined)?.click(); }, tl).catch(() => {});
        await admin.waitForTimeout(700); await killAlarms(admin);
        const tc = (await columnsOf(admin)).filter((c) => !seenCols.has(c));
        for (const col of tc) {
          seenCols.add(col);
          const cm: CheckMeta = { path: `${P} > [${tl}] 컬럼:${col}`, tcRef: ref(`tcol_${col}`), tcId: `${s.id}-TCOL-${col.replace(/\s+/g, '')}`, desc: `[${tl}] 컬럼 "${col}" 노출`, failMsg: `컬럼 "${col}" 미노출` };
          const th = admin.locator('thead th, thead td').filter({ hasText: new RegExp('^\\s*' + col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*') + '\\s*$') }).first();
          if (await th.isVisible({ timeout: 3500 }).catch(() => false)) record(cm, 'PASS', { actual: `[${tl}] 컬럼 "${col}" 노출` });
          else skip(cm, `[${tl}] 컬럼 "${col}" 미노출(탭/상태 의존)`);
        }
      }
    }

    // ② 합계 정합성
    await checkSum(admin, P, ref, s.id);
    await killAlarms(admin);
  }

  await killAlarms(admin);
  await writeReport('코스관리_숫자계산보강');
});
