import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { num, near } from '../lib/course/domain/budgetCost';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  예산 총괄 > 연간 탭 (전연도 증감/YoY) 정합성 검증 (비파괴).
//   기존 미커버 — 예산총괄은 '월간 탭'만 수집됐고 '연간 탭'(2024·2025 YoY·2026 YoY)은 범위 밖이었음.
//   연간 탭 = 대/중분류 × [2024년 · 2025년(YoY%) · 2026년(YoY%)].
//   불변식: ① YoY% = round((당해−전년)/전년 ×100) ② 부호/방향(값↑=+/값↓=−) ③ 교차: Σ연간2026 = Σ월간(전월) 총예산.
//   실행: npm run course:auth 후 npm run course:budget-annual → reports/course-budget-annual.html
// ──────────────────────────────────────────────────────────────

interface Check { name: string; group: string; ok: boolean; na?: boolean; review?: boolean; detail: string; }
const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const won = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);

async function clickTab(admin: Page, re: RegExp): Promise<boolean> {
  const t = admin.locator('.contents, main').getByText(re, { exact: false }).first();
  if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1500); await killAlarms(admin); return true; }
  return false;
}
// 연간 탭 표: 각 행 → { 라벨(중분류), v2024, v2025, yoy2025, v2026, yoy2026 }.
//  값 셀은 "375,000,000 -6.55%"처럼 값+YoY배지 동거 → 값=첫 숫자군, yoy=부호 있는 % 토큰.
async function readAnnual(admin: Page): Promise<{ label: string; v: (number | null)[]; y: (number | null)[] }[]> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    // 값 셀 = "{값}{YoY}" 동거(예 "375,000,000-6.55%", "23,520,0000%"=값+무부호 0%).
    //  ⚠ YoY를 먼저 끝에서 떼어낸 뒤 값 파싱 — 안 그러면 '0%'의 0을 값이 삼켜 ×10 오독.
    const splitCell = (t0: string): { v: number | null; y: number | null } => {
      const t = norm(t0);
      // 값 = 선행 콤마그룹(3자리 단위) 숫자 → "23,520,0000%"서 정확히 23,520,000(다음이 ,### 아닌 0%라 경계 멈춤).
      //  ⚠ 콤마 무시 `[\d,]+`는 무부호 0% YoY의 0을 값이 삼켜 오독(×10/자릿수) → 3자리 그룹 규칙으로 분리.
      const vm = t.match(/^-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/);
      const v = vm ? Number(vm[0].replace(/,/g, '')) : null;
      const rest = vm ? t.slice(vm[0].length) : t;                  // 값 뒤 나머지에서 YoY 파싱
      const ym = rest.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
      const y = ym ? Number(ym[1]) : null;
      return { v: (v != null && Number.isFinite(v)) ? v : null, y: (y != null && Number.isFinite(y)) ? y : null };
    };
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return [];
    return Array.from(tbl.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      if (cells.some((c) => /총\s*예산|합계|소계|총계|전체/.test(c))) return null;   // 총계/소계 행 제외(이중계상 방지)
      const last3 = cells.slice(-3).map(splitCell);                 // 2024·2025·2026 우측앵커(대분류 rowspan 무관)
      const label = cells.length >= 4 ? cells[cells.length - 4] : (cells[0] || '');
      return { label, v: last3.map((c) => c.v), y: last3.map((c) => c.y) };
    }).filter((r): r is { label: string; v: (number | null)[]; y: (number | null)[] } => !!r && r.v.some((x) => x != null));
  }).catch(() => []);
}
// 월간 탭 총예산 = 모든 행 마지막 12셀(1~12월) 합.
async function monthlyGrand(admin: Page): Promise<number | null> {
  return admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const numOf = (t: string) => { const c = (t || '').replace(/[^0-9.\-]/g, ''); if (!c || c === '-' || c === '.') return null; const v = Number(c); return Number.isFinite(v) ? v : null; };
    const sc = document.querySelector('.contents, main') || document.body;
    const tbl = Array.from(sc.querySelectorAll('table')).find((t) => t.querySelectorAll('tbody tr').length >= 1);
    if (!tbl) return null;
    let sum = 0; let any = false;
    Array.from(tbl.querySelectorAll('tbody tr')).forEach((tr) => {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      if (cells.some((c) => /소계|합계|총\s*예산|총계|전체/.test(c))) return;   // 총계/소계 행 제외(이중계상 방지)
      cells.slice(-12).forEach((c) => { const v = numOf(c); if (v != null) { sum += v; any = true; } });
    });
    return any ? sum : null;
  }).catch(() => null);
}

test('예산 총괄 연간 탭(YoY) 정합성 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks: Check[] = [];

  const entered = await gotoCourseMenu(admin, '예산 관리', '예산 총괄').then(() => true).catch(() => false);
  await admin.waitForTimeout(1500); await killAlarms(admin);
  if (!entered) {
    checks.push({ name: '예산 총괄 진입', group: '진입', ok: true, na: true, detail: '진입 실패 — 판정 제외' });
  } else {
    // 월간 탭 총예산(교차 기준) 먼저 — 기본 탭이 월간
    await clickTab(admin, /^\s*월간\s*$/);
    const grandMonthly = await monthlyGrand(admin);

    // 연간 탭 전환 후 수집
    const okTab = await clickTab(admin, /^\s*연간\s*$/);
    const rows = okTab ? await readAnnual(admin) : [];
    if (!rows.length) {
      checks.push({ name: '연간 탭 표', group: 'YoY', ok: true, na: true, detail: `연간 탭/행 미검출 — 판정 제외(탭전환 ${okTab})` });
    } else {
      // ① YoY% 공식 (2025: vs 2024, 2026: vs 2025). 표시 YoY = round((당해−전년)/전년×100).
      //   ⚠ 표시 연도값이 원값 반올림이면 표시YoY와 ±0.01~0.02 오차 가능 → |Δ|≤0.1 PASS, 0.1<|Δ|≤0.6 확인필요, 그 외 FAIL.
      for (const [ci, prevI, label] of [[1, 0, '2025 YoY'], [2, 1, '2026 YoY']] as const) {
        let bad = 0, review = 0, cnt = 0; const exB: string[] = []; const exR: string[] = [];
        for (const r of rows) {
          const cur = r.v[ci], prev = r.v[prevI], shown = r.y[ci];
          if (cur == null || prev == null || shown == null || prev === 0) continue; cnt++;
          const expect = (cur - prev) / prev * 100; const d = Math.abs(shown - expect);
          if (d > 0.6) { bad++; if (exB.length < 3) exB.push(`${r.label}(표시 ${pct(shown)}≠계산 ${pct(expect)})`); }
          else if (d > 0.1) { review++; if (exR.length < 3) exR.push(`${r.label}(표시 ${pct(shown)} vs 계산 ${pct(expect)})`); }
        }
        checks.push({ name: `연간 · ${label} = round((당해−전년)/전년×100)`, group: 'YoY 공식', ok: bad === 0, na: cnt === 0, review: bad === 0 && review > 0,
          detail: cnt === 0 ? '대상 없음' : `${cnt}행 중 정합 ${cnt - bad - review}${review ? ` · 확인필요 ${review}(${exR.join(', ')})` : ''}${bad ? ` · 위반 ${bad}(${exB.join(', ')})` : ''}` });
      }
      // ② 부호/방향: YoY 부호 = sign(당해−전년) (엄격)
      for (const [ci, prevI, label] of [[1, 0, '2025'], [2, 1, '2026']] as const) {
        let bad = 0, cnt = 0; const ex: string[] = [];
        for (const r of rows) {
          const cur = r.v[ci], prev = r.v[prevI], shown = r.y[ci];
          if (cur == null || prev == null || shown == null || cur === prev) continue; cnt++;
          if (Math.sign(shown) !== Math.sign(cur - prev)) { bad++; if (ex.length < 3) ex.push(`${r.label}(값 ${won(prev)}→${won(cur)}, 배지 ${pct(shown)})`); }
        }
        checks.push({ name: `연간 · ${label} YoY 부호 = 값 증감 방향`, group: 'YoY 부호', ok: bad === 0, na: cnt === 0, detail: cnt === 0 ? '대상 없음' : `${cnt}행 중 ${cnt - bad} 일치${bad ? ` · 위반 ${bad}(${ex.join(', ')})` : ''}` });
      }
      // ③ 교차: Σ(연간 2026) = 월간 탭 총예산 (같은 화면 두 탭)
      const sum2026 = rows.reduce((a, r) => a + (r.v[2] || 0), 0);
      const sum2025 = rows.reduce((a, r) => a + (r.v[1] || 0), 0);
      const sum2024 = rows.reduce((a, r) => a + (r.v[0] || 0), 0);
      if (grandMonthly != null) checks.push({ name: '★ 교차: Σ연간2026 = 월간 탭 총예산', group: '교차', ok: near(sum2026, grandMonthly, 3), detail: `연간2026 Σ ${won(sum2026)} vs 월간 Σ(1~12월) ${won(grandMonthly)}` });
      else checks.push({ name: '★ 교차: Σ연간2026 = 월간 탭 총예산', group: '교차', ok: true, na: true, detail: `월간 총예산 미수집 — 연간2026 Σ ${won(sum2026)}` });
      checks.push({ name: '연간 총계(정보성)', group: '교차', ok: true, na: true, detail: `2024 ${won(sum2024)} · 2025 ${won(sum2025)} · 2026 ${won(sum2026)} (${rows.length}행)` });
    }
  }

  // ── 리포트 ──
  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok && !c.review).length; const rev = judged.filter((c) => c.ok && c.review).length; const fail = judged.filter((c) => !c.ok).length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: Check) => c.na ? '➖' : !c.ok ? '❌' : c.review ? '🔎' : '✅';
  const cls = (c: Check) => c.na ? 'na' : !c.ok ? 'ng' : c.review ? 'rv' : '';
  const rowsHtml = checks.map((c) => `<tr class="${cls(c)}"><td>${mark(c)}</td><td>${esc(c.group)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`).join('');
  const html = `<title>예산 총괄 연간(YoY) 검증</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--rv:#9a6700;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:960px;margin:0 auto;padding:24px 18px 60px;font:15px/1.6 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 90px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.rv-n{color:var(--rv)}.na-n{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.ng td{color:var(--ng);font-weight:600}tr.rv td{color:var(--rv)}tr.na td{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
</style><div class="wrap">
<h1>예산 총괄 — 연간 탭(전연도 증감/YoY) 검증</h1>
<div class="sub">/budget/summary 연간 탭 · 킹즈락 · ${ts} · 비파괴</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${rev ? 'rv-n' : 'ok-n'}">${rev}</div><div class="l">확인 필요</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">연간 탭 = 대/중분류 × [2024 · 2025(YoY%) · 2026(YoY%)]. <b>YoY% = round((당해−전년)/전년×100)</b> + 부호=값 증감 방향 + 교차(Σ연간2026 = 월간 탭 총예산). ⚠ 표시 연도값이 원값 반올림이면 표시 YoY와 ±0.01~0.02 오차 가능 → |Δ|≤0.1 정상 · 0.1&lt;|Δ|≤0.6 <b>확인 필요(🔎)</b> · 그 외 주의. 참고(➖)=판정 제외.</div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-budget-annual.html'), html, 'utf-8');
  console.log(`\n[예산총괄연간] 총 ${checks.length} · PASS ${pass} · 확인필요 ${rev} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-budget-annual.html');
});
