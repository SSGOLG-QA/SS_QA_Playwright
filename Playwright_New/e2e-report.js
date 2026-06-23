// Playwright JSON 리포트 → 엑셀(E2E 결과 보고서) 변환
//   사용: node Playwright_New/e2e-report.js <results.json>
//   산출: reports/e2e_report_<timestamp>.xlsx
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'reports');

// spec 파일 → 대메뉴(IA 순서)
const MENU_MAP = {
  'round-mgmt':         '라운드 관리',
  'tablet-ops':         '태블릿 운영 관리',
  'holemap-mgmt':       '홀맵 관리',
  'course-ops':         '코스 운영 관리',
  'time-progress':      '경기 진행 관리',
  'caddie':             '캐디 관리',
  'beto':               '배토 관리',
  'customer-eval':      '고객 평가 관리',
  'account':            '계정 관리',
  'destructive-sample': '파괴 테스트(옵트인)',
};
const ORDER = Object.values(MENU_MAP);

const jsonPath = process.argv[2];
if (!jsonPath || !fs.existsSync(jsonPath)) { console.error('JSON 리포트 경로 필요:', jsonPath); process.exit(1); }
const report = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

// ── Playwright expect 에러에서 Expected / Received 추출 ──────────
function parseError(msg) {
  let expected, received;
  for (const line of (msg || '').split('\n')) {
    const tl = line.trim();
    if (!expected) { const m = tl.match(/^Expected(?:\s+string)?\s*:\s*(.+)$/); if (m) expected = m[1].replace(/^"|"$/g, '').trim().slice(0, 200); }
    if (!received) { const m = tl.match(/^Received(?:\s+string)?\s*:\s*(.+)$/); if (m) received = m[1].replace(/^"|"$/g, '').trim().slice(0, 200); }
  }
  return { expected, received };
}

// ── 재귀 수집 — parentTitle 로 describe 체인 추적 ───────────────
// r.title  = "describe › test" 전체 경로
// r.screen = 가장 가까운 describe 제목 (화면별 커버리지 grouping 키)
const rows = [];
function walk(suite, file, parentTitle) {
  const f = suite.file || file;
  // 파일 수준 suite(title = 경로·.ts 포함)는 제목에서 제외
  const isFileSuite = /[/\\]/.test(suite.title || '') || (suite.title || '').endsWith('.ts');
  const myTitle   = isFileSuite ? '' : (suite.title || '');
  const fullTitle = parentTitle && myTitle ? `${parentTitle} › ${myTitle}`
                  : (parentTitle || myTitle);

  for (const spec of suite.specs || []) {
    const test = (spec.tests || [])[0] || {};
    const res  = (test.results  || [])[0] || {};

    let status = res.status || (test.status === 'expected' ? 'passed' : test.status) || 'unknown';
    if (test.status === 'flaky') status = 'flaky';

    const anns  = [...(test.annotations || []), ...(spec.annotations || [])];
    const notes = anns.filter(a => a.type !== 'skip').map(a => `[${a.type}] ${a.description || ''}`.trim()).join(' / ');

    // 에러 파싱
    const errRaw       = (res.error?.message || '').replace(/\[[0-9;]*m/g, '');
    const errFirstLine = errRaw.split('\n')[0].trim().slice(0, 300);
    const { expected, received } = parseError(errRaw);

    // 스크린샷 첨부파일
    const shotAttach = (res.attachments || []).find(a => a.contentType === 'image/png' || a.name === 'screenshot');
    const shot = shotAttach?.path || '';

    rows.push({
      file:       (f || '').replace(/\\/g, '/').split('/').pop().replace('.e2e.spec.ts', ''),
      screen:     myTitle || parentTitle || '',
      title:      fullTitle ? `${fullTitle} › ${spec.title}` : spec.title,
      status,
      retries:    Math.max(0, (test.results || []).length - 1),
      durationMs: res.duration || 0,
      notes,
      error:      errFirstLine,
      expected,
      received,
      shot,
    });
  }
  for (const child of suite.suites || []) walk(child, f, fullTitle);
}
for (const s of report.suites || []) walk(s, s.file, '');

// ── 대메뉴 그룹핑 ────────────────────────────────────────────────
const STATUS_KO = { passed: 'PASS', failed: 'FAIL', timedOut: 'FAIL', skipped: 'SKIP', flaky: 'FLAKY(재시도 통과)', interrupted: 'FAIL' };
const COLOR     = { PASS: 'FF008000', FAIL: 'FFCC0000', SKIP: 'FF888888', 'FLAKY(재시도 통과)': 'FFB8860B' };
const FAIL_BG   = 'FFFFF0F0';  // 연한 분홍 — FAIL 행 배경

const groups = new Map();
for (const r of rows) {
  const menu = MENU_MAP[r.file] || r.file;
  if (!groups.has(menu)) groups.set(menu, []);
  groups.get(menu).push(r);
}
const menus = [...groups.keys()].sort((a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b, 'ko');
});

(async () => {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  const wb = new ExcelJS.Workbook();
  const HEAD = (ws, to, fg = 'FF2F3B52') => {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to };
  };

  // ── 요약 ─────────────────────────────────────────────────────
  const sum = wb.addWorksheet('요약');
  sum.columns = [
    { header: '대메뉴(E2E 스펙)', key: 'menu',  width: 24 },
    { header: '항목수',           key: 'total', width: 8  },
    { header: 'PASS',             key: 'pass',  width: 8  },
    { header: 'FAIL',             key: 'fail',  width: 8  },
    { header: 'SKIP',             key: 'skip',  width: 8  },
    { header: 'FLAKY',            key: 'flaky', width: 8  },
    { header: 'PASS율',           key: 'rate',  width: 10 },
  ];
  HEAD(sum, 'G1');
  let TP = 0, TF = 0, TS = 0, TK = 0, TT = 0;
  for (const m of menus) {
    const g = groups.get(m);
    const c = s => g.filter(r => (STATUS_KO[r.status] || r.status) === s).length;
    const p = c('PASS'), f = c('FAIL'), sk = c('SKIP'), fk = c('FLAKY(재시도 통과)');
    TP += p; TF += f; TS += sk; TK += fk; TT += g.length;
    const row = sum.addRow({ menu: m, total: g.length, pass: p, fail: f, skip: sk, flaky: fk, rate: (p + f) ? `${Math.round(p / (p + f) * 100)}%` : '-' });
    if (f > 0) row.getCell('fail').font = { bold: true, color: { argb: 'FFCC0000' } };
  }
  const tr = sum.addRow({ menu: 'TOTAL', total: TT, pass: TP, fail: TF, skip: TS, flaky: TK, rate: (TP + TF) ? `${Math.round(TP / (TP + TF) * 100)}%` : '-' });
  tr.font = { bold: true };
  sum.addRow({});
  sum.addRow({ menu: '검증 방식', total: '현재 구현(AS-IS) 기준 POM E2E 8항목' });
  sum.addRow({ menu: '8항목',     total: '①진입 ②텍스트(미가공코드) ③이동·세션 ④정합성 ⑤페이지네이션 ⑥달력/검색 ⑦입력/반영 ⑧팝업/모달' });
  sum.addRow({ menu: '원칙',      total: '비파괴(저장/삭제/적용 미클릭) · 달력 베스트에포트 · 데이터 의존 주석' });
  sum.addRow({ menu: '대상',      total: 'td17.smartscore.kr 경기관제 어드민(킹즈락) · /club/page/*' });
  sum.addRow({ menu: '생성시각',  total: new Date().toLocaleString('ko-KR') });

  // ── 화면별 커버리지 (describe 단위 집계) ─────────────────────
  {
    const screenMap = new Map();
    for (const r of rows) {
      const menu   = MENU_MAP[r.file] || r.file;
      const screen = r.screen || '(기타)';
      const key    = `${menu}\x00${screen}`;
      if (!screenMap.has(key)) screenMap.set(key, { menu, screen, pass: 0, fail: 0, skip: 0, items: [] });
      const sc = screenMap.get(key);
      const st = STATUS_KO[r.status] || r.status;
      if      (st === 'PASS') sc.pass++;
      else if (st === 'FAIL') sc.fail++;
      else                    sc.skip++;
      // 개별 test 이름만 추출 (전체 경로에서 마지막 › 이후)
      const testName = r.title.includes(' › ') ? r.title.split(' › ').pop() : r.title;
      sc.items.push(testName);
    }
    if (screenMap.size > 0) {
      const cv = wb.addWorksheet('화면별 커버리지');
      cv.columns = [
        { header: '대메뉴',            key: 'menu',   width: 20 },
        { header: '화면(describe)',     key: 'screen', width: 30 },
        { header: '전체',              key: 'total',  width: 7  },
        { header: 'PASS',              key: 'pass',   width: 7  },
        { header: 'FAIL',              key: 'fail',   width: 7  },
        { header: 'SKIP',              key: 'skip',   width: 7  },
        { header: 'PASS율',            key: 'rate',   width: 9  },
        { header: '테스트 항목 목록',   key: 'items',  width: 80 },
      ];
      HEAD(cv, 'H1', 'FF2F6FB5');
      const entries = [...screenMap.entries()].sort((a, b) => {
        const ia = ORDER.indexOf(a[1].menu), ib = ORDER.indexOf(b[1].menu);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a[0].localeCompare(b[0], 'ko');
      });
      for (const [, sc] of entries) {
        const total    = sc.pass + sc.fail + sc.skip;
        const executed = sc.pass + sc.fail;
        const rate     = executed ? `${Math.round(sc.pass / executed * 100)}%` : '-';
        const row = cv.addRow({ menu: sc.menu, screen: sc.screen, total, pass: sc.pass, fail: sc.fail, skip: sc.skip, rate, items: sc.items.join(' / ') });
        row.alignment = { vertical: 'top', wrapText: true };
        if (sc.fail > 0) {
          for (let c = 1; c <= 8; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FAIL_BG } };
          row.getCell('fail').font = { bold: true, color: { argb: 'FFCC0000' } };
        }
        const rateColor = !executed ? 'FF888888' : sc.fail > 0 ? 'FFCC0000' : 'FF008000';
        row.getCell('rate').font = { color: { argb: rateColor } };
      }
      console.log(`  화면별 커버리지: ${screenMap.size}개 화면`);
    }
  }

  // ── 대메뉴별 상세 ─────────────────────────────────────────────
  const sheetSafe = s => (s || 'etc').replace(/[\\/?*[\]:]/g, '_').slice(0, 31);
  for (const m of menus) {
    const ws = wb.addWorksheet(sheetSafe(m));
    ws.columns = [
      { header: '테스트 절차',   key: 'title',    width: 54 },
      { header: '기대결과',      key: 'expected', width: 28 },
      { header: '실제결과',      key: 'received', width: 28 },
      { header: '결과',          key: 'st',       width: 16 },
      { header: '소요(s)',       key: 'dur',      width: 8  },
      { header: '재시도',        key: 'retries',  width: 7  },
      { header: '주의/한계',     key: 'notes',    width: 55 },
      { header: '실패 사유',     key: 'error',    width: 45 },
      { header: '스크린샷',      key: 'shot',     width: 34 },
      { header: 'E2E 스펙',      key: 'file',     width: 18 },
    ];
    HEAD(ws, 'J1');
    for (const r of groups.get(m)) {
      const st  = STATUS_KO[r.status] || r.status;
      const row = ws.addRow({
        title:    r.title,
        expected: r.expected || '',
        received: r.received || '',
        st,
        dur:      (r.durationMs / 1000).toFixed(1),
        retries:  r.retries,
        notes:    r.notes,
        error:    r.error,
        shot:     '',  // 하이퍼링크로 덮어씀
        file:     `${r.file}.e2e.spec.ts`,
      });
      row.alignment = { vertical: 'top', wrapText: true };
      // FAIL 행 전체 연한 분홍 배경
      if (st === 'FAIL') {
        for (let c = 1; c <= 10; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FAIL_BG } };
      }
      row.getCell('st').font = { bold: true, color: { argb: COLOR[st] || 'FF000000' } };
      // 스크린샷 하이퍼링크
      if (r.shot) {
        const shotCell = row.getCell('shot');
        const fileUrl  = 'file:///' + r.shot.replace(/\\/g, '/');
        shotCell.value = { text: path.basename(r.shot), hyperlink: fileUrl };
        shotCell.font  = { color: { argb: 'FF0563C1' }, underline: true };
      }
    }
  }

  // ── 주석(주의/한계) 집계 ─────────────────────────────────────
  const annRows = rows.filter(r => r.notes);
  if (annRows.length) {
    const an = wb.addWorksheet('주석(주의·한계)');
    an.columns = [
      { header: '대메뉴', key: 'menu',  width: 22 },
      { header: '항목',   key: 'title', width: 50 },
      { header: '주석',   key: 'notes', width: 80 },
    ];
    HEAD(an, 'C1', 'FFCC6600');
    for (const m of menus) for (const r of groups.get(m)) if (r.notes) {
      const row = an.addRow({ menu: m, title: r.title, notes: r.notes });
      row.alignment = { vertical: 'top', wrapText: true };
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out   = path.join(REPORT_DIR, `e2e_report_${stamp}.xlsx`);
  await wb.xlsx.writeFile(out);
  console.log(`\n[E2E report] 엑셀 생성: ${out}`);
  console.log(`  대메뉴 ${menus.length} / 항목 ${TT} / PASS ${TP} / FAIL ${TF} / SKIP ${TS} / FLAKY ${TK}\n`);
})();
