/**
 * 단언 민감도 정적 감사 (Assertion Sensitivity Audit)
 *
 *  배경: DOM 결함 주입 PoC(Admin/assertion-sensitivity.spec.ts)가 단언 *클래스별* 민감도를
 *        결정적으로 입증함 —
 *          · checkText/exact(전문·정확 일치) = 민감(결함 주입 시 FAIL로 검출)
 *          · toContainText/.includes(부분 일치) = 둔감(매칭 구간 밖 변경 미검출)
 *          · toBeGreaterThanOrEqual(느슨한 count) = 둔감(다수 요소 소실 미검출)
 *
 *  이 스크립트: 그 검증된 규칙을 lib/suites.ts + Admin/*.spec.ts 의 *모든* 단언에 적용해
 *        "둔감 단언 목록"(파일:라인 · TC ID · 화면 · 사유 · 강화 권고)을 산출한다.
 *        세션·브라우저 불필요(정적). 라이브 PoC = 규칙 입증, 본 감사 = 규칙의 전수 적용.
 *
 *  실행: npx tsc --project tsconfig.json && node dist/scripts/assertionAudit.js
 *        (또는 npm run audit:assert)
 *  산출: 콘솔 요약 + reports/단언감사_<ts>.xlsx (요약 / 둔감 단언 목록 / 전체 인벤토리)
 */
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

// 감사 대상 소스 (검증 로직이 사는 곳)
function targetFiles(): string[] {
  const files: string[] = [];
  if (fs.existsSync('lib/suites.ts')) files.push('lib/suites.ts');
  const adminDir = 'Admin';
  if (fs.existsSync(adminDir)) {
    for (const f of fs.readdirSync(adminDir)) {
      if (/\.spec\.ts$/.test(f) && !/assertion-sensitivity/.test(f)) files.push(path.join(adminDir, f));
    }
  }
  return files;
}

// 호출식의 여는 '(' 위치에서 균형 맞는 ')' 까지 substring 반환(문자열/주석 내 괄호 무시).
function balanced(src: string, openIdx: number): { block: string; end: number } {
  let depth = 0, i = openIdx;
  let inStr: string | null = null, prev = '';
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === inStr && prev !== '\\') inStr = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
    } else if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) { i++; break; } }
    prev = ch;
  }
  return { block: src.slice(openIdx, i), end: i };
}

const lineOf = (src: string, idx: number) => src.slice(0, idx).split('\n').length;
const grab = (block: string, key: string) => {
  const m = block.match(new RegExp(`${key}\\s*:\\s*(['\`])([\\s\\S]*?)\\1`));
  return m ? m[2].replace(/\s+/g, ' ').trim() : '';
};

type Entry = {
  file: string; line: number; fn: string;
  tcId: string; pathStr: string; desc: string;
  cls: '민감' | '둔감' | '정합성(조건부)' | '존재(보통)';
  reasons: string[]; advice: string; snippet: string;
};

// 단언 호출 1건 분류
function classify(fn: string, block: string): { cls: Entry['cls']; reasons: string[]; advice: string } {
  // 약한 패턴
  const hasPartial = /\.toContainText\s*\(|\.includes\s*\(|\.toContain\s*\(/.test(block);
  const hasLoose = /toBeGreaterThanOrEqual\s*\(/.test(block);
  // 강한 패턴
  const hasExact = fn === 'checkText' || /\.toBe\s*\(|\.toEqual\s*\(|\.toHaveText\s*\(|\.toHaveValue\s*\(/.test(block);
  const onlyExists = /\.toBeVisible\s*\(|\.toBeHidden\s*\(|\.toBeAttached\s*\(/.test(block);

  if (fn === 'checkRowCountVsTotal')
    return { cls: '정합성(조건부)', reasons: ['렌더 행 ≤ 총건수만 검증 — 페이지크기<총건수면 정확검증 안 됨'], advice: '페이지네이션 고려한 정확 비교 또는 총건수=DB실측 대조' };

  const reasons: string[] = [];
  if (hasPartial) reasons.push('부분 일치(toContainText/includes) — 매칭 구간 밖 변경 미검출');
  if (hasLoose) reasons.push('느슨한 count ≥N — 다수 요소 소실 미검출');

  if (reasons.length) {
    const advice = [
      hasPartial ? '안내문구는 전문 일치(checkText+expected 전문), 컬럼/텍스트는 정확 비교로 승격' : '',
      hasLoose ? '실측 기대값으로 정확 비교(count===N) 또는 핵심 요소 개별 존재 단언' : '',
    ].filter(Boolean).join(' / ');
    return { cls: '둔감', reasons, advice };
  }
  if (hasExact) return { cls: '민감', reasons: ['전문/정확 일치 — 결함 주입 시 검출(PoC 입증)'], advice: '-' };
  if (onlyExists) return { cls: '존재(보통)', reasons: ['존재(visible)만 검증 — 내용/개수 변형은 미검출'], advice: '핵심 요소면 내용·개수 단언 추가 검토' };
  return { cls: '존재(보통)', reasons: ['분류 외 패턴'], advice: '수동 확인' };
}

// 함수별 const P/R 선언 수집 → ${P}/${R} 템플릿 변수를 가장 가까운 선행 선언으로 해석.
function collectVars(src: string, name: string): { idx: number; val: string }[] {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*'([^']*)'`, 'g');
  const out: { idx: number; val: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ idx: m.index, val: m[1] });
  return out;
}
const nearest = (decls: { idx: number; val: string }[], at: number) => {
  let v = ''; for (const d of decls) { if (d.idx < at) v = d.val; else break; } return v;
};

function scan(): Entry[] {
  const entries: Entry[] = [];
  const FN_RE = /\b(checkText|checkRowCountVsTotal|check)\s*\(/g;
  for (const file of targetFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const pDecls = collectVars(src, 'P'), rDecls = collectVars(src, 'R');
    let m: RegExpExecArray | null;
    while ((m = FN_RE.exec(src))) {
      const fn = m[1];
      const openIdx = m.index + m[0].length - 1;          // 여는 '(' 위치
      const { block, end } = balanced(src, openIdx);
      FN_RE.lastIndex = end;                               // 블록 건너뛰기(중첩 재매칭 방지)
      // ${P}/${R} 해석(가장 가까운 선행 선언)
      const resolve = (s: string) => s.replace(/\$\{P\}/g, nearest(pDecls, m!.index)).replace(/\$\{R\}/g, nearest(rDecls, m!.index));
      // checkRawCode 내부의 check 래핑 등은 그대로 분류(자체 호출 기준)
      const tcId = resolve(grab(block, 'tcId'));
      const pathStr = resolve(grab(block, 'path'));
      const desc = resolve(grab(block, 'desc'));
      const { cls, reasons, advice } = classify(fn, block);
      entries.push({
        file, line: lineOf(src, m.index), fn, tcId, pathStr, desc, cls, reasons, advice,
        snippet: block.replace(/\s+/g, ' ').trim().slice(0, 180),
      });
    }
  }
  return entries;
}

const topMenu = (p: string) => (p || '').split('>')[0].trim() || '(기타)';

async function main() {
  const all = scan();
  const weak = all.filter(e => e.cls === '둔감');
  const byCls = (c: string) => all.filter(e => e.cls === c).length;

  console.log(`\n[단언 감사] 전체 ${all.length}건 단언`);
  console.log(`  민감 ${byCls('민감')} / 둔감 ${weak.length} / 정합성(조건부) ${byCls('정합성(조건부)')} / 존재(보통) ${byCls('존재(보통)')}`);
  // 화면(대메뉴)별 둔감 분포
  const byMenu = new Map<string, number>();
  for (const e of weak) { const k = topMenu(e.pathStr); byMenu.set(k, (byMenu.get(k) || 0) + 1); }
  [...byMenu.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`    🔴 ${k}: 둔감 ${n}`));

  if (!fs.existsSync('reports')) fs.mkdirSync('reports', { recursive: true });
  const wb = new ExcelJS.Workbook();
  const HEAD = (ws: ExcelJS.Worksheet, argb: string) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };

  // 요약
  const sum = wb.addWorksheet('요약');
  sum.columns = [{ header: '항목', key: 'k', width: 28 }, { header: '값', key: 'v', width: 16 }];
  HEAD(sum, 'FF2F3B52');
  sum.addRows([
    { k: '감사 대상 파일', v: targetFiles().length },
    { k: '전체 단언', v: all.length },
    { k: '🔴 둔감(강화 권고)', v: weak.length },
    { k: '  ├ 부분 일치', v: weak.filter(e => e.reasons.some(r => /부분/.test(r))).length },
    { k: '  └ 느슨한 count', v: weak.filter(e => e.reasons.some(r => /count/.test(r))).length },
    { k: '민감(강건)', v: byCls('민감') },
    { k: '정합성(조건부)', v: byCls('정합성(조건부)') },
    { k: '존재(보통)', v: byCls('존재(보통)') },
    { k: '생성시각', v: new Date().toLocaleString('ko-KR') },
  ]);
  sum.getColumn(1).eachCell((c, r) => { if (r > 1 && /둔감/.test(String(c.value))) c.font = { bold: true, color: { argb: 'FFCC0000' } }; });

  // 둔감 단언 목록
  const ws = wb.addWorksheet('둔감 단언 목록');
  ws.columns = [
    { header: '대메뉴', key: 'menu', width: 16 },
    { header: '파일', key: 'file', width: 22 },
    { header: '라인', key: 'line', width: 7 },
    { header: 'TC', key: 'tcId', width: 12 },
    { header: '경로', key: 'pathStr', width: 40 },
    { header: '함수', key: 'fn', width: 10 },
    { header: '사유', key: 'reason', width: 48 },
    { header: '강화 권고', key: 'advice', width: 46 },
    { header: '코드', key: 'snippet', width: 70 },
  ];
  HEAD(ws, 'FFCC0000');
  for (const e of weak) {
    const row = ws.addRow({ menu: topMenu(e.pathStr), file: e.file, line: e.line, tcId: e.tcId, pathStr: e.pathStr, fn: e.fn, reason: e.reasons.join(' · '), advice: e.advice, snippet: e.snippet });
    row.alignment = { vertical: 'top', wrapText: true };
  }
  ws.autoFilter = { from: 'A1', to: 'I1' };

  // 전체 인벤토리
  const inv = wb.addWorksheet('전체 인벤토리');
  inv.columns = [
    { header: '대메뉴', key: 'menu', width: 16 },
    { header: '파일', key: 'file', width: 22 },
    { header: '라인', key: 'line', width: 7 },
    { header: 'TC', key: 'tcId', width: 12 },
    { header: '경로', key: 'pathStr', width: 40 },
    { header: '함수', key: 'fn', width: 10 },
    { header: '분류', key: 'cls', width: 14 },
    { header: '사유', key: 'reason', width: 48 },
    { header: '코드', key: 'snippet', width: 70 },
  ];
  HEAD(inv, 'FF2F6FB5');
  const CLSC: Record<string, string> = { '민감': 'FF008000', '둔감': 'FFCC0000', '정합성(조건부)': 'FFCC6600', '존재(보통)': 'FF888888' };
  for (const e of all.sort((a, b) => topMenu(a.pathStr).localeCompare(topMenu(b.pathStr), 'ko') || a.line - b.line)) {
    const row = inv.addRow({ menu: topMenu(e.pathStr), file: e.file, line: e.line, tcId: e.tcId, pathStr: e.pathStr, fn: e.fn, cls: e.cls, reason: e.reasons.join(' · '), snippet: e.snippet });
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell('cls').font = { bold: true, color: { argb: CLSC[e.cls] || 'FF000000' } };
  }
  inv.autoFilter = { from: 'A1', to: 'I1' };

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const out = path.join('reports', `단언감사_${ts}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`\n[report] ${out}\n`);
}

main().catch(e => { console.error('❌ 오류:', e?.message || e); process.exit(1); });
