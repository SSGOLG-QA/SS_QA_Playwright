/* eslint-disable */
// ──────────────────────────────────────────────────────────────
//  코스관리 세부 커버리지 트리(HTML) 생성기 — Phase A.
//  입력: baselines/course-components.<sub>.json (분모=구성요소 인벤토리)
//        baselines/course-coverage-manifest.json (분자=설계 매핑, level/tcId)
//        reports/코스관리_전체테스트_report_*.xlsx (최신 — 실제 실행 커버리지 union)
//  산출: reports/course-coverage-tree_<ts>.html (대메뉴>소메뉴>kind>구성요소 × 커버여부 × 4카테고리)
//  실행: npm run course:coverage-tree
//  ⚠ 매칭은 휴리스틱(label 정규화 포함 + kind별 규칙) — 각 커버 항목에 매칭 근거 표기(투명성).
// ──────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const SUB = process.env.COURSE_SUBDOMAIN || 'course-mng-td';
const ROOT = process.cwd();
const invPath = path.join(ROOT, 'baselines', `course-components.${SUB}.json`);
const auditPath = path.join(ROOT, 'baselines', `course-components-audit.${SUB}.json`);
const transPath = path.join(ROOT, 'baselines', `course-transitions.${SUB}.json`);
const manPath = path.join(ROOT, 'baselines', 'course-coverage-manifest.json');

const norm = (s) => (s || '').replace(/\s+/g, '').trim();
const load = (p, f) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return f; } };

// 4개 테스트 분류 (tcId/경로 기반 휴리스틱)
function categoryOf(tcId, pathTail) {
  const t = (tcId || '') + ' ' + (pathTail || '');
  if (/E2E|EDIT|REG|FILL|CLEAR|-ADD|DELITEM|TRASH|DATEPICK|RADIO|-FORM|SAVE|WRITE|CRUD|WP-|등록|수정|입력|항목|클리어/.test(t)) return '등록수정';
  if (/CALC|INVAR|VERIFY|CROSS|SUBTOTAL|CCOST|불변|정합|합계|평균|차액|계산/.test(t)) return '숫자계산';
  if (/CMON|MON-|GRN|GREEN|SPECTRAL|3D|VEG|VISUAL|MONTAB|DRONE|ZONE|DRAW|MAP|지도|시각|모니터|식생|드론|영역/.test(t)) return '지도시각화';
  return '화면기본';
}
const CATS = ['화면기본', '등록수정', '숫자계산', '지도시각화'];

// 컴포넌트 예상 테스트 카테고리(kind·라벨·메뉴 기반) — 커버 여부와 무관하게 전 컴포넌트에 부여(분모 정밀화).
//   우선순위: 시각화 kind → 폼 컨트롤 → 숫자/계산 도메인 → 화면 기본(기본값).
function expectedCat(kind, label, screen) {
  const menu = (screen || '').split(' > ')[0];
  // 지도/시각화 화면 = 코스 현황 관리 메뉴 전체(지도·차트·시각 컨트롤). (일정 달력·타 메뉴 차트는 제외)
  if (menu === '코스 현황 관리') return '지도시각화';
  // 폼 컨트롤·CRUD 버튼 = 등록/수정 실조작 (타 메뉴 공통).
  if (/^(input|datepicker|toggle|dropdown)$/.test(kind)) return '등록수정';
  if (kind === 'button' && /등록|수정|삭제|저장|추가|업로드|적용|변경|설정|편집|초기화/.test(label || '')) return '등록수정';
  // 예산/비용 도메인 = 숫자·계산 검증(테이블·컬럼·차트·수치·문구).
  if (menu === '예산 관리' || menu === '비용 관리') return '숫자계산';
  // 그 외 메뉴의 차트/이미지 = 시각 요소로 지도시각화, 나머지는 화면기본.
  if (/^(chart|image)$/.test(kind)) return '지도시각화';
  return '화면기본';   // 제목·문구·탭·nav·컬럼·테이블(일반)·조회버튼·일정달력 등
}

// 실제 메뉴 순서(COURSE_IA 기준) — 트리 정렬용. "대메뉴 > 소메뉴"(Home은 'Home').
const IA_ORDER = [
  'Home',
  '코스 현황 관리 > 코스 모니터', '코스 현황 관리 > 식생 분석', '코스 현황 관리 > 코스 영역 설정', '코스 현황 관리 > 드론사진 업로드', '코스 현황 관리 > 3D', '코스 현황 관리 > 그린 분석',
  '정보 관리 > 코스 기본 정보', '정보 관리 > 코스 리뉴얼 정보', '정보 관리 > 홀 별 정보', '정보 관리 > 잔디 측정 정보', '정보 관리 > 토양 측정 정보', '정보 관리 > 발병 정보', '정보 관리 > 코스 운영 정보', '정보 관리 > 기상 정보', '정보 관리 > 거래처 정보', '정보 관리 > 관리 기준 정보', '정보 관리 > 일상 점검',
  '사진 관리 > 정보별 사진', '사진 관리 > 위치별 사진',
  '작업 관리 > 작업 지시', '작업 관리 > 작업 계획', '작업 관리 > 이슈 관리', '작업 관리 > 예측 정보', '작업 관리 > 작업 일보',
  '예산 관리 > 예산 총괄', '예산 관리 > 예산 상세', '예산 관리 > 실적 관리', '예산 관리 > 예산 분석',
  '비용 관리 > 비용 집계', '비용 관리 > 작업별 비용', '비용 관리 > 분류별 비용', '비용 관리 > 위치별 비용', '비용 관리 > 기간별 비용',
  '인력 관리 > 권한관리', '인력 관리 > 인력 관리', '인력 관리 > 근태 관리', '인력 관리 > 투입 관리',
  '장비 관리 > 장비 총괄', '장비 관리 > 장비 관제',
  '자재 관리 > 자재 총괄', '자재 관리 > 자재 수불(품목별)', '자재 관리 > 자재 수불(일자별)',
  '시설 관리 > 시설 총괄', '시설 관리 > 시설 관제',
];
const MENU_ORDER = ['Home', '코스 현황 관리', '정보 관리', '사진 관리', '작업 관리', '예산 관리', '비용 관리', '인력 관리', '장비 관리', '자재 관리', '시설 관리'];
const iaIdx = (s) => { const i = IA_ORDER.indexOf(s); return i < 0 ? 999 : i; };

// 미커버 사유 추론: SKIP 매칭 > 파괴적 > 프레임워크 > 케이스 없음.
const DESTRUCTIVE = /저장|삭제|변경|사용\s*중지|관제\s*적용|적용$|초기화\s*저장|재개|승인|반려|발행|전송|보내기/;
const FRAMEWORK = /닫기|이전|다음|페이지|더보기|접기|펼치기|×|✕|취소|확인$/;
function uncoveredReason(comp, skipRows) {
  const nl = norm(comp.label);
  const sk = skipRows.find((s) => nl && norm(s.tail).includes(nl) && nl.length >= 2);
  if (sk && sk.reason) return { r: sk.reason.slice(0, 60), k: 'SKIP' };
  if (comp.kind === 'button' && DESTRUCTIVE.test(comp.label)) return { r: '파괴적 동작 — 비파괴 정책상 미클릭', k: '파괴' };
  if (comp.kind === 'button' && FRAMEWORK.test(comp.label)) return { r: '프레임워크 요소(검증 비대상)', k: '프레임' };
  if (comp.kind === 'toggle') return { r: '토글 — 상태변경(비파괴)·개별 케이스 필요', k: '갭' };
  if (comp.kind === 'text') return { r: '안내문구 — checkText 매핑 필요', k: '갭' };
  if (comp.kind === 'chart') return { r: '차트/그래프 — 렌더 존재·데이터 검증 필요(시각회귀 대상)', k: '갭' };
  return { r: '검증 케이스 없음(배터리 미포함)', k: '갭' };
}
const KIND_LABEL = { title: '제목', section: '카드/섹션', text: '안내문구/라벨', button: '버튼', nav: '이동(화살표)', input: '입력/placeholder', dropdown: '드롭리스트', datepicker: '날짜(datepicker)', tab: '탭', chart: '차트/그래프', calendar: '달력', table: '테이블', column: '컬럼', image: '이미지', toggle: '토글', zoom: '지도줌' };
const KIND_ORDER = ['title', 'section', 'text', 'button', 'nav', 'input', 'dropdown', 'datepicker', 'tab', 'chart', 'calendar', 'table', 'column', 'image', 'toggle', 'zoom'];

// 컴포넌트 커버 판정(라벨 경로 포함 매칭 ∪ kind 매칭) — 전환 대상 구성요소에도 재사용.
function compCovered(kind, label, checks) {
  const nl = (label || '').replace(/\s+/g, '').trim();
  if (checks.some((ck) => ck.result === 'PASS' && nl && (ck.tail || '').replace(/\s+/g, '').includes(nl) && nl.length >= 2)) return true;
  return kindMatch(kind, checks);
}
// kind별 커버리지 매칭 규칙(리포트 경로/ tcId 기반) — label 미출현 요소(datepicker 등) 보완.
function kindMatch(kind, screenChecks) {
  const anyPass = (re) => screenChecks.some((c) => c.result === 'PASS' && (re.test(c.tail) || re.test(c.tcId)));
  switch (kind) {
    case 'datepicker': return anyPass(/datepicker|날짜|기간|DATE|PRESET|달력/i);
    case 'tab': return anyPass(/탭|TAB/i);
    case 'dropdown': return anyPass(/필터|드롭|FILTER|SELECT/i);
    case 'input': return anyPass(/입력|검색|FILL|SEARCH|클리어|CLEAR/i);
    case 'toggle': return anyPass(/토글|TOGGLE|스위치|SWITCH/i);
    case 'zoom': return anyPass(/지도|MAP|zoom|MON/i);
    // 테이블 위젯: 화면에 테이블 존재검증(표시보강 'table:테이블') 또는 컬럼 검증 PASS가 있으면 위젯 커버로 인정.
    //   (Task1) 라벨이 인접버튼으로 오캡처된 table 컴포넌트도 위젯 단위로 크레딧.
    case 'table': return anyPass(/테이블|\btable\b|thead|list-table|컬럼|COLUMN/i);
    // 차트: course:chart-integrity가 해당 화면 차트 데이터를 검증(등급스케일·점수→등급·추세·목표=카드, CHART-C1~C5) PASS 시 크레딧.
    //   chart-integrity는 Home 등급추세 전용 → 타 화면 차트엔 chart PASS 없어 과크레딧 없음(2026-09-07).
    case 'chart': return anyPass(/CHART-C|등급\s*스케일|점수.{0,2}등급|추세|차트\s*정합/i);
    // 달력/이미지/이동(nav)은 느슨한 kind추정으로 오검(가짜 커버) 위험 → 배터리(course-control-battery)의
    //   실제 존재/왕복 검증 PASS를 라벨 매칭(repHit)으로만 크레딧(여기서 매칭하지 않음).
    default: return false;
  }
}

// ★ 전 코스관리 리포트(코스관리_*_report_*.xlsx)를 스위트 prefix별 최신 1개씩 로드·병합 →
//   기존 자동화(비용관리·예산·monitor·green·vegetation·calc·심화E2E·쓰기경로 등) 검증을 컴포넌트에 전수 크레딧.
//   "동일 커버리지 체계 적용" = 모든 자동화 결과가 커버리지 트리에 반영됨.
async function loadLatestReportChecks(invScreens) {
  const dir = path.join(ROOT, 'reports');
  const all = fs.readdirSync(dir).filter((f) => /^코스관리_.*_report_.*\.xlsx$/.test(f) && !/^~\$/.test(f));
  const byPrefix = {};
  for (const f of all) {
    const pref = f.replace(/_report_.*$/, '');
    const m = fs.statSync(path.join(dir, f)).mtimeMs;
    if (!byPrefix[pref] || m > byPrefix[pref].m) byPrefix[pref] = { f, m };
  }
  const byScreen = {}; const usedFiles = [];
  for (const pref of Object.keys(byPrefix)) {
    usedFiles.push(byPrefix[pref].f);
    try { await parseReport(path.join(dir, byPrefix[pref].f), byScreen, invScreens); } catch { /* skip locked/bad */ }
  }
  return { byScreen, file: `${usedFiles.length}개 리포트 병합` };
}

// 리포트 경로 → 인벤토리 화면키 매핑. 인벤토리 키(단일세그 'Home' 및 'A > B')를 길이 내림차순 prefix 매칭.
//   ⚠ 기존 regex(`A > B`)는 단일세그 화면('Home')을 크레딧 못 함(m[1]/m[2] 강제 2세그) → Home 리포트 전량 미반영이었음.
//   인벤토리 키 기준 prefix 매칭으로 Home 포함 전 화면이 정확히 크레딧됨(tail = 화면키 이후 나머지).
function screenTailOf(pth, invScreens) {
  for (const s of invScreens) {   // 호출부에서 길이 내림차순 정렬 전달
    if (pth === s) return { screen: s, tail: '' };
    if (pth.startsWith(s + ' > ')) return { screen: s, tail: pth.slice(s.length + 3) };
  }
  // 인벤토리에 없는 화면 — 기존 방식(2세그) 폴백(매칭엔 안 걸리지만 파싱 유지)
  const m = pth.match(/^(.+?) > (.+?)(?: > (.*))?$/);
  if (!m) return null;
  return { screen: `${m[1]} > ${m[2]}`, tail: m[3] || '' };
}

async function parseReport(fp, byScreen, invScreens) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(fp);
  wb.eachSheet((ws) => {
    if (/미작성|커버리지|요약|이슈 현황|차이/.test(ws.name)) return;
    let hdr = null, ci = null, pi = null, ti = null, xi = null;
    ws.eachRow((r, i) => { r.values.forEach((v, j) => { const t = (v && v.text) ? v.text : v; if (t === '결과') { hdr = i; ci = j; } if (t === '경로') pi = j; if (t === 'TC') ti = j; if (t === '현상') xi = j; }); });
    if (!hdr) return;
    ws.eachRow((r, i) => {
      if (i <= hdr) return;
      const res = (r.values[ci] && r.values[ci].text) ? r.values[ci].text : r.values[ci];
      const pth = String((r.values[pi] && r.values[pi].text) ? r.values[pi].text : r.values[pi] || '');
      const tc = String((r.values[ti] && r.values[ti].text) ? r.values[ti].text : r.values[ti] || '');
      const reason = String((xi && r.values[xi] && r.values[xi].text) ? r.values[xi].text : (xi ? r.values[xi] : '') || '').replace(/\s+/g, ' ').trim();
      const st = screenTailOf(pth, invScreens);
      if (!st) return;
      (byScreen[st.screen] = byScreen[st.screen] || []).push({ tail: st.tail, tcId: tc, result: res, reason });
    });
  });
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const NOTES_XLSX = path.join(ROOT, 'reports', 'course-coverage-notes.xlsx');
// base(tab 없음)는 기존 id 포맷 유지(의견 보존). 탭 콘텐츠만 [tab] 프리픽스 추가.
const idOf = (scr, kind, label, tab) => tab ? `${scr}∷[${tab}]∷${kind}∷${label}` : `${scr}∷${kind}∷${label}`;

// 기존 의견 xlsx에서 사용자 의견을 ID로 읽어옴(round-trip: 재생성해도 의견 유지). 없으면 {}.
async function loadPrevNotes() {
  if (!fs.existsSync(NOTES_XLSX)) return {};
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(NOTES_XLSX);
    const ws = wb.getWorksheet('커버리지') || wb.worksheets[0];
    if (!ws) return {};
    let hdr = null, idc = null, opc = null;
    ws.eachRow((r, i) => { r.values.forEach((v, j) => { const t = (v && v.text) ? v.text : v; if (t === 'ID') { hdr = i; idc = j; } if (t === '의견') opc = j; }); });
    if (!hdr || !idc || !opc) return {};
    const map = {};
    ws.eachRow((r, i) => { if (i <= hdr) return; const id = String((r.values[idc] && r.values[idc].text) ? r.values[idc].text : r.values[idc] || ''); const op = String((r.values[opc] && r.values[opc].text) ? r.values[opc].text : r.values[opc] || '').trim(); if (id && op) map[id] = op; });
    return map;
  } catch { return {}; }
}

// 의견 포함 xlsx 작성(캐노니컬 course-coverage-notes.xlsx). 의견 컬럼만 사용자 편집 → 다음 생성 시 머지.
async function writeNotesXlsx(tree, prevNotes) {
  const wb = new ExcelJS.Workbook();

  // ── 요약 시트(메뉴별 컴포넌트/커버/미커버) ── (첫 시트)
  const sm = wb.addWorksheet('요약', { views: [{ state: 'frozen', ySplit: 1 }] });
  sm.columns = [
    { header: '대메뉴', key: 'g', width: 16 }, { header: '소메뉴', key: 's', width: 22 },
    { header: '컴포넌트수', key: 'tot', width: 11 }, { header: '커버', key: 'cov', width: 9 },
    { header: '미커버', key: 'unc', width: 9 }, { header: '커버율', key: 'pct', width: 9 },
    { header: '제외', key: 'ex', width: 7 }, { header: '탭수', key: 'tabs', width: 7 },
  ];
  sm.getRow(1).font = { bold: true }; sm.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EBE6' } };
  const menuAgg = {}; let gTot = 0, gCov = 0, gEx = 0;
  for (const t of tree) {
    const g = t.scr.includes(' > ') ? t.scr.split(' > ')[0] : t.scr;
    const s = t.scr.includes(' > ') ? t.scr.split(' > ').slice(1).join(' > ') : t.scr;
    const tabs = new Set(t.rows.map((r) => r.tab).filter(Boolean)).size;
    (menuAgg[g] = menuAgg[g] || { tot: 0, cov: 0, ex: 0, rows: [] }).tot += t.total;
    menuAgg[g].cov += t.cov; menuAgg[g].ex += (t.exCount || 0);
    menuAgg[g].rows.push({ g, s, tot: t.total, cov: t.cov, unc: t.total - t.cov, pct: t.total ? Math.round(t.cov / t.total * 100) + '%' : '-', ex: t.exCount || 0, tabs });
    gTot += t.total; gCov += t.cov; gEx += (t.exCount || 0);
  }
  const MO = ['Home', '코스 현황 관리', '정보 관리', '사진 관리', '작업 관리', '예산 관리', '비용 관리', '인력 관리', '장비 관리', '자재 관리', '시설 관리'];
  const orderedM = MO.filter((g) => menuAgg[g]).concat(Object.keys(menuAgg).filter((g) => !MO.includes(g)));
  for (const g of orderedM) {
    const ag = menuAgg[g];
    const hdr = sm.addRow({ g, s: `── ${g} 소계 ──`, tot: ag.tot, cov: ag.cov, unc: ag.tot - ag.cov, pct: ag.tot ? Math.round(ag.cov / ag.tot * 100) + '%' : '-', ex: ag.ex || '', tabs: '' });
    hdr.font = { bold: true }; hdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF0EB' } };
    ag.rows.forEach((r) => sm.addRow(r));
  }
  const totRow = sm.addRow({ g: '합계', s: '', tot: gTot, cov: gCov, unc: gTot - gCov, pct: gTot ? Math.round(gCov / gTot * 100) + '%' : '-', ex: gEx, tabs: '' });
  totRow.font = { bold: true }; totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE6DB' } };

  const ws = wb.addWorksheet('커버리지', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '대메뉴', key: 'g', width: 14 }, { header: '소메뉴', key: 's', width: 18 },
    { header: '탭', key: 'tab', width: 16 },
    { header: '구분', key: 'k', width: 14 }, { header: '구성요소', key: 'l', width: 34 },
    { header: '커버', key: 'c', width: 7 }, { header: 'level', key: 'v', width: 7 },
    { header: '카테고리', key: 'cat', width: 11 }, { header: 'tcId', key: 'tc', width: 22 },
    { header: '근거', key: 'via', width: 10 }, { header: '미커버사유', key: 'rsn', width: 34 },
    { header: '의견', key: 'op', width: 40 }, { header: 'ID', key: 'id', width: 32 },
  ];
  const KL = { button: '버튼', tab: '탭', toggle: '토글', dropdown: '드롭리스트', datepicker: '날짜', input: '입력/placeholder', zoom: '지도줌', text: '문구', chart: '차트/그래프' };
  ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EBE6' } };
  for (const t of tree) {
    const g = t.scr.includes(' > ') ? t.scr.split(' > ')[0] : t.scr;
    const s = t.scr.includes(' > ') ? t.scr.split(' > ').slice(1).join(' > ') : '';
    for (const r of t.rows) {
      const id = idOf(t.scr, r.kind, r.label, r.tab);
      const row = ws.addRow({
        g, s, tab: r.tab || '', k: KL[r.kind] || r.kind, l: r.label, c: r.excluded ? '제외' : (r.covered ? 'O' : 'X'), v: r.level || '',
        cat: r.excluded ? '' : (r.cat || ''), tc: r.tcId || '', via: r.via || '', rsn: r.excluded ? '분모 제외(의견)' : (r.reason ? r.reason.r : ''),
        op: prevNotes[id] || '', id,
      });
      row.getCell('c').font = { color: { argb: r.excluded ? 'FF828A82' : (r.covered ? 'FF2F9E6F' : 'FFC14B34') }, bold: true };
      row.getCell('op').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9E6' } };   // 의견 = 편집 컬럼(연노랑)
      row.getCell('op').border = { left: { style: 'thin', color: { argb: 'FFD7AB4F' } }, right: { style: 'thin', color: { argb: 'FFD7AB4F' } } };
    }
  }
  ws.autoFilter = { from: 'A1', to: 'M1' };
  await wb.xlsx.writeFile(NOTES_XLSX);
}

(async () => {
  const inv = load(invPath, {});
  const auditData = load(auditPath, {});
  const transData = load(transPath, {});
  const man = load(manPath, {});
  // 인벤토리 화면키(길이 내림차순) — 리포트 경로 prefix 매칭용(Home 등 단일세그 포함).
  const invScreensSorted = Object.keys(inv).sort((a, b) => b.length - a.length);
  const { byScreen: repChecks, file: repFile } = await loadLatestReportChecks(invScreensSorted);
  const prevNotes = await loadPrevNotes();

  // manifest → screen → normalized label → {level, tcId}
  const manMap = {};
  for (const [scr, arr] of Object.entries(man)) {
    if (scr === '_doc') continue;
    manMap[scr] = {};
    (arr || []).forEach((e) => { manMap[scr][norm(e.label)] = e; });
  }

  const screens = Object.keys(inv).sort((a, b) => iaIdx(a) - iaIdx(b) || a.localeCompare(b));
  const tree = [];
  let totComp = 0, totCov = 0;
  const catTot = { 화면기본: 0, 등록수정: 0, 숫자계산: 0, 지도시각화: 0 };
  const catDenom = { 화면기본: 0, 등록수정: 0, 숫자계산: 0, 지도시각화: 0 };

  for (const scr of screens) {
    const comps = inv[scr] || [];
    const checks = repChecks[scr] || [];
    const skipRows = checks.filter((c) => c.result === 'SKIP');
    const rows = comps.map((c) => {
      const nl = norm(c.label);
      const mm = manMap[scr] && manMap[scr][nl];
      // 리포트 경로에 label 포함(PASS) 매칭
      const repHit = checks.find((ck) => ck.result === 'PASS' && nl && norm(ck.tail).includes(nl) && nl.length >= 2);
      const kindHit = !mm && !repHit && kindMatch(c.kind, checks);
      const covered = !!(mm || repHit || kindHit);
      const tcId = mm ? mm.tcId : (repHit ? repHit.tcId : '');
      const level = mm ? mm.level : (repHit ? 'L2' : (kindHit ? 'L2' : ''));
      const via = mm ? 'manifest' : (repHit ? 'report' : (kindHit ? 'kind추정' : ''));
      const cat = expectedCat(c.kind, c.label, scr);   // 전 컴포넌트에 예상 카테고리(분모 정밀화)
      const reason = covered ? null : uncoveredReason(c, skipRows);
      const note = prevNotes[idOf(scr, c.kind, c.label, c.tab)] || '';
      // 의견 컬럼에 '제외'/'제거' 기입 = 사용자 큐레이션(데이터 인스턴스 등) → 분모/분자에서 완전 제외.
      const excluded = /제외|제거/.test(note);
      return { kind: c.kind, label: c.label, tab: c.tab || '', covered, level, tcId, via, cat, reason, note, excluded };
    });
    // 분모/분자·카테고리 집계는 '제외' 아닌 활성 컴포넌트만(정직한 커버율).
    const activeRows = rows.filter((r) => !r.excluded);
    const cov = activeRows.filter((r) => r.covered).length;
    totComp += activeRows.length; totCov += cov;
    // 화면 카테고리별 실행 카운트(리포트 tcId 기반)
    const catCount = { 화면기본: 0, 등록수정: 0, 숫자계산: 0, 지도시각화: 0 };
    checks.forEach((ck) => { catCount[categoryOf(ck.tcId, ck.tail)]++; });
    activeRows.forEach((r) => { if (r.cat) { catDenom[r.cat]++; if (r.covered) catTot[r.cat]++; } });
    const exCount = rows.length - activeRows.length;
    tree.push({ scr, rows, cov, total: activeRows.length, exCount, catCount, uncap: (auditData[scr] || []), trans: (transData[scr] || []) });
  }

  // 대메뉴 그룹핑 (IA 메뉴 순서 유지)
  const groups = {};
  tree.forEach((t) => { const g = t.scr.includes(' > ') ? t.scr.split(' > ')[0] : t.scr; (groups[g] = groups[g] || []).push(t); });
  const orderedGroups = MENU_ORDER.filter((g) => groups[g]).concat(Object.keys(groups).filter((g) => !MENU_ORDER.includes(g)));

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const totExcl = tree.reduce((a, t) => a + (t.exCount || 0), 0);
  const pct = totComp ? (totCov / totComp * 100).toFixed(1) : '0';
  const totTrans = tree.reduce((a, t) => a + (t.trans ? t.trans.length : 0), 0);
  let totTransComp = 0, totTransCov = 0;
  tree.forEach((t) => { const cks = repChecks[t.scr] || []; (t.trans || []).forEach((tr) => (tr.components || []).forEach((c) => { totTransComp++; if (compCovered(c.kind, c.label, cks)) totTransCov++; })); });

  // ── HTML ──
  const kindRows = (rows) => KIND_ORDER.filter((k) => rows.some((r) => r.kind === k)).map((k) => {
    const rs = rows.filter((r) => r.kind === k);
    const items = rs.map((r) => `<div class="comp ${r.covered ? 'cov' : 'unc'}" data-cat="${r.cat}" data-cov="${r.covered ? 1 : 0}">
      <span class="badge ${r.covered ? 'y' : 'n'}">${r.covered ? '✓' : '✗'}</span>
      <span class="lbl">${esc(r.label)}</span>
      ${r.level ? `<span class="lvl">${r.level}</span>` : ''}
      ${r.cat ? `<span class="cat c-${CATS.indexOf(r.cat)}">${r.cat}</span>` : ''}
      ${r.tcId ? `<span class="tc">${esc(r.tcId)}</span>` : ''}
      ${r.via ? `<span class="via">${r.via}</span>` : ''}
      ${r.reason ? `<span class="rsn rk-${r.reason.k}">사유: ${esc(r.reason.r)}</span>` : ''}
      ${r.note ? `<span class="unote">💬 ${esc(r.note)}</span>` : ''}
    </div>`).join('');
    return `<div class="kindgrp"><div class="kindname">${KIND_LABEL[k] || k} <span class="kc">${rs.filter((r) => r.covered).length}/${rs.length}</span></div>${items}</div>`;
  }).join('');

  // Phase B/C — 화면 밖 전환(모달/팝업/페이지) 서브트리: 트리거 → [유형] → 대상 구성요소.
  const TTYPE = { '모달': 'c-1', '새탭/팝업': 'c-3', '페이지 전환': 'c-0' };
  const transBlock = (trans, checks) => {
    if (!trans || !trans.length) return '';
    const items = trans.map((tr) => {
      const comps = tr.components || [];
      let cov = 0;
      const rendered = comps.slice(0, 80).map((c) => {
        const ok = compCovered(c.kind, c.label, checks); if (ok) cov++;
        return `<span class="tcomp ${ok ? 'tc-y' : 'tc-n'}">${ok ? '✓' : '✗'} ${esc((KIND_LABEL[c.kind] || c.kind))}: ${esc(c.label)}</span>`;
      }).join('');
      // 80개 초과분 커버 카운트 보정
      comps.slice(80).forEach((c) => { if (compCovered(c.kind, c.label, checks)) cov++; });
      const pctT = comps.length ? Math.round(cov / comps.length * 100) : 0;
      return `<div class="transrow"><div class="transhead"><span class="cat ${TTYPE[tr.type] || 'c-0'}">${esc(tr.type)}</span> <b>${esc(tr.trigger)}</b> <span class="via">대상 ${comps.length}종 · <b style="color:${pctT >= 50 ? 'var(--cov)' : 'var(--unc)'}">커버 ${cov}/${comps.length} (${pctT}%)</b></span></div><div class="tcomps">${rendered}</div></div>`;
    }).join('');
    return `<div class="transblock"><div class="tabname" style="color:var(--c3)">🔀 화면 밖 전환 ${trans.length} (Phase B/C — 트리거→모달/팝업/페이지 + 대상 구성요소 커버 여부)</div>${items}</div>`;
  };
  // 소메뉴 본문: 기본(탭 없음) + 탭별 블록 중첩. '제외' 컴포넌트는 집계 제외 → 별도 muted 블록으로 투명 표기.
  const subBody = (allRows) => {
    const rows = allRows.filter((r) => !r.excluded);
    const ex = allRows.filter((r) => r.excluded);
    const base = rows.filter((r) => !r.tab);
    const tabs = [...new Set(rows.filter((r) => r.tab).map((r) => r.tab))];
    let h = kindRows(base);
    tabs.forEach((t) => {
      const tr = rows.filter((r) => r.tab === t);
      h += `<div class="tabblock"><div class="tabname">🗂 탭: ${esc(t)} <span class="kc">${tr.filter((r) => r.covered).length}/${tr.length}</span></div>${kindRows(tr)}</div>`;
    });
    if (ex.length) {
      h += `<div class="exblock"><div class="tabname" style="color:var(--muted)">🚫 분모 제외 ${ex.length} (의견=제외 — 사용자 입력/데이터 인스턴스, 커버율 계산서 제외)</div>${ex.slice(0, 60).map((r) => `<div class="comp exc"><span class="lbl">${esc(r.label)}</span><span class="via">${KIND_LABEL[r.kind] || r.kind}${r.note ? ' · ' + esc(r.note) : ''}</span></div>`).join('')}</div>`;
    }
    return h;
  };

  const screensHtml = orderedGroups.map((g) => {
    const arr = groups[g];
    const gc = arr.reduce((a, t) => a + t.cov, 0), gt = arr.reduce((a, t) => a + t.total, 0);
    const subs = arr.map((t) => {
      const sub = t.scr.includes(' > ') ? t.scr.split(' > ').slice(1).join(' > ') : t.scr;
      const p = t.total ? Math.round(t.cov / t.total * 100) : 0;
      const chips = CATS.map((c, i) => t.catCount[c] ? `<span class="cat c-${i}" title="${c} 검증 ${t.catCount[c]}건">${c} ${t.catCount[c]}</span>` : '').join('');
      return `<details class="sub"><summary><span class="subname">${esc(sub)}</span>
        <span class="frac">${t.cov}/${t.total}</span>
        <span class="bar"><span style="width:${p}%"></span></span>
        <span class="chips">${chips}${t.exCount ? `<span class="cat" style="background:var(--muted)">제외 ${t.exCount}</span>` : ''}${t.trans && t.trans.length ? `<span class="cat" style="background:var(--c3)">전환 ${t.trans.length}</span>` : ''}${t.uncap && t.uncap.length ? `<span class="cat" style="background:var(--unc)">미포착후보 ${t.uncap.length}</span>` : ''}</span></summary>
        <div class="comps">${subBody(t.rows)}${transBlock(t.trans, repChecks[t.scr] || [])}${t.uncap && t.uncap.length ? `<div class="auditblock"><div class="tabname" style="color:var(--unc)">🔎 미포착 후보 ${t.uncap.length} (감사 — 아직 컴포넌트로 안 잡힌 본문 텍스트)</div>${t.uncap.slice(0, 40).map((u) => `<div class="comp unc"><span class="lbl">${esc(u.text)}</span><span class="via">${esc(u.tag)}${u.cls ? '.' + esc(u.cls) : ''}</span></div>`).join('')}</div>` : ''}</div></details>`;
    }).join('');
    const gp = gt ? Math.round(gc / gt * 100) : 0;
    return `<details class="grp" open><summary><span class="gname">${esc(g)}</span><span class="frac">${gc}/${gt} · ${gp}%</span></summary>${subs}</details>`;
  }).join('');

  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>코스관리 세부 커버리지 트리</title>
<style>
:root{--bg:#f5f6f4;--panel:#fff;--ink:#1b201c;--soft:#4b544d;--muted:#828a82;--hair:#e0e4dd;--accent:#2f7d5b;--cov:#2f9e6f;--unc:#c14b34;--covbg:#e6f3ec;--uncbg:#f6e4de;
--c0:#3d78b0;--c1:#2f9e6f;--c2:#c99321;--c3:#8457b5;--sans:ui-sans-serif,-apple-system,"Segoe UI","Malgun Gothic",sans-serif;--mono:ui-monospace,Consolas,monospace;}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0f130f;--panel:#161b16;--ink:#e7ece5;--soft:#a9b2a8;--muted:#79817a;--hair:#2a312a;--accent:#5cbf98;--cov:#4fb98a;--unc:#e0846e;--covbg:#16281e;--uncbg:#2c1a15;}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5}
.wrap{max-width:1100px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:24px;margin:0 0 4px}.date{font-size:12.5px;color:var(--muted);margin:0 0 18px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px}
.kpi{background:var(--panel);border:1px solid var(--hair);border-radius:12px;padding:14px 16px}
.kpi .n{font-size:26px;font-weight:700}.kpi .l{font-size:12px;color:var(--soft);margin-top:4px}
.controls{position:sticky;top:0;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--hair);margin-bottom:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;z-index:5}
.controls input[type=search]{flex:1;min-width:180px;padding:7px 11px;border:1px solid var(--hair);border-radius:8px;background:var(--panel);color:var(--ink)}
.controls label{font-size:12.5px;display:inline-flex;align-items:center;gap:4px;background:var(--panel);border:1px solid var(--hair);border-radius:20px;padding:5px 11px;cursor:pointer}
details{margin:0}details.grp{background:var(--panel);border:1px solid var(--hair);border-radius:12px;margin-bottom:10px;overflow:hidden}
summary{cursor:pointer;padding:11px 15px;display:flex;align-items:center;gap:12px;list-style:none}summary::-webkit-details-marker{display:none}
summary::before{content:"▸";color:var(--muted);font-size:11px}details[open]>summary::before{content:"▾"}
.gname{font-size:16px;font-weight:700}.subname{font-size:14px;font-weight:600}
.frac{font-family:var(--mono);font-size:12px;color:var(--soft)}
.bar{flex:1;max-width:120px;height:7px;background:var(--hair);border-radius:4px;overflow:hidden}.bar span{display:block;height:100%;background:var(--cov)}
.sub{border-top:1px solid var(--hair)}.sub>summary{padding-left:26px}
.chips{display:flex;gap:4px;flex-wrap:wrap}
.cat{font-size:10.5px;font-weight:600;padding:2px 7px;border-radius:20px;color:#fff}
.c-0{background:var(--c0)}.c-1{background:var(--c1)}.c-2{background:var(--c2)}.c-3{background:var(--c3)}
.comps{padding:6px 15px 14px 30px}
.kindgrp{margin:8px 0}.kindname{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:4px}.kc{font-family:var(--mono);font-weight:400}
.tabblock{margin:10px 0 4px;padding:8px 10px;border:1px solid var(--hair);border-left:3px solid var(--c0);border-radius:8px;background:var(--panel)}
.auditblock{margin:10px 0 4px;padding:8px 10px;border:1px dashed var(--unc);border-radius:8px}
.exblock{margin:10px 0 4px;padding:8px 10px;border:1px dashed var(--muted);border-radius:8px;opacity:.8}
.comp.exc{background:transparent;color:var(--muted)}.comp.exc .lbl{text-decoration:line-through}
.transblock{margin:10px 0 4px;padding:8px 10px;border:1px solid var(--hair);border-left:3px solid var(--c3);border-radius:8px}
.transrow{padding:6px 2px;border-bottom:1px solid var(--hair)}.transrow:last-child{border-bottom:none}
.transhead{font-size:12.5px;margin-bottom:4px}
.tcomps{display:flex;flex-wrap:wrap;gap:4px}
.tcomp{font-size:10.5px;border:1px solid var(--hair);border-radius:4px;padding:1px 6px}
.tc-y{color:var(--cov);background:var(--covbg)} .tc-n{color:var(--unc);background:var(--uncbg)}
.tabname{font-size:12.5px;font-weight:700;color:var(--c0);margin-bottom:4px}
.comp{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:7px;font-size:12.5px;flex-wrap:wrap}
.comp.cov{background:var(--covbg)}.comp.unc{background:var(--uncbg)}
.badge{font-weight:700;width:15px;text-align:center}.badge.y{color:var(--cov)}.badge.n{color:var(--unc)}
.lbl{font-weight:500}.lvl{font-family:var(--mono);font-size:10px;color:var(--soft);border:1px solid var(--hair);border-radius:4px;padding:0 4px}
.tc{font-family:var(--mono);font-size:10px;color:var(--muted)}.via{font-size:10px;color:var(--muted);font-style:italic}
.rsn{font-size:10.5px;color:var(--soft);background:var(--bg);border:1px dashed var(--hair);border-radius:4px;padding:0 5px}
.rk-파괴{color:var(--unc)}.rk-SKIP{color:var(--c2)}
.unote{font-size:11px;color:var(--ink);background:#fff9e6;border:1px solid #d7ab4f;border-radius:5px;padding:1px 7px;font-weight:500}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]) .unote{background:#2a2413;color:#e7ece5}}
.hide{display:none !important}
.note{font-size:12px;color:var(--soft);background:var(--panel);border:1px solid var(--hair);border-left:3px solid var(--c2);border-radius:8px;padding:12px 14px;margin-bottom:16px}
</style></head><body><div class="wrap">
<h1>코스관리 세부 커버리지 트리 <span style="font-size:13px;color:var(--muted)">Phase A</span></h1>
<p class="date">${ts} · 대상 ${SUB} · 분모=구성요소 인벤토리 · 분자=manifest ∪ 최신 리포트(${repFile || '없음'})</p>
<div class="kpis">
<div class="kpi"><div class="n">${screens.length}</div><div class="l">화면(소메뉴)</div></div>
<div class="kpi"><div class="n">${totComp}</div><div class="l">구성요소(분모)<br><small style="color:var(--muted)">제외 ${totExcl} (의견=제외)</small></div></div>
<div class="kpi"><div class="n" style="color:var(--cov)">${totCov}</div><div class="l">커버됨</div></div>
<div class="kpi"><div class="n">${pct}<small style="font-size:14px">%</small></div><div class="l">커버리지</div></div>
<div class="kpi"><div class="n" style="color:var(--c3)">${totTrans}</div><div class="l">화면 밖 전환(Phase B)<br>대상 커버 ${totTransCov}/${totTransComp} (${totTransComp ? Math.round(totTransCov / totTransComp * 100) : 0}%)</div></div>
</div>
<div class="kpis" style="margin-top:-6px">
${CATS.map((c, i) => `<div class="kpi"><div class="n" style="font-size:19px"><span class="cat c-${i}" style="font-size:11px;vertical-align:middle">${c}</span> ${catTot[c]}<small style="font-size:12px">/${catDenom[c]}</small></div><div class="l">${catDenom[c] ? Math.round(catTot[c] / catDenom[c] * 100) : 0}% 커버 · 분모 ${catDenom[c]}</div></div>`).join('')}
</div>
<div class="note"><b>범위/한계(Phase A):</b> ① 구성요소는 <b>기본 화면 상태</b> 기준(모달/팝업 내부·탭 조건부 요소는 미포함 → Phase B/C). ② <b>안내문구(text)</b>는 인벤토리 스펙 보강 후 다음 <code>course:inventory</code> refresh부터 채워짐. ③ 커버 판정은 manifest(설계) ∪ 최신 리포트(실행) union, kind추정 포함 — <b>via</b> 배지로 매칭 근거 표기. ④ 카테고리(화면기본/등록수정/숫자계산/지도시각화)는 <b>전 컴포넌트에 kind·메뉴 기반 예상 카테고리</b> 부여 → 카테고리별 분모·커버율 산출(시각화 kind→지도시각화, 폼컨트롤·CRUD버튼→등록수정, 예산/비용 도메인→숫자계산, 그 외→화면기본).<br><b>✍️ 의견 기입:</b> <code>reports/course-coverage-notes.xlsx</code>의 <b>'의견' 컬럼</b>(연노랑)에 항목별로 입력·저장하세요. 편집 후 파일을 닫고 <code>npm run course:coverage-tree</code> 재생성하면 <b>의견이 유지</b>되고 이 트리에도 💬로 표시됩니다.</div>
<div class="controls">
<input type="search" id="q" placeholder="구성요소·화면 검색…">
<label><input type="checkbox" class="cf" value="화면기본" checked>화면기본</label>
<label><input type="checkbox" class="cf" value="등록수정" checked>등록수정</label>
<label><input type="checkbox" class="cf" value="숫자계산" checked>숫자계산</label>
<label><input type="checkbox" class="cf" value="지도시각화" checked>지도시각화</label>
<label><input type="checkbox" id="onlyunc">미커버만</label>
</div>
${screensHtml}
</div>
<script>
const q=document.getElementById('q'),onlyunc=document.getElementById('onlyunc'),cfs=[...document.querySelectorAll('.cf')];
function apply(){
  const term=(q.value||'').replace(/\\s+/g,'').toLowerCase();
  const cats=cfs.filter(c=>c.checked).map(c=>c.value);
  const uo=onlyunc.checked;
  const active=!!term||uo||cats.length<cfs.length;   // 필터 활성 여부(빈 섹션 접기용)
  document.querySelectorAll('.comp').forEach(el=>{
    const lblEl=el.querySelector('.lbl');
    const lbl=(lblEl?lblEl.textContent:'').replace(/\\s+/g,'').toLowerCase();
    const cat=el.dataset.cat;              // 커버/미커버 comp엔 있음. 제외·감사 블록엔 없음(undefined)
    const cov=el.dataset.cov;              // '1'(커버)/'0'(미커버)/undefined(제외·감사)
    let show=true;
    if(term&&!lbl.includes(term))show=false;               // 검색어
    if(uo&&cov!=='0')show=false;                           // 미커버만 = data-cov==0 만
    if(cat&&!cats.includes(cat))show=false;                // 카테고리 = 커버·미커버 공통 적용
    el.classList.toggle('hide',!show);
  });
  // 빈 소메뉴·대메뉴 자동 접기(필터 활성 시)
  document.querySelectorAll('.sub').forEach(s=>{const vis=s.querySelectorAll('.comp:not(.hide)').length;s.classList.toggle('hide',active&&vis===0);});
  document.querySelectorAll('.grp').forEach(g=>{const vis=g.querySelectorAll('.sub:not(.hide)').length;g.classList.toggle('hide',active&&vis===0);});
}
q.addEventListener('input',apply);onlyunc.addEventListener('change',apply);cfs.forEach(c=>c.addEventListener('change',apply));
</script></body></html>`;

  const outDir = path.join(ROOT, 'reports');
  const outName = `course-coverage-tree_${ts.replace(/[: ]/g, '-')}.html`;
  fs.writeFileSync(path.join(outDir, outName), html);
  try { await writeNotesXlsx(tree, prevNotes); }
  catch (e) { console.warn(`[coverage-tree] ⚠ 의견 xlsx 쓰기 실패(${(e && e.code) || e}) — Excel에서 course-coverage-notes.xlsx 를 닫고 다시 실행하세요. HTML 트리는 정상 생성됨.`); }
  const noteCount = Object.keys(prevNotes).length;
  console.log(`[coverage-tree] 화면 ${screens.length} · 구성요소 ${totComp} · 커버 ${totCov} (${pct}%)`);
  console.log(`[coverage-tree] 카테고리별 커버/분모:`, CATS.map((c) => `${c} ${catTot[c]}/${catDenom[c]}`).join(' · '));
  console.log(`[coverage-tree] 의견 유지 ${noteCount}건(course-coverage-notes.xlsx의 '의견' 컬럼 편집 → 재생성 시 보존)`);
  console.log(`[out] reports/${outName}`);
  console.log(`[out] reports/course-coverage-notes.xlsx  (← '의견' 컬럼 편집·저장, 편집 후 닫고 재생성)`);
})();
