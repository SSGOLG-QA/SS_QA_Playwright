/**
 * scripts/jsonToSpecParser.ts
 *
 * 목적  : route-map.json + 기획서 JSON(경기관제_클럽어드민__개선__3_.json)을
 *         SpecParser 호환 포맷으로 변환한다.
 *
 * 실행  :
 *   npx ts-node scripts/jsonToSpecParser.ts
 *   npx ts-node scripts/jsonToSpecParser.ts \
 *     --routeMap=./scripts/route-map.json \
 *     --planJson=./경기관제_클럽어드민__개선__3_.json \
 *     --out=./scripts/spec-input.json
 *
 * 출력  : scripts/spec-input.json  (genSuites.ts 의 입력)
 *
 * 주의  :
 *   - 기획서 JSON 구조가 다르면 PLAN_KEY_MAP 상수를 수정하세요.
 *   - route 공란인 화면은 route: "" 로 유지 → genSuites.ts 에서 TODO 주석 삽입.
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── CLI 인자 ───────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.replace('--', '').split('='); return [k, v ?? 'true']; })
);

const ROUTE_MAP_FILE = args['routeMap']  ?? path.resolve('scripts', 'route-map.json');
const PLAN_JSON_FILE = args['planJson']  ?? path.resolve('경기관제_클럽어드민__개선__3_.json');
const OUT_FILE       = args['out']       ?? path.resolve('scripts', 'spec-input.json');

// ── 기획서 JSON 키 매핑 ────────────────────────────────────
// [확인 필요: 실제 기획서 JSON 키명 확인 후 수정]
const PLAN_KEY_MAP = {
  id:      'id',        // 화면 고유 ID
  content: 'content',  // 화면명 or 메뉴명
  depth:   'depth',    // 계층 depth (0=GNB, 1=서브메뉴, 2=세부화면)
  parent:  'parent',   // 부모 메뉴명
  type:    'type',     // "screen" | "menu" | "tab" 등 (없으면 무시)
} as const;

// ── 타입 ──────────────────────────────────────────────────
interface RouteEntry {
  menu:   string;
  depth0: string;
  depth1: string;
  route:  string;
  file:   string;
}

interface PlanItem {
  [key: string]: unknown;
}

interface SpecScreen {
  id:       string;
  menu:     string;   // "대메뉴>서브메뉴" full path
  depth0:   string;
  depth1:   string;
  depth2:   string;   // 탭/세부화면 (있을 경우)
  route:    string;   // URL path ("" = 미확보)
  routeSource: 'analysis' | 'manual' | 'none';
  planId:   string;   // 기획서 원본 ID
  elements: unknown[];  // DOM 요소 (explore.spec.ts 결과, 이후 병합)
}

interface SpecParserInput {
  meta: {
    project:     string;
    generatedAt: string;
    totalScreens: number;
    routeCoverage: string;
  };
  screens: SpecScreen[];
}

// ── Route 맵 로드 ──────────────────────────────────────────
function loadRouteMap(file: string): Map<string, RouteEntry> {
  if (!fs.existsSync(file)) {
    console.warn(`[jsonToSpecParser] route-map.json 없음: ${file}`);
    console.warn('  → extractRoutes.ts 를 먼저 실행하세요.');
    return new Map();
  }
  const entries: RouteEntry[] = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const map = new Map<string, RouteEntry>();
  for (const e of entries) {
    map.set(normalizeMenuKey(e.menu), e);
  }
  console.log(`[jsonToSpecParser] Route 맵 로드: ${map.size}건`);
  return map;
}

// ── 메뉴명 정규화 (비교용) ─────────────────────────────────
function normalizeMenuKey(menu: string): string {
  return menu.replace(/\s+/g, '').toLowerCase();
}

// ── 기획서 JSON에서 화면 항목 추출 ────────────────────────
function extractScreens(planItems: PlanItem[]): Array<{
  planId: string; content: string; depth: number; parent: string;
}> {
  const screens: Array<{ planId: string; content: string; depth: number; parent: string }> = [];

  for (const item of planItems) {
    const id      = String(item[PLAN_KEY_MAP.id]      ?? '');
    const content = String(item[PLAN_KEY_MAP.content] ?? '').trim();
    const depth   = Number(item[PLAN_KEY_MAP.depth]   ?? 0);
    const parent  = String(item[PLAN_KEY_MAP.parent]  ?? '').trim();
    const type    = String(item[PLAN_KEY_MAP.type]    ?? '');

    // 빈 항목, GNB 구분선, "type=group" 등 제외
    if (!content || content === '-' || content === '—') continue;
    if (type === 'group' || type === 'divider')           continue;

    screens.push({ planId: id, content, depth, parent });
  }

  return screens;
}

// ── 부모-자식 관계로 full menu path 구성 ──────────────────
function buildMenuPath(
  item: { content: string; depth: number; parent: string },
  parentMap: Map<string, string>
): { depth0: string; depth1: string; depth2: string; menu: string } {
  const { content, depth, parent } = item;

  if (depth === 0) {
    return { depth0: content, depth1: '', depth2: '', menu: content };
  }
  if (depth === 1) {
    const d0 = parentMap.get(parent) ?? parent;
    return { depth0: d0, depth1: content, depth2: '', menu: `${d0}>${content}` };
  }
  // depth 2 이상 (탭, 세부화면)
  const d1menu = parent;
  return {
    depth0: parentMap.get(d1menu) ?? '',
    depth1: d1menu,
    depth2: content,
    menu:   `${parentMap.get(d1menu) ?? ''}>${d1menu}>${content}`,
  };
}

// ── 메인 ──────────────────────────────────────────────────
function main(): void {
  // 기획서 JSON 로드
  if (!fs.existsSync(PLAN_JSON_FILE)) {
    console.error(`[jsonToSpecParser] 기획서 JSON 없음: ${PLAN_JSON_FILE}`);
    console.error('  → 파일 경로를 --planJson=<경로> 로 지정하거나 D:\\Playwright 루트에 파일을 놓으세요.');
    process.exit(1);
  }

  const planRaw: PlanItem[] = JSON.parse(fs.readFileSync(PLAN_JSON_FILE, 'utf-8'));
  console.log(`[jsonToSpecParser] 기획서 JSON 로드: ${planRaw.length}행`);

  const routeMap = loadRouteMap(ROUTE_MAP_FILE);

  // depth0 부모 맵 구성 (depth1 → depth0 역조회용)
  const parentMap = new Map<string, string>(); // depth1 content → depth0 content
  let currentDepth0 = '';
  for (const item of planRaw) {
    const depth   = Number(item[PLAN_KEY_MAP.depth] ?? 0);
    const content = String(item[PLAN_KEY_MAP.content] ?? '').trim();
    if (!content) continue;
    if (depth === 0) { currentDepth0 = content; }
    if (depth === 1) { parentMap.set(content, currentDepth0); }
  }

  // 화면 항목 추출 + Route 조인
  const rawScreens = extractScreens(planRaw);
  const specScreens: SpecScreen[] = [];

  let routeHit  = 0;
  let routeMiss = 0;

  for (const s of rawScreens) {
    const { depth0, depth1, depth2, menu } = buildMenuPath(s, parentMap);
    const key   = normalizeMenuKey(menu);
    const entry = routeMap.get(key);

    let route: string        = '';
    let routeSource: SpecScreen['routeSource'] = 'none';

    if (entry?.route) {
      route       = entry.route;
      routeSource = 'analysis';
      routeHit++;
    } else {
      routeMiss++;
    }

    specScreens.push({
      id:          `screen-${String(specScreens.length + 1).padStart(3, '0')}`,
      menu,
      depth0,
      depth1,
      depth2,
      route,
      routeSource,
      planId:   s.planId,
      elements: [],
    });
  }

  // 출력
  const coverage = rawScreens.length > 0
    ? `${routeHit}/${rawScreens.length} (${Math.round(routeHit / rawScreens.length * 100)}%)`
    : '0/0';

  const output: SpecParserInput = {
    meta: {
      project:      'td17-admin-chromium',
      generatedAt:  new Date().toISOString(),
      totalScreens: specScreens.length,
      routeCoverage: coverage,
    },
    screens: specScreens,
  };

  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf-8');

  console.log('\n──────────────────────────────────────');
  console.log(`✅ spec-input.json 생성 완료: ${OUT_FILE}`);
  console.log(`   총 화면: ${specScreens.length}건`);
  console.log(`   Route 확보: ${routeHit}건 / 미확보: ${routeMiss}건 (커버리지 ${coverage})`);

  if (routeMiss > 0) {
    console.log('\n⚠️  Route 미확보 화면 목록:');
    specScreens
      .filter(s => !s.route)
      .forEach(s => console.log(`   - ${s.menu} (planId: ${s.planId})`));
    console.log('\n  → 해당 화면은 explore.spec.ts 로 덤프 후 extractRoutes.ts 재실행하거나');
    console.log('    spec-input.json 의 route 필드를 수동으로 채우세요.');
  }
}

main();
