import type { TCResult } from './reporter';

// ──────────────────────────────────────────────────────────────
//  표준 리포트 HTML 렌더러 — 예산·비용/HOME 정합성 리포트와 동일한 2-tier 기준 + 탭 구조.
//  reporter.writeReport() 말미에서 호출되어, writeReport를 쓰는 모든 스펙이 자동으로 HTML을 얻는다.
//  탭: ① 요약(대메뉴별 현황·주요 확인사항) · ② 메뉴별 상세(화면별 결과표).
//  상단(항상 노출): 한눈에 보기 · 측정 관점 · 참고사항 아코디언. SKIP=참고(판정 제외), "확인 필요"는 🔎 강조.
// ──────────────────────────────────────────────────────────────

export interface ReportHtmlOpts {
  subtitle?: string;
  lead?: string;
  catch?: string[];
  miss?: string[];
  note?: string[];
  glossary?: { term: string; desc: string }[];
}

const esc = (s: unknown): string => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m] as string));
const segs = (p: string): string[] => (p || '').split('>').map((x) => x.trim()).filter(Boolean);
const topMenu = (p: string): string => segs(p)[0] || '기타';
const topScreen = (p: string): string => { const s = segs(p); return s.length >= 2 ? `${s[0]} > ${s[1]}` : (s[0] || '기타'); };
const tail = (p: string): string => { const s = segs(p); return s.slice(2).join(' > ') || s.slice(1).join(' > ') || s[0] || ''; };

export function renderStandardReportHtml(title: string, results: TCResult[], opts: ReportHtmlOpts = {}): string {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const na = results.filter((r) => r.status === 'SKIP').length;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const REVIEW_RE = /확인\s*필요|미집계|의심|재확인|점검\s*필요|별도\s*확인/;
  const detailOf = (r: TCResult) => r.actual || r.error || r.detail || r.desc || '';
  const isReview = (r: TCResult) => r.status === 'SKIP' && REVIEW_RE.test(`${detailOf(r)} ${r.desc || ''} ${r.error || ''}`);
  const reviewRows = results.filter(isReview);
  // 확인 항목(판정 대상) = 정상 + 주의필요(결함+확인필요). 확인 필요는 SKIP이지만 "주의 필요"로 승격 집계.
  const judged = pass + fail + reviewRows.length;
  const failRows = results.filter((r) => r.status === 'FAIL');
  const mark = (r: TCResult) => r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : isReview(r) ? '🔎' : '➖';
  const rowCls = (r: TCResult) => r.status === 'FAIL' ? 'ng' : isReview(r) ? 'rv' : r.status === 'SKIP' ? 'na' : '';

  // ── 대메뉴별 집계 ──
  const menus = new Map<string, TCResult[]>();
  for (const r of results) { const k = topMenu(r.path); if (!menus.has(k)) menus.set(k, []); menus.get(k)!.push(r); }
  const menuAgg = [...menus.entries()].map(([m, rows]) => {
    const p = rows.filter((r) => r.status === 'PASS').length;
    const f = rows.filter((r) => r.status === 'FAIL').length;
    const rv = rows.filter(isReview).length;
    const naE = rows.filter((r) => r.status === 'SKIP').length - rv;
    return { m, judged: p + f + rv, p, f, rv, na: naE };
  });
  const menuTableRows = menuAgg.map((a) => { const at = a.f + a.rv; return `<tr class="${at ? 'ng' : ''}"><td>${esc(a.m)}</td><td class="num">${a.judged}</td><td class="num ok-n">${a.p}</td><td class="num ${a.f ? 'ng-n' : a.rv ? 'rv-n' : ''}">${at || ''}${a.rv ? ` <span class="mut" style="font-weight:400">(🔎${a.rv})</span>` : ''}</td><td class="num na-n">${a.na || ''}</td></tr>`; }).join('');

  // ── 화면별(소메뉴) 상세 그룹 ──
  const groups = new Map<string, TCResult[]>();
  for (const r of results) { const k = topScreen(r.path); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(r); }
  const groupHtml = [...groups.entries()].map(([scr, rows]) => {
    const gp = rows.filter((r) => r.status === 'PASS').length;
    const gf = rows.filter((r) => r.status === 'FAIL').length;
    const grv = rows.filter(isReview).length;
    const gn = rows.filter((r) => r.status === 'SKIP').length - grv;
    const body = rows.map((r) => {
      // 기대값/원문(expected)이 있으면 결과·설명 아래에 회색 부가행으로 병기(언어검증=한국어 원문, 안내문구=TC 원문 등).
      const exp = (r.expected || '').trim();
      const expLine = exp && exp !== '-' ? `<div class="mut" style="font-size:12px;margin-top:2px">${esc(exp)}</div>` : '';
      return `<tr class="${rowCls(r)}"><td class="ctr">${mark(r)}</td><td>${esc(tail(r.path) || r.desc)}</td><td>${esc(detailOf(r))}${expLine}</td></tr>`;
    }).join('');
    return `<details class="grp"${gf || grv ? ' open' : ''}><summary><span class="gname">${esc(scr)}</span> <span class="gfrac"><span class="ok-n">${gp}</span>${gf ? ` · <span class="ng-n">${gf}</span>` : ''}${grv ? ` · <span class="rv-n">🔎${grv}</span>` : ''}${gn ? ` · <span class="na-n">${gn}</span>` : ''} / ${rows.length}</span></summary>
      <table><thead><tr><th class="ctr" style="width:34px"></th><th>항목</th><th>결과·설명</th></tr></thead><tbody>${body}</tbody></table></details>`;
  }).join('');

  // ── 주요 확인사항(주의 + 확인 필요) ──
  const attn = [...failRows.map((r) => ({ r, kind: 'ng' as const })), ...reviewRows.map((r) => ({ r, kind: 'rv' as const }))];
  const attnHtml = attn.length
    ? attn.slice(0, 60).map(({ r, kind }) => `<div class="attnitem ${kind}"><span>${kind === 'ng' ? '❌ 주의' : '🔎 확인 필요'}</span> <b>${esc(topScreen(r.path))}</b> — ${esc(tail(r.path) || r.desc)}<div class="attnd">${esc(detailOf(r))}</div></div>`).join('') + (attn.length > 60 ? `<div class="mut">… 외 ${attn.length - 60}건</div>` : '')
    : '<div class="okbox">✅ 주의·확인 필요 항목 없음 — 확인 항목 전부 정상입니다.</div>';

  const attnCount = fail + reviewRows.length;   // 주의 필요 = 결함(주의) + 확인 필요(미집계 등)
  const pureNa = na - reviewRows.length;
  const leadTxt = opts.lead || `이 리포트는 <b>${esc(title)}</b>를 자동 검증한 결과입니다. 확인 항목 <b>${judged}개</b> 중 <span class="ok-n">정상 ${pass}개</span>${attnCount ? ` · <span class="${fail ? 'ng-n' : 'rv-n'}">주의 필요 ${attnCount}개</span>${reviewRows.length ? `(확인 필요 ${reviewRows.length} 포함)` : ''}` : ' · 주의 0개'}${pureNa > 0 ? ` · <span class="na-n">참고 ${pureNa}개</span>` : ''}.`;
  const catchArr = opts.catch && opts.catch.length ? opts.catch : ['화면에 표시돼야 할 요소/값이 <b>빠지거나 어긋난</b> 경우', '설계·계산 기준과 <b>다른</b> 값'];
  const missArr = opts.miss && opts.miss.length ? opts.miss : ['화면에 <b>보이지 않는</b> 내부 로직·서버 계산의 세부', '데이터가 없어 <b>확인 못 한</b> 항목(참고로 분리)'];
  const noteArr = opts.note && opts.note.length ? opts.note : ['데이터 없는 항목은 <b>판정 제외(참고)</b> — 결함 아님', '🔎 <b>확인 필요</b>는 데이터 없음/미집계 추정 — 사람이 원천 화면에서 실제 값 확인', '통과 수 = 완벽이 아니라, <b>결과와 함께 적힌 설명</b>을 확인'];
  const gloss = (opts.glossary && opts.glossary.length ? opts.glossary : [
    { term: '정상 / 주의 / 확인 필요 / 참고', desc: '정상=기준과 일치. 주의(빨강)=다르거나 확인 필요. 확인 필요(노랑)=데이터 없음/미집계 추정으로 사람이 확인. 참고(회색)=데이터 없어 판정 제외(결함 아님).' },
    { term: '비파괴', desc: '확인만 하고 저장·삭제·수정은 하지 않아 실제 데이터가 바뀌지 않음.' },
  ]);

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fff;--fg:#1a1d24;--mut:#5b6472;--line:#e3e7ee;--card:#f8f9fa;--ok:#1a7f37;--ng:#cf222e;--accent:#0969da;--warn:#9a6700;--warnbg:#fff8e5;--warnbd:#e0b84f}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff;--warn:#e3b341;--warnbg:#2a2413;--warnbd:#645209}}
:root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--line:#30363d;--card:#161b22;--ok:#3fb950;--ng:#f85149;--accent:#58a6ff;--warn:#e3b341;--warnbg:#2a2413;--warnbd:#645209}
*{box-sizing:border-box}body{margin:0;background:var(--bg)}.wrap{max-width:1040px;margin:0 auto;padding:24px 18px 60px;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Malgun Gothic',sans-serif;color:var(--fg)}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:8px}h2{font-size:15px;margin:22px 0 6px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0;align-items:flex-start}.card{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .n{font-size:23px;font-weight:700}.card .l{font-size:12px;color:var(--mut)}
.scard{flex:1 1 100px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
.scard.sng{border-color:var(--ng)}.scard.srv{border-color:var(--warnbd)}
.scard>summary{cursor:pointer;list-style:none;padding:12px 14px}.scard>summary::-webkit-details-marker{display:none}
.scard>summary .n{font-size:23px;font-weight:700}.scard>summary .l{font-size:12px;color:var(--mut)}
.scard-body{padding:2px 14px 12px;border-top:1px solid var(--line);max-height:420px;overflow:auto}
.ok-n{color:var(--ok);font-weight:700}.ng-n{color:var(--ng);font-weight:700}.na-n{color:var(--mut);font-weight:700}.rv-n{color:var(--warn);font-weight:700}.mut{color:var(--mut)}
.lead{font-size:16.5px;line-height:1.8;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:14px 0 10px}.lead b{font-size:18px}
.persp{font-size:12.5px;color:var(--mut);background:var(--card);border:1px dashed var(--line);border-radius:8px;padding:9px 13px;margin:10px 0}
details.aux{margin:0 0 16px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
details.aux>summary{cursor:pointer;list-style:none;padding:10px 14px;font-size:13px;font-weight:600;color:var(--mut)}
details.aux>summary::-webkit-details-marker{display:none}
details.aux>summary::after{content:" ▾";color:var(--mut)}details.aux[open]>summary::after{content:" ▴"}
details.aux[open]>summary{border-bottom:1px solid var(--line)}.auxbody{padding:12px 16px;font-size:13px;line-height:1.7}
.htitle{font-weight:700;margin-bottom:8px}
.hrow{display:flex;gap:9px;align-items:flex-start;margin:9px 0}.hrow .hic{flex:0 0 auto;font-size:14px}.hrow .hbody{flex:1}.hrow .hlbl{display:block;font-weight:700;margin-bottom:3px}
.hrow ul{margin:0;padding-left:16px}.hrow li{margin:2px 0;line-height:1.55}
.hrow.ok .hlbl{color:var(--ok)}.hrow.warn .hlbl{color:var(--ng)}.hrow.info .hlbl{color:var(--mut)}
.tabin{position:absolute;left:-9999px}.tabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin:20px 0 0;flex-wrap:wrap}
.tabs label{padding:9px 15px;cursor:pointer;font-weight:600;font-size:13.5px;color:var(--mut);border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0}
#rt1:checked~.tabs label[for=rt1],#rt2:checked~.tabs label[for=rt2]{color:var(--fg);border-color:var(--line);background:var(--card)}
.panel{display:none;padding-top:16px}#rt1:checked~#rp1,#rt2:checked~#rp2{display:block}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:7px 10px;border-top:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-size:11.5px;background:var(--card)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}td.ctr,th.ctr{text-align:center}tr.ng td{color:var(--ng)}tr.na td{color:var(--mut)}tr.rv td{background:var(--warnbg);color:var(--warn);font-weight:600}
tr.mt td{font-weight:700;border-top:2px solid var(--fg);background:var(--card)}
.tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;margin:8px 0}.tblwrap table{margin:0}
details.grp{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:8px 0;overflow:hidden}
details.grp>summary{cursor:pointer;list-style:none;padding:11px 15px;display:flex;justify-content:space-between;gap:12px;align-items:center}
details.grp>summary::-webkit-details-marker{display:none}.gname{font-weight:600}.gfrac{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:var(--mut)}
.reviewbox{background:var(--warnbg);border:1px solid var(--warnbd);border-left:4px solid var(--warn);border-radius:10px;padding:14px 16px;margin:14px 0}.reviewbox .rvtitle{font-weight:700;color:var(--warn);margin-bottom:8px}.reviewbox .rvitem{font-size:13px;margin:4px 0;line-height:1.5}
.attnitem{border:1px solid var(--line);border-left:4px solid var(--line);border-radius:8px;padding:9px 13px;margin:8px 0;font-size:13.5px}
.attnitem.ng{border-left-color:var(--ng)}.attnitem.rv{border-left-color:var(--warn);background:var(--warnbg)}
.attnitem .attnd{color:var(--mut);font-size:12.5px;margin-top:3px}
.okbox{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:8px;padding:12px 15px;color:var(--ok);font-weight:600}
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

<input class="tabin" type="radio" name="rtab" id="rt1" checked><input class="tabin" type="radio" name="rtab" id="rt2">
<div class="tabs"><label for="rt1">① 요약 · 현황</label><label for="rt2">② 메뉴별 상세</label></div>

<div class="panel" id="rp1">
<div class="cards">
<div class="card"><div class="n">${judged}</div><div class="l">확인 항목</div></div>
<div class="card"><div class="n ok-n">${pass}</div><div class="l">정상 통과</div></div>
${attnCount ? `<details class="scard ${fail ? 'sng' : 'srv'}" open><summary><span class="n ${fail ? 'ng-n' : 'rv-n'}">${attnCount}</span><span class="l">주의 필요 ▾${reviewRows.length ? `<br><span class="mut" style="font-weight:400">확인 필요 ${reviewRows.length} 포함</span>` : ''}</span></summary><div class="scard-body">${attnHtml}</div></details>` : `<div class="card"><div class="n ok-n">0</div><div class="l">주의 필요</div></div>`}
${pureNa > 0 ? `<div class="card"><div class="n na-n">${pureNa}</div><div class="l">참고(데이터없음)</div></div>` : ''}
</div>
<h2>대메뉴별 현황</h2>
<div class="tblwrap"><table><thead><tr><th>대메뉴</th><th class="num">확인</th><th class="num">정상</th><th class="num">주의 필요</th><th class="num">참고</th></tr></thead><tbody>${menuTableRows}<tr class="mt"><td>합계</td><td class="num">${judged}</td><td class="num ok-n">${pass}</td><td class="num ${fail ? 'ng-n' : reviewRows.length ? 'rv-n' : ''}">${attnCount || ''}${reviewRows.length ? ` <span class="mut" style="font-weight:400">(🔎${reviewRows.length})</span>` : ''}</td><td class="num na-n">${pureNa > 0 ? pureNa : ''}</td></tr></tbody></table></div>
</div>

<div class="panel" id="rp2">
${groupHtml || '<div class="persp">결과 항목이 없습니다.</div>'}
</div>

<details class="gloss"><summary>용어 풀이</summary><dl>${gloss.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.desc)}</dd>`).join('')}</dl></details>
</div></body></html>`;
}
