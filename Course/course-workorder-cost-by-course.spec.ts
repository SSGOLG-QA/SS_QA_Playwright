import { test, Page, Locator } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { VueSelect } from '../lib/course/widgets';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  작업 지시(/task/orders) 완료확정 내역 → 코스별 비용 분석(비파괴, 조회만).
//   상태=완료확정 + 코스 필터 순회(East/South/West…) → 작업당 비용 합산 → 코스별 비용 리포트(표+막대그래프).
//   실행: npm run course:auth 후
//     npx playwright test --config=Course/playwright.config.ts --project=course Course/course-workorder-cost-by-course.spec.ts --no-deps
//  산출: reports/course-workorder-cost-by-course.html
// ──────────────────────────────────────────────────────────────

const OUT_HTML = 'reports/course-workorder-cost-by-course.html';
const mainScope = (p: Page) => p.locator('.contents, main').first();
const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null) => n == null ? '-' : Math.round(n).toLocaleString('en-US');
const parseCost = (t: string): number | null => { const c = (t || '').replace(/[^\d.\-]/g, ''); if (!c || c === '-') return null; const v = parseFloat(c); return isNaN(v) ? null : v; };

interface WO { no: string; name: string; c1: string; c2: string; cost: number | null; }

// 작업 지시 리스트 테이블 행 읽기(작업번호/작업명/1분류/2분류/비용). 스크롤로 전 행 로드 + 작업번호 dedupe.
async function readRows(admin: Page): Promise<WO[]> {
  const table = mainScope(admin).locator('table').filter({ has: admin.getByRole('columnheader', { name: /작업번호/ }) }).first()
    .or(mainScope(admin).locator('table').filter({ hasText: /작업번호/ }).first());
  const map = new Map<string, WO>();
  for (let scroll = 0; scroll < 12; scroll++) {
    const rows = await table.locator('tbody tr').all().catch(() => []);
    for (const r of rows) {
      const tds = await r.locator('td').allInnerTexts().catch(() => []);
      if (tds.length < 5) continue;
      const no = (tds[0] || '').trim();
      if (!/^W-?\d+/i.test(no)) continue;
      map.set(no, { no, name: (tds[1] || '').trim(), c1: (tds[2] || '').trim(), c2: (tds[3] || '').trim(), cost: parseCost(tds[4]) });
    }
    // 스크롤로 추가 로드 시도(가상/무한 스크롤 대비)
    const before = map.size;
    await table.locator('tbody tr').last().scrollIntoViewIfNeeded().catch(() => {});
    await admin.waitForTimeout(500);
    const after = await table.locator('tbody tr').count().catch(() => 0);
    if (after <= before && scroll > 0) break;
  }
  return [...map.values()];
}

// 옵션에 optionRe 를 가진 vue-select 를 찾아 valueRe 선택. 반환: 선택 성공/옵션목록.
async function selectVsByOption(admin: Page, scope: Locator, optionRe: RegExp, valueRe: RegExp): Promise<{ ok: boolean; opts: string[] }> {
  const vss = scope.locator('.v-select');
  const n = await vss.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const vs = new VueSelect(vss.nth(i));
    await vs.open();
    const opts = await vs.optionTexts();
    await admin.keyboard.press('Escape').catch(() => {});
    if (opts.some((o) => optionRe.test(o))) {
      const ok = await vs.select(valueRe).catch(() => false);
      await admin.waitForTimeout(300);
      return { ok, opts };
    }
  }
  return { ok: false, opts: [] };
}

// 옵션에 optionRe 를 가진 vue-select 의 인덱스 탐색(값 선택 후 placeholder 사라져도 불변).
async function findVsIdx(admin: Page, scope: Locator, optionRe: RegExp): Promise<number> {
  const vss = scope.locator('.v-select');
  const n = await vss.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const vs = new VueSelect(vss.nth(i));
    await vs.open();
    const opts = await vs.optionTexts();
    await admin.keyboard.press('Escape').catch(() => {});
    if (opts.some((o) => optionRe.test(o))) return i;
  }
  return -1;
}

async function applyFilters(admin: Page) {
  const apply = mainScope(admin).getByRole('button', { name: /^\s*적용\s*$/ }).first();
  if (await apply.isVisible({ timeout: 1000 }).catch(() => false)) { await apply.click().catch(() => {}); await admin.waitForTimeout(1200); await killAlarms(admin); }
}

test('작업 지시 완료확정 → 코스별 비용 분석', async ({ page, context }) => {
  test.setTimeout(600_000);
  const admin = await openCourseAdmin(page, context);
  const ok = await gotoCourseMenu(admin, '작업 관리', '작업 지시');
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!ok) throw new Error('작업 지시 진입 실패 — 세션 확인');

  // 기간 1년
  await mainScope(admin).getByRole('button', { name: /^\s*1년\s*$/ }).first().click().catch(() => {});
  await admin.waitForTimeout(1000); await killAlarms(admin);

  // 상태 = 완료 확정
  const statusSel = await selectVsByOption(admin, mainScope(admin), /완료\s*확정/, /완료\s*확정/);
  console.log('[wo] 상태 완료확정 선택:', statusSel.ok, '| 상태옵션:', JSON.stringify(statusSel.opts));
  await applyFilters(admin);
  await admin.waitForTimeout(800);

  // 코스 vue-select 인덱스 확정(East/South/West 옵션 보유) → 값 선택 후에도 nth 불변으로 재사용.
  const courseIdx = await findVsIdx(admin, mainScope(admin), /^\s*(East|South|West)\s*$/);
  const cvs = () => new VueSelect(mainScope(admin).locator('.v-select').nth(courseIdx));
  console.log('[wo] 코스 vue-select idx:', courseIdx);
  // 코스 옵션 열거
  await cvs().open();
  const courseOpts = (await cvs().optionTexts()).filter((o) => o && !/^전체$|코스\s*전체/.test(o));
  await admin.keyboard.press('Escape').catch(() => {});
  console.log('[wo] 코스 옵션:', JSON.stringify(courseOpts));

  // 전체(완료확정) 총합
  const allRows = await readRows(admin);
  const allCosted = allRows.filter((r) => r.cost != null);
  const totalCost = allCosted.reduce((a, r) => a + (r.cost as number), 0);
  console.log(`[wo] 완료확정 전체 ${allRows.length}건(비용有 ${allCosted.length}건) 총비용 ${won(totalCost)}`);

  // 코스별 순회
  const byCourse: { course: string; count: number; costedCount: number; total: number; rows: WO[] }[] = [];
  for (const course of courseOpts) {
    const picked = await cvs().select(new RegExp('^\\s*' + course.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')).catch(() => false);
    await admin.waitForTimeout(400); await applyFilters(admin);
    const rows = picked ? await readRows(admin) : [];
    const costed = rows.filter((r) => r.cost != null);
    const total = costed.reduce((a, r) => a + (r.cost as number), 0);
    byCourse.push({ course, count: rows.length, costedCount: costed.length, total, rows });
    console.log(`[wo]   코스 [${course}] ${rows.length}건(비용有 ${costed.length}) 합계 ${won(total)} (선택:${picked})`);
  }
  // 코스=전체 복원
  await cvs().select(/전체|코스\s*전체/).catch(() => {}); await applyFilters(admin);

  const sumByCourse = byCourse.reduce((a, c) => a + c.total, 0);

  // ── 작업별 코스 멤버십(교집합) — 한 작업이 복수 코스에 걸칠 수 있음 ──
  const uniq = new Map<string, WO & { courses: string[] }>();
  for (const c of byCourse) for (const r of c.rows) { const e = uniq.get(r.no) || { ...r, courses: [] }; if (!e.courses.includes(c.course)) e.courses.push(c.course); uniq.set(r.no, e); }
  for (const r of allRows) { if (!uniq.has(r.no)) uniq.set(r.no, { ...r, courses: [] }); }   // 코스 미태그 작업 포착
  const uniqList = [...uniq.values()];
  const uniqTotal = uniqList.filter((r) => r.cost != null).reduce((a, r) => a + (r.cost as number), 0);
  const multiCourse = uniqList.filter((r) => r.courses.length > 1);
  const noCourse = uniqList.filter((r) => r.courses.length === 0);
  const overlap = sumByCourse - uniqTotal;   // 중복 합산분(복수코스 작업이 여러 번 더해진 양)
  console.log(`[wo] 고유 ${uniqList.length}건 총 ${won(uniqTotal)} · 복수코스 ${multiCourse.length}건 · 코스미지정 ${noCourse.length}건 · 중복합산 ${won(overlap)}`);

  // ── 리포트 HTML ──
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const maxV = Math.max(1, ...byCourse.map((c) => c.total));
  const bars = byCourse.map((c) => { const pct = Math.round(c.total / maxV * 100); return `<div class="abar"><div class="abl">${esc(c.course)}</div><div class="abt"><div class="abf" style="width:${pct}%"></div></div><div class="abv">${won(c.total)}원 <span class="mut">(${c.costedCount}건)</span></div></div>`; }).join('');
  const courseTableRows = byCourse.map((c) => `<tr><td><b>${esc(c.course)}</b></td><td class="num">${c.costedCount}${c.count !== c.costedCount ? `<span class="mut">/${c.count}</span>` : ''}</td><td class="num">${won(c.total)}원</td><td class="num">${uniqTotal ? (c.total / uniqTotal * 100).toFixed(1) : '0'}%</td></tr>`).join('');
  const courseTag = (cs: string[]) => cs.length ? cs.map((c) => `<span class="tag">${esc(c)}</span>`).join('') : '<span class="mut">미지정</span>';
  const listRows = uniqList.sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1)).map((r) => `<tr${r.courses.length > 1 ? ' class="multi"' : ''}><td>${esc(r.no)}</td><td>${esc(r.name)}</td><td>${courseTag(r.courses)}</td><td>${esc(r.c1)}</td><td>${esc(r.c2)}</td><td class="num">${r.cost == null ? '<span class="mut">-</span>' : won(r.cost) + '원'}</td></tr>`).join('');

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>작업 지시 완료확정 — 코스별 비용 분석</title>
<style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,'Segoe UI','Malgun Gothic',sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:24px 18px 60px}h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}h2{font-size:16px;margin:24px 0 8px;border-bottom:2px solid var(--line);padding-bottom:6px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.card{flex:1 1 120px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:23px;font-weight:700}.card .l{font-size:12px;color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--mut);font-size:11.5px;background:var(--card)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}tr.mt td{font-weight:700;border-top:2px solid var(--fg);background:var(--card)}.mut{color:var(--mut)}
.tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;margin:8px 0}.tblwrap table{margin:0}
.abars{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin:8px 0}
.abar{display:flex;align-items:center;gap:10px;margin:6px 0}.abar .abl{flex:0 0 90px;font-size:12.5px;font-weight:700}.abar .abt{flex:1;background:var(--bg);border:1px solid var(--line);border-radius:5px;height:18px;overflow:hidden}.abar .abf{height:100%;background:var(--accent);border-radius:4px 0 0 4px}.abar .abv{flex:0 0 130px;text-align:right;font-size:12.5px;font-variant-numeric:tabular-nums}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13.5px;color:var(--mut);margin:10px 0}.note.info{border-left:3px solid var(--accent);color:var(--fg)}
.tag{display:inline-block;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1px 8px;font-size:11px;margin-right:3px}tr.multi td{background:rgba(9,105,218,.05)}
</style></head><body><div class="wrap">
<h1>작업 지시 완료확정 — 코스별 비용 분석</h1>
<div class="sub">작업 관리 &gt; 작업 지시(/task/orders) · 상태=완료확정 · 최근 1년 · 킹즈락 · 수집 ${ts} · 비파괴(조회만)</div>
<div class="cards">
<div class="card"><div class="n">${uniqList.length}</div><div class="l">완료확정 작업(고유)</div></div>
<div class="card"><div class="n">${won(uniqTotal)}</div><div class="l">총 비용(원, 고유)</div></div>
<div class="card"><div class="n">${multiCourse.length}</div><div class="l">복수 코스 작업</div></div>
<div class="card"><div class="n">${byCourse.length}</div><div class="l">코스 수</div></div>
</div>
<div class="note info">ℹ️ 한 작업이 <b>여러 코스에 걸칠 수 있어</b> 코스별 합계의 단순 합(${won(sumByCourse)}원)은 고유 총비용(${won(uniqTotal)}원)보다 <b>${won(overlap)}원 많습니다</b>(복수코스 <b>${multiCourse.length}건</b> 중복 합산). ${noCourse.length ? `코스 미지정 <b>${noCourse.length}건</b>. ` : ''}→ 코스별 금액은 <b>"해당 코스가 관련된 작업의 비용"</b>(중복 포함)으로 읽으세요. 아래 목록에서 각 작업의 코스 태그로 실제 귀속을 확인할 수 있습니다.</div>

<h2>코스별 비용 <span class="mut" style="font-size:12px;font-weight:400">— 해당 코스가 걸린 작업 기준(복수코스 중복 포함)</span></h2>
<div class="abars">${bars || '<div class="mut">완료확정 작업 데이터 없음</div>'}</div>
<div class="tblwrap"><table><thead><tr><th>코스</th><th class="num">작업 수(비용有)</th><th class="num">코스 관련 비용</th><th class="num">고유총합 대비</th></tr></thead><tbody>${courseTableRows}<tr class="mt"><td>고유 합계</td><td class="num">${uniqList.filter((r) => r.cost != null).length}</td><td class="num">${won(uniqTotal)}원</td><td class="num">100%</td></tr></tbody></table></div>

<h2>완료확정 작업 목록 <span class="mut" style="font-size:12px;font-weight:400">— 작업별 코스 태그 · 비용 내림차순</span></h2>
<div class="tblwrap"><table><thead><tr><th>작업번호</th><th>작업명</th><th>코스</th><th>1분류</th><th>2분류</th><th class="num">비용</th></tr></thead><tbody>${listRows || '<tr><td colspan="6" class="mut">데이터 없음</td></tr>'}</tbody></table></div>
<div class="note">※ 작업 지시 비용은 <b>완료 확정</b> 시에만 비용 화면에 집계됩니다. 코스는 작업 지시 목록의 <b>위치&gt;코스 필터</b> 기준(작업지시서의 작업 위치·복수 가능). 파란 행 = 복수 코스 작업. 비용 '-'는 원가 미투입/미집계 작업.</div>
</div></body></html>`;

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT_HTML, html, 'utf-8');
  console.log(`[wo] 리포트 생성: ${OUT_HTML} | 고유총 ${won(uniqTotal)} · 코스별단순합 ${won(sumByCourse)} · 복수코스 ${multiCourse.length}`);
});
