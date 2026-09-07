import { test, Page } from '@playwright/test';
import { openCourseAdmin } from '../lib/course/courseHelpers';
import { verifyCostHierarchy, HierCheck } from '../lib/course/costHierarchy';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  비용 계층(코스→홀→구분) 확장 검증 (비파괴) — 단독 리포트.
//   검증 로직은 lib/course/costHierarchy.verifyCostHierarchy 공용(정합성 스위트 course:budget-verify에도 편입).
//   대상 ① 기간별 비용 위치탭: 코스카드/홀별카드 + 표 [코스/홀/구분 × 2024/2025(YoY)/2026(YoY)]
//        ② 위치별 비용 연간·월간: [코스/홀 × 총비용/구분/유형] · [합계/12개월]
//   실행: npm run course:auth → npm run course:cost-hier-verify → reports/course-cost-hierarchy.html
// ──────────────────────────────────────────────────────────────

const esc = (s: string) => (s || '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));

test('비용 계층(코스→홀→구분) 확장 검증(비파괴)', async ({ page, context }) => {
  test.setTimeout(700_000);
  const admin: Page = await openCourseAdmin(page, context);
  const checks: HierCheck[] = await verifyCostHierarchy(admin);

  const judged = checks.filter((c) => !c.na); const na = checks.length - judged.length;
  const pass = judged.filter((c) => c.ok && !c.review).length; const rev = judged.filter((c) => c.ok && c.review).length; const fail = judged.filter((c) => !c.ok).length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const mark = (c: HierCheck) => c.na ? '➖' : !c.ok ? '❌' : c.review ? '🔎' : '✅';
  const cls = (c: HierCheck) => c.na ? 'na' : !c.ok ? 'ng' : c.review ? 'rv' : '';
  const numish = (s: string) => /^-?[\d,]+$|^[+-]?\d+(\.\d+)?%$|증가|감소/.test((s || '').trim());
  const evTable = (ev?: { headers: string[]; rows: string[][] }) => (ev && ev.rows.length)
    ? `<table class="ev"><thead><tr>${ev.headers.map((h) => `<th class="${/값|Σ|YoY|합계|총비용|연도|20\d\d/.test(h) ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${ev.rows.map((r) => `<tr>${r.map((c) => `<td class="${numish(c) ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    : '';
  const rowsHtml = checks.map((c) => `<tr class="${cls(c)}"><td>${mark(c)}</td><td>${esc(c.group)}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`
    + (c.evidence && c.evidence.rows.length ? `<tr class="evrow"><td></td><td></td><td colspan="2"><details><summary>▸ 근거 데이터 ${c.evidence.rows.length}행</summary><div class="evwrap">${evTable(c.evidence)}</div></details></td></tr>` : '')).join('');
  const html = `<title>비용 계층 확장 검증</title><style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f6f8fb;--ok:#1a7f37;--ng:#cf222e;--rv:#9a6700;--accent:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--rv:#e3b341;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:1000px;margin:0 auto;padding:24px 18px 60px;font:15px/1.6 -apple-system,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:21px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:14px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.card{flex:1 1 90px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:24px;font-weight:800}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok)}.ng-n{color:var(--ng)}.rv-n{color:var(--rv)}.na-n{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-size:11.5px;background:var(--card)}
tr.ng td{color:var(--ng);font-weight:600}tr.rv td{color:var(--rv)}tr.na td{color:var(--mut)}
.note{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px;font-size:13px;color:var(--mut);margin:10px 0;border-left:3px solid var(--accent)}
tr.evrow td{padding:2px 10px 12px}summary{cursor:pointer;color:var(--accent);font-size:12px}.evwrap{overflow-x:auto;max-width:100%}
table.ev{border-collapse:collapse;width:100%;font-size:12px;margin:5px 0}table.ev th,table.ev td{border:1px solid var(--line);padding:4px 7px;text-align:left;white-space:nowrap}table.ev th{background:var(--card);color:var(--mut);font-size:11px}table.ev td.num,table.ev th.num{text-align:right;font-variant-numeric:tabular-nums}
</style><div class="wrap">
<h1>비용 계층(코스→홀→구분) 확장 검증</h1>
<div class="sub">기간별 비용(위치탭) + 위치별 비용(연간·월간) · 킹즈락 · ${ts} · 비파괴</div>
<div class="cards"><div class="card"><div class="n">${judged.length}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상</div></div><div class="card"><div class="n ${rev ? 'rv-n' : 'ok-n'}">${rev}</div><div class="l">확인 필요</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고</div></div>` : ''}</div>
<div class="note">코스 카드 펼쳐보기 + 표 [+](button.tree-toggle) 확장 후 <b>홀별 상세 금액·증감(YoY)</b> 검증. A(기간별-위치): YoY공식·부호·코스=Σ홀·홀=Σ구분·전체=코스전체+Σ코스·카드=표. B(위치별): 총비용=Σ구분=Σ비용유형·코스=Σ홀(연간) · 합계=Σ월·코스=Σ홀·월간합계=연간총비용(월간). 참고(➖)=판정 제외. ⚠ 2026 수치는 등록된 작업지시(중복 포함) 자동집계 반영 — 검증은 구조 불변식이라 값 변동과 무관. <b>이 검증은 정합성 스위트(course:budget-verify)에도 편입됨.</b></div>
<table><thead><tr><th></th><th>영역</th><th>검증</th><th>결과</th></tr></thead><tbody>${rowsHtml}</tbody></table>
</div>`;
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(path.join('reports', 'course-cost-hierarchy.html'), html, 'utf-8');
  console.log(`\n[비용계층] 총 ${checks.length} · PASS ${pass} · 확인필요 ${rev} · FAIL ${fail} · NA ${na}`);
  for (const c of checks) console.log(`  ${mark(c)} [${c.group}] ${c.name} — ${c.detail}`);
  console.log('[report] reports/course-cost-hierarchy.html');
});
