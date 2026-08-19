import fs from 'fs';
import path from 'path';

// ──────────────────────────────────────────────────────────────
//  코스관리 세부 IA + 커버리지 문서 생성 — 대메뉴>소메뉴>컴포넌트 단위로 커버리지 매핑.
//  입력: baselines/course-components.<sub>.json (인벤토리) + baselines/course-coverage-manifest.json (검증매핑)
//  산출: reports/course-ia-coverage_<ts>.md
//  실행: npm run course:ia
// ──────────────────────────────────────────────────────────────

const SUB = process.env.COURSE_SUBDOMAIN || 'course-mng-td';
const ROOT = process.cwd();
const inv: Record<string, { kind: string; label: string }[]> = load(path.join(ROOT, 'baselines', `course-components.${SUB}.json`), {});
const man: Record<string, { label: string; kind?: string; level: string; tcId: string }[]> = load(path.join(ROOT, 'baselines', 'course-coverage-manifest.json'), {});

function load(p: string, f: any) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return f; } }
const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();

// 라우트 맵(실측)
const ROUTE: Record<string, string> = {
  'Home': '/', '코스 모니터': '/monitor/view', '식생 분석': '/monitor/spectral', '코스 영역 설정': '/monitor/draw',
  '드론사진 업로드': '/monitor/upload', '3D': '/monitor/3d', '그린 분석': '/monitor/green',
  '코스 기본 정보': '/info/course', '코스 리뉴얼 정보': '/info/renewal', '홀 별 정보': '/info/hole', '잔디 측정 정보': '/info/grass',
  '토양 측정 정보': '/info/soil', '발병 정보': '/info/disease', '코스 운영 정보': '/info/operation', '기상 정보': '/info/weather',
  '거래처 정보': '/info/vendor', '관리 기준 정보': '/info/eval', '일상 점검': '/info/daily', '정보별 사진': '/photo/info', '위치별 사진': '/photo/loc',
  '작업 지시': '/task/orders', '작업 계획': '/task/plan', '이슈 관리': '/task/issue', '예측 정보': '/task/predict', '작업 일보': '/task/daily',
  '예산 총괄': '/budget/summary', '예산 상세': '/budget/detail', '실적 관리': '/budget/performance', '예산 분석': '/budget/analysis',
  '비용 집계': '/cost/aggregate', '작업별 비용': '/cost/task', '분류별 비용': '/cost/category', '위치별 비용': '/cost/loc', '기간별 비용': '/cost/period',
  '권한관리': '/hr/perms', '인력 관리': '/hr/human', '근태 관리': '/hr/work', '투입 관리': '/hr/assign',
  '장비 총괄': '/equipment/summary', '장비 관제': '/equipment/monitor', '자재 총괄': '/material/summary',
  '자재 수불(품목별)': '/material/ledger-item', '자재 수불(일자별)': '/material/ledger-daily', '시설 총괄': '/facility/summary', '시설 관제': '/facility/monitor',
};

// 대메뉴 순서
const MENU_ORDER = ['Home', '코스 현황 관리', '정보 관리', '사진 관리', '작업 관리', '예산 관리', '비용 관리', '인력 관리', '장비 관리', '자재 관리', '시설 관리'];

const SNB_NAMES = new Set([
  'Home', '코스현황관리', '정보관리', '사진관리', '작업관리', '예산관리', '비용관리', '인력관리', '장비관리', '자재관리', '시설관리',
  '코스모니터', '식생분석', '코스영역설정', '드론사진업로드', '3D', '그린분석', '코스기본정보', '코스리뉴얼정보', '홀별정보', '잔디측정정보',
  '토양측정정보', '발병정보', '코스운영정보', '기상정보', '거래처정보', '관리기준정보', '일상점검', '정보별사진', '위치별사진', '작업지시',
  '작업계획', '이슈관리', '예측정보', '작업일보', '예산총괄', '예산상세', '실적관리', '예산분석', '비용집계', '작업별비용', '분류별비용',
  '위치별비용', '기간별비용', '권한관리', '근태관리', '투입관리', '총괄관리', '장비총괄', '장비관제', '자재총괄', '자재수불', '자재수불(품목별)',
  '자재수불(일자별)', '시설총괄', '시설관제', '코스뷰', '코스정보입력', '이슈/예측',
]);
const ROW_ACTIONS = new Set(['삭제', '저장']);

interface C { kind: string; label: string }
function categorize(cs: C[]) {
  const dd = new Set(cs.filter((c) => c.kind === 'dropdown').map((c) => norm(c.label)));
  const testable: C[] = [], excluded: C[] = [], noise: C[] = [];
  for (const c of cs) {
    const l = norm(c.label);
    if (c.kind === 'toggle' && dd.has(l)) { noise.push(c); continue; }
    if (/^\d+$/.test(l) || /loading/i.test(c.label) || c.label === '(무텍스트)' || /^ico-|leaflet/i.test(c.label)) { noise.push(c); continue; }
    if (c.kind === 'zoom') { noise.push(c); continue; }
    if (c.kind === 'toggle' && SNB_NAMES.has(l)) { noise.push(c); continue; }
    if (c.kind === 'button' && ROW_ACTIONS.has(l)) { excluded.push(c); continue; }
    testable.push(c);
  }
  return { testable, excluded, noise };
}
function coverOf(c: C, entries: any[]) {
  const cl = norm(c.label);
  for (const m of entries) { const ml = norm(m.label); if (!ml) continue; if ((cl === ml || cl.includes(ml) || ml.includes(cl)) && (!m.kind || m.kind === c.kind)) return m; }
  return null;
}

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out: string[] = [`# 코스관리 세부 IA + 커버리지`, ``, `- 생성: ${ts} · 대상: \`${SUB}\` · 정의: L1 존재 / L2 상호작용 / L3 정합성`, ``];
let gT = 0, gC = 0, gExcl = 0;

// 화면 그룹핑: 대메뉴 → 소메뉴들
const byMenu: Record<string, string[]> = {};
for (const key of Object.keys(inv)) {
  const menu = key === 'Home' ? 'Home' : key.split(' > ')[0];
  (byMenu[menu] ||= []).push(key);
}

for (const menu of MENU_ORDER) {
  const screens = byMenu[menu]; if (!screens) continue;
  out.push(`\n## ${menu}`);
  for (const key of screens) {
    const sub = key === 'Home' ? 'Home' : key.split(' > ')[1];
    const { testable, excluded } = categorize(inv[key] || []);
    const entries = man[key] || [];
    let cov = 0;
    const rows: string[] = [];
    for (const c of testable) {
      const m = coverOf(c, entries);
      const status = m ? `✅ ${m.level} (\`${m.tcId}\`)` : '🔴 미커버';
      if (m) cov++;
      rows.push(`| \`${c.label}\` | ${c.kind} | ${status} |`);
    }
    gT += testable.length; gC += cov; gExcl += excluded.length;
    const pct = testable.length ? Math.round((cov / testable.length) * 100) : 0;
    const flag = pct >= 90 ? '🟢' : pct >= 50 ? '🟡' : testable.length === 0 ? '⚪' : '🔴';
    out.push(`\n### ${sub}  \`${ROUTE[sub] || '?'}\`  ${flag} ${cov}/${testable.length} (${pct}%)`);
    if (excluded.length) out.push(`> 제외(파괴): ${excluded.map((e) => `\`${e.label}\``).join(', ')}`);
    if (rows.length) { out.push(`\n| 컴포넌트 | 유형 | 커버리지 |`, `|---|---|---|`, ...rows); }
    else out.push(`> (기본 상태 상호작용 컴포넌트 없음 — 지도/조회 화면)`);
  }
}

const pct = gT ? Math.round((gC / gT) * 100) : 0;
out.splice(3, 0, `- **테스트 대상 ${gT} · 검증 ${gC} (${pct}%) · 미커버 ${gT - gC} · 제외(파괴) ${gExcl}**`);
const md = out.join('\n') + '\n';
const dir = path.join(ROOT, 'reports'); fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `course-ia-coverage_${ts}.md`);
fs.writeFileSync(file, md);
console.log(md.slice(0, 1200));
console.log(`\n[IA] → ${file}`);
