/**
 * 드리프트 비교 — 최근 두 전체테스트 리포트(reports/전체테스트_report_*.xlsx)를 대조해
 *   신규 FAIL(회귀) · 해소된 FAIL · 신규 기획-구현 차이를 산출한다.
 *
 *  용도: 야간 풀스캔 자동화. (예) Windows 작업 스케줄러
 *    npm run test:all && npm run drift:diff
 *  → 직전 회차 대비 새로 생긴 FAIL/차이만 리포트(누적 노이즈 제거). 신규 FAIL 있으면 exit 2(게이팅).
 *
 *  실행: npx tsc --project tsconfig.json && node dist/scripts/driftDiff.js
 *        (또는 npm run drift:diff)
 *  산출: 콘솔 요약 + reports/drift-diff_<ts>.md
 */
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

const REPORTS = 'reports';

function latestReports(n = 2): string[] {
  if (!fs.existsSync(REPORTS)) return [];
  return fs.readdirSync(REPORTS).filter(f => /^전체테스트_report_.*\.xlsx$/.test(f)).sort().slice(-n).map(f => path.join(REPORTS, f));
}

async function extract(file: string): Promise<{ fails: Record<string, string>; diffs: Record<string, string> }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const fails: Record<string, string> = {};
  const diffs: Record<string, string> = {};
  wb.eachSheet(ws => {
    let hdr: string[] = [];
    const rows: string[][] = [];
    ws.eachRow((row, n) => {
      const v = (row.values as any[]).slice(1).map(x => (x == null ? '' : (typeof x === 'object' && x.text ? x.text : String(x))).trim());
      if (n === 1) { hdr = v; return; }
      rows.push(v);
    });
    if (/차이/.test(ws.name)) { rows.forEach(r => { const k = r.join('|').slice(0, 250); if (r.some(c => c)) diffs[k] = r.filter(Boolean).join(' | '); }); return; }
    const ri = hdr.findIndex(h => /결과|status/i.test(h));
    if (ri < 0) return;
    const ti = hdr.findIndex(h => /^TC$/i.test(h)); const pi = hdr.findIndex(h => /경로|path/i.test(h));
    rows.forEach(r => { if (/^FAIL$/i.test((r[ri] || '').trim())) { const k = `${ws.name}|${ti >= 0 ? r[ti] : ''}|${pi >= 0 ? r[pi] : ''}`; fails[k] = `${ws.name} · ${r.filter(Boolean).slice(0, 6).join(' | ')}`; } });
  });
  return { fails, diffs };
}

async function main() {
  const reps = latestReports(2);
  if (reps.length === 0) { console.error('❌ reports/전체테스트_report_*.xlsx 없음 — 먼저 npm run test:all'); process.exit(1); }
  if (reps.length === 1) { console.log(`ℹ️ 리포트 1개뿐(${path.basename(reps[0])}) — baseline. 다음 회차부터 비교됨.`); process.exit(0); }
  const [prev, cur] = reps;
  const a = await extract(prev), b = await extract(cur);
  const newFails = Object.keys(b.fails).filter(k => !(k in a.fails));
  const resolved = Object.keys(a.fails).filter(k => !(k in b.fails));
  const newDiffs = Object.keys(b.diffs).filter(k => !(k in a.diffs));

  console.log(`\n드리프트 비교: ${path.basename(prev)} → ${path.basename(cur)}`);
  console.log(`신규 FAIL ${newFails.length} · 해소 ${resolved.length} · 신규 기획-구현 차이 ${newDiffs.length}`);
  newFails.forEach(k => console.log(`  🔴 [신규FAIL] ${b.fails[k]}`));
  newDiffs.forEach(k => console.log(`  🟡 [신규차이] ${b.diffs[k]}`));
  resolved.forEach(k => console.log(`  🟢 [해소] ${a.fails[k]}`));

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const md = [
    `# 드리프트 비교 ${ts}`, ``, `- 이전: ${path.basename(prev)}`, `- 현재: ${path.basename(cur)}`, ``,
    `## 🔴 신규 FAIL (${newFails.length})`, ...(newFails.length ? newFails.map(k => `- ${b.fails[k]}`) : ['- 없음']), ``,
    `## 🟡 신규 기획-구현 차이 (${newDiffs.length})`, ...(newDiffs.length ? newDiffs.map(k => `- ${b.diffs[k]}`) : ['- 없음']), ``,
    `## 🟢 해소된 FAIL (${resolved.length})`, ...(resolved.length ? resolved.map(k => `- ${a.fails[k]}`) : ['- 없음']),
  ].join('\n');
  const outPath = path.join(REPORTS, `drift-diff_${ts}.md`);
  fs.writeFileSync(outPath, md);
  console.log(`[report] ${outPath}`);

  if (newFails.length) process.exit(2);  // CI/스케줄러 게이팅: 신규 회귀 시 비정상 종료
}

main().catch(e => { console.error('❌ 오류:', e?.message || e); process.exit(1); });
