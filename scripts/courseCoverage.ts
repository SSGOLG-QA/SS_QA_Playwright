import fs from 'fs';
import path from 'path';

// ──────────────────────────────────────────────────────────────
//  코스관리 커버리지 갭 리포트 — 인벤토리(분모) − 매니페스트(분자) = 미커버.
//  입력:
//    baselines/course-components.<sub>.json   (컴포넌트 인벤토리, course:inventory 산출)
//    baselines/course-coverage-manifest.json  (검증 매핑: 화면 → [{label,kind?,level,tcId}])
//  산출: reports/course-coverage_<ts>.md
//  실행: npm run course:coverage   (SUB=td 기본 course-mng-td)
// ──────────────────────────────────────────────────────────────

const SUB = process.env.COURSE_SUBDOMAIN || 'course-mng-td';
const ROOT = process.cwd();
const invPath = path.join(ROOT, 'baselines', `course-components.${SUB}.json`);
const manPath = path.join(ROOT, 'baselines', 'course-coverage-manifest.json');

interface Comp { kind: string; label: string }
interface ManEntry { label: string; kind?: string; level: 'L1' | 'L2' | 'L3'; tcId: string }

const norm = (s: string) => (s || '').replace(/\s+/g, '').trim();

function loadJson<T>(p: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// SNB 대/소메뉴 + 권한 트리 라벨(정규화) — 토글로 누출된 것을 분모에서 제거
const SNB_NAMES = new Set([
  'Home', '코스현황관리', '정보관리', '사진관리', '작업관리', '예산관리', '비용관리', '인력관리', '장비관리', '자재관리', '시설관리',
  '코스모니터', '식생분석', '코스영역설정', '드론사진업로드', '3D', '그린분석',
  '코스기본정보', '코스리뉴얼정보', '홀별정보', '잔디측정정보', '토양측정정보', '발병정보', '코스운영정보', '기상정보', '거래처정보', '관리기준정보', '일상점검',
  '정보별사진', '위치별사진', '작업지시', '작업계획', '이슈관리', '예측정보', '작업일보',
  '예산총괄', '예산상세', '실적관리', '예산분석', '비용집계', '작업별비용', '분류별비용', '위치별비용', '기간별비용',
  '권한관리', '근태관리', '투입관리', '총괄관리', '장비총괄', '장비관제', '자재총괄', '자재수불', '자재수불(품목별)', '자재수불(일자별)', '시설총괄', '시설관제',
  '코스뷰', '코스정보입력', '이슈/예측',
].map((s) => s.replace(/\s+/g, '')));
// 의도적 제외(진짜 파괴 — 클릭 시 데이터 변경. 분모 아님, 별도 집계)
//   ⚠ '보기'(읽기전용 상세)·'수정 열기'(저장 안 함)는 비파괴 테스트 가능 → 제외 아님(테스트 대상).
//     삭제·저장(제출)만 진짜 파괴 → 옵트인 파괴 CRUD 티어에서 검증.
const ROW_ACTIONS = new Set(['삭제', '저장']);

interface Categorized { testable: Comp[]; excluded: Comp[]; noise: Comp[] }
function categorize(comps: Comp[]): Categorized {
  const dd = new Set(comps.filter((c) => c.kind === 'dropdown').map((c) => norm(c.label)));
  const testable: Comp[] = [], excluded: Comp[] = [], noise: Comp[] = [];
  for (const c of comps) {
    const l = norm(c.label);
    // 노이즈(추출 아티팩트) — 분모에서 완전 제외
    if (c.kind === 'toggle' && dd.has(l)) { noise.push(c); continue; }         // vue-select 이중계상
    if (/^\d+$/.test(l)) { noise.push(c); continue; }                          // 페이지네이션
    if (/loading/i.test(c.label)) { noise.push(c); continue; }
    if (c.label === '(무텍스트)') { noise.push(c); continue; }
    if (/^ico-|leaflet/i.test(c.label)) { noise.push(c); continue; }           // 아이콘/leaflet
    if (c.kind === 'zoom') { noise.push(c); continue; }                        // 지도 줌
    if (c.kind === 'toggle' && SNB_NAMES.has(l)) { noise.push(c); continue; }  // SNB/권한트리 누출
    // 의도적 제외(파괴/데이터의존) — 분모 아님, 별도 집계
    if (c.kind === 'button' && ROW_ACTIONS.has(l)) { excluded.push(c); continue; }
    testable.push(c);
  }
  return { testable, excluded, noise };
}

function coveredBy(comp: Comp, entries: ManEntry[]): ManEntry | null {
  const cl = norm(comp.label);
  for (const m of entries) {
    const ml = norm(m.label);
    if (!ml) continue;
    const labelMatch = cl === ml || cl.includes(ml) || ml.includes(cl);
    const kindMatch = !m.kind || m.kind === comp.kind;
    if (labelMatch && kindMatch) return m;
  }
  return null;
}

function main() {
  const inv = loadJson<Record<string, Comp[]>>(invPath, {});
  const man = loadJson<Record<string, ManEntry[]>>(manPath, {});
  if (!Object.keys(inv).length) {
    console.error(`[coverage] 인벤토리 없음: ${invPath} — 먼저 'npm run course:auth' 후 'npm run course:inventory' 실행`);
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rows: string[] = [];
  let gT = 0, gCov = 0, gL2 = 0, gExcl = 0, gNoise = 0;
  const gapLines: string[] = [];

  const screens = Object.keys(inv).sort();
  for (const screen of screens) {
    const { testable, excluded, noise } = categorize(inv[screen] || []);
    const entries = man[screen] || [];
    let cov = 0, l2 = 0;
    const uncovered: Comp[] = [];
    for (const c of testable) {
      const m = coveredBy(c, entries);
      if (m) { cov++; if (m.level === 'L2' || m.level === 'L3') l2++; }
      else uncovered.push(c);
    }
    gT += testable.length; gCov += cov; gL2 += l2; gExcl += excluded.length; gNoise += noise.length;
    const pct = testable.length ? Math.round((cov / testable.length) * 100) : 0;
    const flag = pct >= 90 ? '🟢' : pct >= 50 ? '🟡' : '🔴';
    rows.push(`| ${screen} | ${testable.length} | ${cov} | ${l2} | ${testable.length - cov} | ${excluded.length} | ${flag} ${pct}% |`);
    if (uncovered.length) {
      gapLines.push(`\n### ${screen} — 미커버 ${uncovered.length}`);
      const byKind: Record<string, string[]> = {};
      for (const u of uncovered) (byKind[u.kind] ||= []).push(u.label);
      for (const k of Object.keys(byKind).sort()) gapLines.push(`- **${k}**: ${byKind[k].map(x => `\`${x}\``).join(', ')}`);
    }
  }

  const pct = gT ? Math.round((gCov / gT) * 100) : 0;
  const l2pct = gT ? Math.round((gL2 / gT) * 100) : 0;
  const md = [
    `# 코스관리 컴포넌트 커버리지 리포트 (인벤토리 v2)`,
    ``,
    `- 생성: ${ts} · 대상: \`${SUB}\``,
    `- **테스트 대상(분모) ${gT} · 검증(분자) ${gCov} (${pct}%) · 그중 L2 상호작용 ${gL2} (${l2pct}%) · 미커버 ${gT - gCov}**`,
    `- 분모 정화: 노이즈 ${gNoise}개 제거(SNB토글 누출·페이지네이션·leaflet줌·ico), 의도적 제외 ${gExcl}개(행 액션 보기/수정/삭제·저장=파괴/데이터의존)`,
    `- 정의: 분모=화면 기본 상태 '테스트 대상' 상호작용 요소 / 분자=라이브 PASS 매핑 / L2=선택·변경 반응 검증`,
    ``,
    `## 화면별 커버리지`,
    ``,
    `| 화면 | 대상 | 검증 | L2 | 미커버 | 제외 | 커버율 |`,
    `|------|------|------|----|--------|------|--------|`,
    ...rows,
    ``,
    `## 미커버 상세 (채워야 할 목록)`,
    ...gapLines,
    ``,
  ].join('\n');

  const outDir = path.join(ROOT, 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `course-coverage_${ts}.md`);
  fs.writeFileSync(out, md);
  console.log(md);
  console.log(`\n[coverage] → ${out}`);
}

main();
