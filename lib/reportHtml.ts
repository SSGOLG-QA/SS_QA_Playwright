import type { TCResult } from './reporter';

// ──────────────────────────────────────────────────────────────
//  표준 리포트 HTML 렌더러 — 예산·비용/HOME 정합성 리포트와 동일한 2-tier 기준.
//  reporter.writeReport() 말미에서 호출되어, writeReport를 쓰는 모든 스펙이 자동으로 HTML을 얻는다.
//  구조: 한눈에 보기(요약3줄) · 측정 관점 배너 · 참고사항 아코디언(잡는것/못잡는것) · 카드 · 결과표(화면별·➖참고) · 용어풀이.
//  SKIP = '참고(판정 제외)'로 취급(pass/fail 집계 제외) — "미확인 ≠ 결함".
// ──────────────────────────────────────────────────────────────

export interface ReportHtmlOpts {
  subtitle?: string;             // 부제(수집 대상·시각 등)
  lead?: string;                 // 한눈에 보기 본문(스펙별). 없으면 생성.
  catch?: string[];              // ✅ 잡아냅니다 불릿
  miss?: string[];               // ⚠ 못 잡습니다(한계) 불릿
  note?: string[];               // ℹ️ 참고 불릿
  glossary?: { term: string; desc: string }[];
}

const esc = (s: unknown): string => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const topScreen = (p: string): string => { const parts = (p || '').split('>').map((x) => x.trim()).filter(Boolean); return parts.length >= 2 ? `${parts[0]} > ${parts[1]}` : (parts[0] || '기타'); };
const tail = (p: string): string => { const parts = (p || '').split('>').map((x) => x.trim()).filter(Boolean); return parts.slice(2).join(' > ') || parts.slice(1).join(' > ') || parts[0] || ''; };

export function renderStandardReportHtml(title: string, results: TCResult[], opts: ReportHtmlOpts = {}): string {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const na = results.filter((r) => r.status === 'SKIP').length;
  const judged = pass + fail;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // 화면별 그룹
  const groups = new Map<string, TCResult[]>();
  for (const r of results) { const k = topScreen(r.path); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }

  const mark = (s: string) => s === 'PASS' ? '✅' : s === 'FAIL' ? '❌' : '➖';
  const rowCls = (s: string) => s === 'FAIL' ? 'ng' : s === 'SKIP' ? 'na' : '';
  const detailOf = (r: TCResult) => r.actual || r.error || r.detail || r.desc || '';

  const groupHtml = [...groups.entries()].map(([scr, rows]) => {
    const gp = rows.filter((r) => r.status === 'PASS').length;
    const gf = rows.filter((r) => r.status === 'FAIL').length;
    const gn = rows.filter((r) => r.status === 'SKIP').length;
    const body = rows.map((r) => `<tr class="${rowCls(r.status)}"><td class="ctr">${mark(r.status)}</td><td>${esc(tail(r.path) || r.desc)}</td><td>${esc(detailOf(r))}</td></tr>`).join('');
    return `<details class="grp"${gf ? ' open' : ''}><summary><span class="gname">${esc(scr)}</span> <span class="gfrac"><span class="ok-n">${gp}</span>${gf ? ` · <span class="ng-n">${gf}</span>` : ''}${gn ? ` · <span class="na-n">${gn}</span>` : ''} / ${rows.length}</span></summary>
      <table><thead><tr><th class="ctr" style="width:34px"></th><th>항목</th><th>결과·설명</th></tr></thead><tbody>${body}</tbody></table></details>`;
  }).join('');

  const leadTxt = opts.lead || `이 리포트는 <b>${esc(title)}</b>를 자동 검증한 결과입니다. 확인 항목 <b>${judged}개</b> 중 <span class="ok-n">정상 ${pass}개</span>${fail ? ` · <span class="ng-n">주의 ${fail}개</span>` : ' · 주의 0개'}${na ? ` · <span class="na-n">참고 ${na}개</span>(데이터 없어 판정 제외)` : ''}.`;
  const catchArr = opts.catch && opts.catch.length ? opts.catch : ['화면에 표시돼야 할 요소/값이 <b>빠지거나 어긋난</b> 경우', '설계·계산 기준과 <b>다른</b> 값'];
  const missArr = opts.miss && opts.miss.length ? opts.miss : ['화면에 <b>보이지 않는</b> 내부 로직·서버 계산의 세부', '데이터가 없어 <b>확인 못 한</b> 항목(참고로 분리)'];
  const noteArr = opts.note && opts.note.length ? opts.note : ['데이터 없는 항목은 <b>판정 제외(참고)</b> — 결함 아님', '통과 수 = 완벽이 아니라, <b>결과와 함께 적힌 설명</b>을 확인'];
  const gloss = (opts.glossary && opts.glossary.length ? opts.glossary : [
    { term: '정상 / 주의 / 참고', desc: '정상=기준과 일치. 주의=다르거나 확인 필요. 참고=데이터 없어 판정 제외(결함 아님).' },
    { term: '비파괴', desc: '확인만 하고 저장·삭제·수정은 하지 않아 실제 데이터가 바뀌지 않음.' },
  ]);

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f8f9fa;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:1040px;margin:0 auto;padding:24px 18px 60px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:8px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:23px;font-weight:700}.card .l{font-size:12px;color:var(--mut)}
.ok-n{color:var(--ok);font-weight:700}.ng-n{color:var(--ng);font-weight:700}.na-n{color:var(--mut);font-weight:700}.mut{color:var(--mut)}
.lead{font-size:16.5px;line-height:1.8;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:14px 0 10px}.lead b{font-size:18px}
.persp{font-size:12.5px;color:var(--mut);background:var(--card);border:1px dashed var(--line);border-radius:8px;padding:9px 13px;margin:10px 0}
details.aux{margin:0 0 40px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
details.aux>summary{cursor:pointer;list-style:none;padding:10px 14px;font-size:13px;font-weight:600;color:var(--mut)}
details.aux>summary::-webkit-details-marker{display:none}
details.aux>summary::after{content:" ▾";color:var(--mut)}details.aux[open]>summary::after{content:" ▴"}
details.aux[open]>summary{border-bottom:1px solid var(--line)}
.auxbody{padding:12px 16px;font-size:13px;line-height:1.7}
.htitle{font-weight:700;margin-bottom:8px}
.hrow{display:flex;gap:9px;align-items:flex-start;margin:9px 0}.hrow .hic{flex:0 0 auto;font-size:14px}.hrow .hbody{flex:1}.hrow .hlbl{display:block;font-weight:700;margin-bottom:3px}
.hrow ul{margin:0;padding-left:16px}.hrow li{margin:2px 0;line-height:1.55}
.hrow.ok .hlbl{color:var(--ok)}.hrow.warn .hlbl{color:var(--ng)}.hrow.info .hlbl{color:var(--mut)}
details.grp{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:8px 0;overflow:hidden}
details.grp>summary{cursor:pointer;list-style:none;padding:11px 15px;display:flex;justify-content:space-between;gap:12px;align-items:center}
details.grp>summary::-webkit-details-marker{display:none}.gname{font-weight:600}.gfrac{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:7px 10px;border-top:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-size:11.5px;background:var(--card)}
td.ctr,th.ctr{text-align:center}tr.ng td{color:var(--ng)}tr.na td{color:var(--mut)}
details.gloss{margin:28px 0 0;font-size:13px;color:var(--mut);background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px}details.gloss summary{cursor:pointer;font-weight:700;color:var(--fg)}details.gloss dt{font-weight:700;color:var(--fg);margin-top:8px}details.gloss dd{margin:0 0 2px 0}
</style></head><body><div class="wrap">
<h1>${esc(title)}</h1>
<div class="sub">${esc(opts.subtitle || `자동 검증 리포트 · ${ts}`)}</div>
<div class="lead"><b>한눈에 보기.</b> ${leadTxt}</div>
<div class="persp">📏 <b>보는 관점:</b> 화면에 <b>표시된 값·요소</b>를 기준으로 확인합니다(앱 내부 코드 커버리지가 아님). 확인 중 저장·변경하지 않습니다(비파괴).</div>
<details class="aux"><summary>💡 리포트 검증 관점 및 참고사항 보기</summary><div class="auxbody">
<div class="htitle">이 검증이 잡는 것과 못 잡는 것</div>
<div class="hrow ok"><span class="hic">✅</span><div class="hbody"><span class="hlbl">잡아냅니다</span><ul>${catchArr.map((x) => `<li>${x}</li>`).join('')}</ul></div></div>
<div class="hrow warn"><span class="hic">⚠️</span><div class="hbody"><span class="hlbl">못 잡습니다 (한계)</span><ul>${missArr.map((x) => `<li>${x}</li>`).join('')}</ul></div></div>
<div class="hrow info"><span class="hic">ℹ️</span><div class="hbody"><span class="hlbl">참고</span><ul>${noteArr.map((x) => `<li>${x}</li>`).join('')}</ul></div></div>
</div></details>
<div class="cards"><div class="card"><div class="n">${judged}</div><div class="l">확인 항목</div></div><div class="card"><div class="n ok-n">${pass}</div><div class="l">정상 통과</div></div><div class="card"><div class="n ${fail ? 'ng-n' : 'ok-n'}">${fail}</div><div class="l">주의 필요</div></div>${na ? `<div class="card"><div class="n na-n">${na}</div><div class="l">참고(데이터없음)</div></div>` : ''}</div>
<h2 style="font-size:15px;margin:26px 0 6px">화면별 결과</h2>
${groupHtml || '<div class="persp">결과 항목이 없습니다.</div>'}
<details class="gloss"><summary>용어 풀이</summary><dl>${gloss.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.desc)}</dd>`).join('')}</dl></details>
</div></body></html>`;
}
