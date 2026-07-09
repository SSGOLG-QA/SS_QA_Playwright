/**
 * P3-D: 이력 트렌드 대시보드 생성기
 *
 * SQLite(reports/history.db) 이력을 읽어 정적 HTML 대시보드를 생성.
 * 스위트별 탭 + 트렌드 라인 차트(Chart.js CDN) + 실행 이력 테이블 + 최근 실행 대메뉴 현황.
 *
 * 실행:
 *   npm run dashboard
 *     → tsc --project tsconfig.json && node dist/scripts/generateDashboard.js
 *
 * 산출:
 *   reports/dashboard.html  (브라우저로 바로 열기 가능, 인터넷 필요 — Chart.js CDN)
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadTitles, loadRuns, loadRunMenus, RunRow } from '../lib/historyDb';

const OUT = path.join(process.cwd(), 'reports', 'dashboard.html');

// ── 유틸 ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mn = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mn}`;
  } catch { return iso; }
}

function rateColor(rate: number): string {
  if (rate >= 90) return '#008000';
  if (rate >= 70) return '#CC6600';
  return '#CC0000';
}

function escHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── HTML 조각 생성 ────────────────────────────────────────────────────────
function buildPanel(suite: { title: string; runs: RunRow[] }, idx: number): string {
  const { title, runs } = suite;
  if (!runs.length) return `<div class="panel${idx === 0 ? ' active' : ''}" id="p${idx}"><h2>${escHtml(title)}</h2><p class="empty">실행 이력 없음</p></div>`;

  const latest = runs[runs.length - 1];

  // 요약 카드
  const cards = `
    <div class="cards">
      <div class="card"><div class="label">최근 실행</div><div class="val sm">${fmtDate(latest.ts)}</div></div>
      <div class="card"><div class="label">전체</div><div class="val">${latest.total}</div></div>
      <div class="card pass"><div class="label">PASS</div><div class="val">${latest.pass}</div></div>
      <div class="card fail"><div class="label">FAIL</div><div class="val">${latest.fail}</div></div>
      <div class="card skip"><div class="label">SKIP</div><div class="val">${latest.skip}</div></div>
      <div class="card rate"><div class="label">PASS율</div><div class="val" style="color:${rateColor(latest.pass_rate)}">${latest.pass_rate}%</div></div>
    </div>`;

  // 트렌드 차트 (2회 이상 실행 시)
  const chartSection = runs.length >= 2 ? `
    <div class="chart-wrap"><canvas id="c${idx}"></canvas></div>
    <script>
    (function(){
      var ctx=document.getElementById('c${idx}').getContext('2d');
      new Chart(ctx,{
        type:'line',
        data:{
          labels:${JSON.stringify(runs.map(r => fmtDate(r.ts)))},
          datasets:[
            {label:'PASS',data:${JSON.stringify(runs.map(r => r.pass))},borderColor:'#008000',backgroundColor:'rgba(0,128,0,0.08)',tension:.3,fill:true,pointRadius:3},
            {label:'FAIL',data:${JSON.stringify(runs.map(r => r.fail))},borderColor:'#CC0000',backgroundColor:'rgba(204,0,0,0.08)',tension:.3,fill:true,pointRadius:3},
            {label:'PASS율(%)',data:${JSON.stringify(runs.map(r => r.pass_rate))},borderColor:'#2F6FB5',backgroundColor:'transparent',tension:.3,yAxisID:'y2',borderDash:[5,3],pointRadius:2}
          ]
        },
        options:{
          responsive:true,maintainAspectRatio:false,
          interaction:{mode:'index',intersect:false},
          plugins:{legend:{position:'top'},tooltip:{mode:'index'}},
          scales:{
            y:{beginAtZero:true,title:{display:true,text:'건수'},ticks:{color:'#444'}},
            y2:{beginAtZero:true,max:100,position:'right',title:{display:true,text:'PASS율(%)'},grid:{drawOnChartArea:false},ticks:{color:'#2F6FB5'}}
          }
        }
      });
    })();
    </script>` : `<p class="tip">※ 차트는 2회 이상 실행 후 표시됩니다.</p>`;

  // 실행 이력 테이블 (최근 30회, 역순)
  const histRows = [...runs].reverse().slice(0, 30).map((r, i) => {
    const bg = i % 2 === 0 ? '' : ' style="background:#f9fafc"';
    const rc = rateColor(r.pass_rate);
    return `<tr${bg}>
      <td>${fmtDate(r.ts)}</td>
      <td>${r.total}</td>
      <td class="p">${r.pass}</td>
      <td class="f">${r.fail > 0 ? `<b>${r.fail}</b>` : '0'}</td>
      <td class="s">${r.skip}</td>
      <td style="color:${rc};font-weight:bold">${r.pass_rate}%</td>
    </tr>`;
  }).join('');

  // 최근 실행 대메뉴별 현황
  const menus = loadRunMenus(latest.id);
  const menuSection = menus.length ? `
    <h3>최근 실행 — 대메뉴별 현황</h3>
    <table>
      <thead><tr><th>대메뉴</th><th>전체</th><th>PASS</th><th>FAIL</th><th>SKIP</th><th>PASS율</th></tr></thead>
      <tbody>${menus.map((m, i) => {
        const rate = (m.pass + m.fail) > 0 ? Math.round(m.pass / (m.pass + m.fail) * 100) : 0;
        const bg = i % 2 === 0 ? '' : ' style="background:#f9fafc"';
        return `<tr${bg}>
          <td>${escHtml(m.menu)}</td>
          <td>${m.total}</td>
          <td class="p">${m.pass}</td>
          <td class="f">${m.fail > 0 ? `<b style="color:#CC0000">${m.fail}</b>` : '0'}</td>
          <td class="s">${m.skip}</td>
          <td style="color:${rateColor(rate)}">${rate}%</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : '';

  return `
  <div class="panel${idx === 0 ? ' active' : ''}" id="p${idx}">
    <h2>${escHtml(title)} <span class="run-count">(${runs.length}회 실행)</span></h2>
    ${cards}
    ${chartSection}
    <h3>실행 이력 <span class="run-count">(최근 30회)</span></h3>
    <table>
      <thead><tr><th>실행 시각</th><th>전체</th><th>PASS</th><th>FAIL</th><th>SKIP</th><th>PASS율</th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>
    ${menuSection}
  </div>`;
}

function buildHtml(suites: Array<{ title: string; runs: RunRow[] }>): string {
  const tabs = suites.map((s, i) =>
    `<button class="tab${i === 0 ? ' active' : ''}" onclick="show(${i})">${escHtml(s.title)}</button>`,
  ).join('');
  const panels = suites.map((s, i) => buildPanel(s, i)).join('');
  const now = new Date().toLocaleString('ko-KR');
  const totalRuns = suites.reduce((acc, s) => acc + s.runs.length, 0);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SmartScore Admin — 테스트 이력 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box}
body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;margin:0;background:#f0f2f5;color:#1a1a2e;font-size:13px}
header{background:linear-gradient(135deg,#1F3864,#2F6FB5);color:#fff;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 8px rgba(0,0,0,.2)}
header h1{margin:0;font-size:17px;letter-spacing:-.3px}
.meta{font-size:11px;opacity:.75;text-align:right;line-height:1.6}
.tabs{display:flex;flex-wrap:wrap;gap:4px;padding:10px 24px 0;background:#1F3864}
.tab{background:rgba(255,255,255,.12);color:#fff;border:none;padding:7px 16px;border-radius:6px 6px 0 0;cursor:pointer;font-size:12px;transition:background .15s;font-family:inherit}
.tab:hover{background:rgba(255,255,255,.22)}
.tab.active{background:#f0f2f5;color:#1F3864;font-weight:700}
.panel{display:none;padding:20px 24px;max-width:1100px;margin:0 auto}
.panel.active{display:block}
h2{margin:0 0 14px;color:#1F3864;font-size:18px}
h3{margin:20px 0 8px;color:#2F3B52;font-size:13px;font-weight:700;border-bottom:2px solid #D9E1F2;padding-bottom:4px}
.run-count{font-size:12px;color:#999;font-weight:400}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px}
.card{background:#fff;border-radius:8px;padding:12px 18px;min-width:90px;box-shadow:0 1px 4px rgba(0,0,0,.08);text-align:center}
.label{font-size:10px;color:#999;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.val{font-size:22px;font-weight:700;color:#2F3B52}
.val.sm{font-size:14px}
.card.pass .val{color:#008000}
.card.fail .val{color:#CC0000}
.card.skip .val{color:#888}
.card.rate .val{font-size:22px}
.chart-wrap{background:#fff;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:18px;height:280px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-bottom:4px}
thead th{background:#2F3B52;color:#fff;padding:9px 11px;text-align:left;font-size:11px;font-weight:700;white-space:nowrap}
td{padding:7px 11px;border-bottom:1px solid #E8EEFA}
td.p{color:#008000}
td.f{color:#CC0000}
td.s{color:#888}
.empty{color:#999;font-style:italic}
.tip{color:#888;font-size:11px;margin:0 0 10px}
</style>
</head>
<body>
<header>
  <h1>SmartScore Admin — 테스트 이력 트렌드 대시보드</h1>
  <div class="meta">생성: ${escHtml(now)}<br>스위트 ${suites.length}종 · 누적 ${totalRuns}회</div>
</header>
<div class="tabs">${tabs}</div>
${panels}
<script>
function show(i){
  document.querySelectorAll('.tab').forEach(function(t,j){t.classList.toggle('active',i===j)});
  document.querySelectorAll('.panel').forEach(function(p,j){p.classList.toggle('active',i===j)});
}
</script>
</body>
</html>`;
}

// ── 메인 ─────────────────────────────────────────────────────────────────
try {
  const titles = loadTitles();
  if (!titles.length) {
    console.log('[dashboard] 실행 이력 없음 — 테스트를 먼저 실행하세요 (npm run test:all).');
    process.exit(0);
  }
  const suites = titles.map(title => ({ title, runs: loadRuns(title, 30) }));
  const html = buildHtml(suites);
  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(OUT, html, 'utf-8');
  console.log(`[dashboard] 생성 완료 → ${path.resolve(OUT)}`);
  console.log(`[dashboard] 스위트 ${suites.length}종: ${titles.join(', ')}`);
} catch (e: any) {
  console.error('[dashboard] 오류:', e?.message || String(e));
  process.exit(1);
}
