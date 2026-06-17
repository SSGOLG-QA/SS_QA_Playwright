/**
 * scripts/extractRoutes.ts
 *
 * 목적  : D:\Playwright\analysis\*.json 파일을 순회하여
 *         { 메뉴명 → route } 매핑 테이블(route-map.json)을 생성한다.
 *
 * 실행  :
 *   npx ts-node scripts/extractRoutes.ts
 *   npx ts-node scripts/extractRoutes.ts --analysisDir=./analysis --out=./scripts/route-map.json
 *
 * 출력  : scripts/route-map.json
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── CLI 인자 파싱 ──────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.replace('--', '').split('=');
      return [k, v ?? 'true'];
    })
);

const ANALYSIS_DIR = args['analysisDir'] ?? path.resolve('analysis');
const OUT_FILE     = args['out']         ?? path.resolve('scripts', 'route-map.json');

// ── 타입 ──────────────────────────────────────────────────
interface AnalysisJson {
  menu?: string;   // "관제 관리>아이콘 관리"
  url?:  string;   // "/club/page/icon-mgmt"  ← 핵심
  [key: string]: unknown;
}

interface RouteEntry {
  menu:     string;   // GNB > 서브메뉴 full path
  depth0:   string;   // 대메뉴
  depth1:   string;   // 서브메뉴 (없으면 "")
  route:    string;   // URL path
  file:     string;   // 원본 파일명
}

// ── 파일명에서 메뉴 추정 (menu 필드 없을 때 폴백) ──────────
function menuFromFilename(filename: string): string {
  // 예: "관제_관리_아이콘_관리.json" → "관제 관리>아이콘 관리"
  const base  = path.basename(filename, '.json');
  const parts = base.split('_');

  // 언더스코어 2개 이상인 경우: 앞 2토큰 = 대메뉴, 나머지 = 서브메뉴
  // 예외: "Home", "_langgap_*", "_census_*", "_popup_*" → 특수 파일
  if (base.startsWith('_') || base === 'Home') return base;

  // "경기진행관리_진행시간_표준설정" → 3토큰
  // 파일명 규칙: {대메뉴(공백→_)}_{서브메뉴1(공백→_)}_{서브메뉴2?}.json
  // 대메뉴는 2단어인 경우 토큰 2개 사용 (예: 관제_관리, 홀맵_관리 등)
  // → 대메뉴 끝을 찾는 휴리스틱: "관리", "관제", "운영" 등으로 끝나는 위치
  const DEPTH0_ENDINGS = ['관리', '운영', '관제', '통계', '현황'];

  let splitIdx = 1; // 기본: 첫 토큰이 대메뉴
  for (let i = 1; i < parts.length; i++) {
    if (DEPTH0_ENDINGS.some(e => parts[i].endsWith(e))) {
      splitIdx = i;
      break;
    }
  }

  const depth0 = parts.slice(0, splitIdx + 1).join(' ');
  const depth1 = parts.slice(splitIdx + 1).join(' ');

  return depth1 ? `${depth0}>${depth1}` : depth0;
}

// ── 메인 ──────────────────────────────────────────────────
function main(): void {
  if (!fs.existsSync(ANALYSIS_DIR)) {
    console.error(`[extractRoutes] analysis 폴더를 찾을 수 없습니다: ${ANALYSIS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(ANALYSIS_DIR)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  console.log(`[extractRoutes] 처리 대상 파일: ${files.length}개\n`);

  const entries: RouteEntry[]  = [];
  const skipped: string[]      = [];
  const noRoute:  string[]     = [];

  for (const file of files) {
    const fullPath = path.join(ANALYSIS_DIR, file);

    let data: AnalysisJson;
    try {
      data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    } catch {
      console.warn(`  ⚠️  파싱 실패: ${file}`);
      skipped.push(file);
      continue;
    }

    // 특수 파일 스킵 (Home, census, popup 등)
    if (file === 'Home.json' || file.startsWith('_')) {
      console.log(`  ⏭️  스킵(특수): ${file}`);
      skipped.push(file);
      continue;
    }

    const menu   = data.menu ?? menuFromFilename(file);
    const url    = data.url  ?? '';
    const parts  = menu.split('>');
    const depth0 = parts[0]?.trim() ?? '';
    const depth1 = parts[1]?.trim() ?? '';

    if (!url) {
      console.warn(`  ❌ Route 없음: ${file} (menu: ${menu})`);
      noRoute.push(file);
    } else {
      console.log(`  ✅ ${menu.padEnd(28)} → ${url}`);
    }

    entries.push({ menu, depth0, depth1, route: url, file });
  }

  // 대메뉴 → 서브메뉴 순으로 정렬
  entries.sort((a, b) => {
    const cmp0 = a.depth0.localeCompare(b.depth0, 'ko');
    return cmp0 !== 0 ? cmp0 : a.depth1.localeCompare(b.depth1, 'ko');
  });

  // 출력
  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(OUT_FILE, JSON.stringify(entries, null, 2), 'utf-8');

  // 결과 요약
  console.log('\n──────────────────────────────────────');
  console.log(`✅ route-map.json 생성 완료: ${OUT_FILE}`);
  console.log(`   총 ${entries.length}건 / Route 확보 ${entries.filter(e => e.route).length}건`);

  if (noRoute.length) {
    console.log(`\n⚠️  Route 미확보 파일 ${noRoute.length}건 (수동 보완 필요):`);
    noRoute.forEach(f => console.log(`   - ${f}`));
  }
  if (skipped.length) {
    console.log(`\n⏭️  스킵 ${skipped.length}건: ${skipped.join(', ')}`);
  }
}

main();
