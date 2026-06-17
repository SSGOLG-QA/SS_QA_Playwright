/**
 * scripts/genSuites.ts
 *
 * 목적  : spec-input.json(SpecParser 호환 포맷)을 읽어
 *         lib/suites.ts 에 append할 run*() 함수 초안을 자동 생성한다.
 *
 * 실행  :
 *   npx ts-node scripts/genSuites.ts
 *   npx ts-node scripts/genSuites.ts \
 *     --input=./scripts/spec-input.json \
 *     --out=./scripts/suites.generated.ts \
 *     --append                             # lib/suites.ts 에 직접 append (주의)
 *
 * 출력  :
 *   scripts/suites.generated.ts  — 검토 후 lib/suites.ts 에 병합
 *   (--append 지정 시 lib/suites.ts 에 직접 추가)
 *
 * 비파괴 원칙 :
 *   생성된 run*() 함수는 읽기 전용 검증(check/checkText)만 포함한다.
 *   저장·삭제·적용 등 데이터 변경 동작은 주석으로만 표시한다.
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── CLI 인자 ───────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.replace('--', '').split('='); return [k, v ?? 'true']; })
);

const INPUT_FILE  = args['input']  ?? path.resolve('scripts', 'spec-input.json');
const OUT_FILE    = args['out']    ?? path.resolve('scripts', 'suites.generated.ts');
const DO_APPEND   = args['append'] === 'true';
const SUITES_FILE = path.resolve('lib', 'suites.ts');

// ── 타입 ──────────────────────────────────────────────────
interface SpecScreen {
  id:       string;
  menu:     string;
  depth0:   string;
  depth1:   string;
  depth2:   string;
  route:    string;
  routeSource: string;
  planId:   string;
}

interface SpecParserInput {
  meta:    { project: string; generatedAt: string; totalScreens: number; routeCoverage: string };
  screens: SpecScreen[];
}

// ── 함수名 생성 ────────────────────────────────────────────
// "관제 관리>아이콘 관리" → "runIconMgmt"
function toFunctionName(menu: string): string {
  const KO_MAP: Record<string, string> = {
    '홈':          'Home',
    '라운드관리':   'RoundMgmt',
    '라운드 관리':  'RoundMgmt',
    '관제관리':     'MonitorMgmt',
    '관제 관리':    'MonitorMgmt',
    '태블릿운영관리': 'TabletOps',
    '태블릿 운영 관리': 'TabletOps',
    '홀맵관리':     'HolemapMgmt',
    '홀맵 관리':    'HolemapMgmt',
    '코스운영관리':  'CourseOps',
    '코스 운영 관리': 'CourseOps',
    '경기진행관리':  'GameProgress',
    '경기 진행 관리': 'GameProgress',
    '캐디관리':     'CaddieMgmt',
    '캐디 관리':    'CaddieMgmt',
    '캐디피관리':   'CaddieFeeMgmt',
    '캐디피 관리':  'CaddieFeeMgmt',
    '배토관리':     'BetoMgmt',
    '배토 관리':    'BetoMgmt',
    '식음관리':     'FoodMgmt',
    '식음 관리':    'FoodMgmt',
    '대회':        'Tournament',
    '대회관리':     'TournamentMgmt',
    '대회 관리':    'TournamentMgmt',
    '고객평가관리':  'CustomerEval',
    '고객 평가 관리': 'CustomerEval',
    '계정관리':     'AccountMgmt',
    '계정 관리':    'AccountMgmt',
    // 서브메뉴
    '내장현황':     'CensusStatus',
    '내장 현황':    'CensusStatus',
    '내장통계':     'CensusStats',
    '내장 통계':    'CensusStats',
    '전체라운드':   'AllRounds',
    '전체 라운드':  'AllRounds',
    '라운드설정':   'RoundSettings',
    '라운드 설정':  'RoundSettings',
    '홀별정산관리': 'HoleSettlement',
    '홀별 정산 관리': 'HoleSettlement',
    '카트관리':     'CartMgmt',
    '카트 관리':    'CartMgmt',
    '단체라운드':   'GroupRound',
    '단체 라운드':  'GroupRound',
    '아이콘관리':   'IconMgmt',
    '아이콘 관리':  'IconMgmt',
    '라이브채팅공지조회': 'LiveChatNotice',
    '라이브채팅 공지 조회': 'LiveChatNotice',
    '메시지기록조회': 'MsgHistory',
    '메시지 기록 조회': 'MsgHistory',
    '관제모니터':   'MonitorScreen',
    '관제 모니터':  'MonitorScreen',
    '카트이동경로확인': 'CartTrace',
    '카트 이동경로 확인': 'CartTrace',
    '태블릿기능설정': 'TabletFeature',
    '태블릿 기능 설정': 'TabletFeature',
    '메시지관리':   'MsgMgmt',
    '메시지 관리':  'MsgMgmt',
    '홀이벤트관리': 'HoleEvent',
    '홀 이벤트 관리': 'HoleEvent',
    '홀맵구역설정': 'HolemapZone',
    '홀맵 구역 설정': 'HolemapZone',
    '카트패스진입여부설정': 'CartPathEntry',
    '카트패스 진입여부 설정': 'CartPathEntry',
    '티샷유의거리설정': 'TeeDistance',
    '티샷 유의 거리 설정': 'TeeDistance',
    '홀맵미리보기': 'HolemapPreview',
    '홀맵 미리보기': 'HolemapPreview',
    '핀포지션관리': 'PinPosMgmt',
    '핀 포지션 관리': 'PinPosMgmt',
    '핀포지션변경이력': 'PinPosHistory',
    '핀 포지션 변경이력': 'PinPosHistory',
    '핀포지션분석': 'PinPosAnalysis',
    '핀 포지션 분석': 'PinPosAnalysis',
    '코스분석':     'CourseAnalysis',
    '코스 분석':    'CourseAnalysis',
    '그린스피드':   'GreenSpeed',
    '골프장소식':   'ClubNews',
    '골프장 소식':  'ClubNews',
    '진행시간표준설정': 'TimeStandard',
    '진행시간 표준설정': 'TimeStandard',
    '진행시간실시간': 'TimeRealtime',
    '진행시간 실시간': 'TimeRealtime',
    '진행시간조회': 'TimeQuery',
    '진행시간 조회': 'TimeQuery',
    '진행시간통계': 'TimeStats',
    '진행시간 통계': 'TimeStats',
    '캐디리스트':   'CaddieList',
    '캐디 리스트':  'CaddieList',
    '캐디등록관리': 'CaddieReg',
    '캐디 등록 관리': 'CaddieReg',
    '캐디실적':     'CaddiePerf',
    '캐디 실적':    'CaddiePerf',
    '배토통계':     'BetoStats',
    '배토 통계':    'BetoStats',
    '배토기록조회': 'BetoRecord',
    '배토 기록 조회': 'BetoRecord',
    '버전및설정':   'FoodSettings',
    '버전 및 설정': 'FoodSettings',
    '상품등록관리': 'ProductMgmt',
    '상품 등록 관리': 'ProductMgmt',
    '식당관리':     'RestaurantMgmt',
    '식당 관리':    'RestaurantMgmt',
    '주문내역관리': 'OrderHistory',
    '주문 내역 관리': 'OrderHistory',
    '고객평가':     'CustomerEvalList',
    '고객 평가':    'CustomerEvalList',
    '캐디평가':     'CaddieEval',
    '캐디 평가':    'CaddieEval',
    '후기리스트':   'ReviewList',
    '후기 리스트':  'ReviewList',
    '후기통계':     'ReviewStats',
    '후기 통계':    'ReviewStats',
    '계정리스트':   'AccountList',
    '계정 리스트':  'AccountList',
    '계정권한관리': 'AccountPermission',
    '계정 권한 관리': 'AccountPermission',
  };

  const parts  = menu.split('>').map(p => p.trim());
  const suffix = parts[parts.length - 1];
  const mapped = KO_MAP[suffix] ?? suffix;

  // 매핑 없으면 한글 제거 후 PascalCase 시도
  const cleaned = mapped
    .replace(/[가-힣]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace(/^[a-z]/, c => c.toUpperCase())
    || suffix.replace(/\s+/g, '');

  return `run${cleaned}`;
}

// ── 함수 코드 생성 ────────────────────────────────────────
function generateFunction(screen: SpecScreen, existingNames: Set<string>): string {
  const fnName  = toFunctionName(screen.menu);
  const menuStr = screen.menu.replace(/'/g, "\\'");
  const hasRoute = !!screen.route;

  // 중복 함수명 방지
  let finalName = fnName;
  let suffix    = 2;
  while (existingNames.has(finalName)) {
    finalName = `${fnName}_${suffix++}`;
  }
  existingNames.add(finalName);

  const routeComment = hasRoute
    ? `// route: '${screen.route}'`
    : `// TODO: [확인 필요: route 미확보 — explore.spec.ts 덤프 후 채울 것]`;

  const todoBlock = !hasRoute
    ? `\n  // TODO: gotoMenu 실행 전 route 를 spec-input.json 에서 채우세요.`
    : '';

  return `
/**
 * ${screen.menu}
 * planId: ${screen.planId || '—'}
 * ${routeComment}
 * 생성: genSuites.ts (자동 생성 초안 — 수동 검토 필요)
 */
export async function ${finalName}(page: Page, report: ReportRow[]): Promise<void> {
  const menu = '${menuStr}';
  ${todoBlock}
  // ── 메뉴 진입 ────────────────────────────────────────────
  await gotoMenu(page, menu);

  // ── 화면 진입 확인 ────────────────────────────────────────
  // TODO: 실제 화면 진입 판정 로케이터로 교체
  await page.waitForLoadState('networkidle');

  // ── UI 요소 검증 (비파괴 원칙: 읽기 전용만) ───────────────
  // TODO: analysis JSON 기반 locator 문서 참고하여 check() 호출 추가
  // 예시:
  //   check(report, menu, '목록 테이블', await page.locator('table').isVisible());
  //   checkText(report, menu, '페이지 타이틀', page.locator('h2'), '${screen.depth1 || screen.depth0}');
  //
  // ⚠️  저장·삭제·적용·변경 버튼은 노출/활성 여부만 확인 (클릭 금지)

  report.push({ menu, status: 'SKIP', note: '자동 생성 초안 — 검증 로직 미작성' });
}
`;
}

// ── 메인 ──────────────────────────────────────────────────
function main(): void {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`[genSuites] spec-input.json 없음: ${INPUT_FILE}`);
    console.error('  → jsonToSpecParser.ts 를 먼저 실행하세요.');
    process.exit(1);
  }

  const input: SpecParserInput = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`[genSuites] spec-input.json 로드: ${input.screens.length}화면`);
  console.log(`[genSuites] Route 커버리지: ${input.meta.routeCoverage}`);

  const existingNames = new Set<string>();
  const blocks: string[] = [];

  // 헤더
  blocks.push(`// ============================================================
// AUTO-GENERATED by genSuites.ts
// 생성일: ${new Date().toISOString()}
// 원본:   ${INPUT_FILE}
// Route 커버리지: ${input.meta.routeCoverage}
//
// ⚠️  이 파일은 초안입니다. lib/suites.ts 에 병합 전 반드시 검토하세요.
//    - TODO 주석: 검증 로직 작성 필요
//    - route 공란: explore.spec.ts 덤프 후 채울 것
//    - 비파괴 원칙: 저장·삭제·적용 클릭 금지
// ============================================================
import { type Page } from '@playwright/test';
import { gotoMenu, check, checkText, diff } from './helpers'; // [확인 필요: 실제 import 경로]
import { type ReportRow } from './reporter';                   // [확인 필요: 실제 import 경로]
`);

  // 대메뉴별 그룹 코멘트 + 함수 생성
  let currentDepth0 = '';
  for (const screen of input.screens) {
    if (screen.depth0 !== currentDepth0) {
      currentDepth0 = screen.depth0;
      blocks.push(`\n// ── ${currentDepth0} ${'─'.repeat(Math.max(0, 44 - currentDepth0.length))}`);
    }
    blocks.push(generateFunction(screen, existingNames));
  }

  // 통계
  const noRoute = input.screens.filter(s => !s.route).length;
  blocks.push(`
// ── 생성 통계 ──────────────────────────────────────────────
// 총 함수: ${input.screens.length}개
// Route 확보: ${input.screens.length - noRoute}개 / 미확보: ${noRoute}개
// Route 미확보 목록:
${input.screens.filter(s => !s.route).map(s => `//   - ${s.menu}`).join('\n') || '//   (없음)'}
`);

  const output = blocks.join('\n');

  // 파일 저장
  const outDir = path.dirname(OUT_FILE);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT_FILE, output, 'utf-8');

  console.log(`\n✅ suites.generated.ts 생성 완료: ${OUT_FILE}`);
  console.log(`   함수 ${input.screens.length}개 생성`);

  // --append 옵션
  if (DO_APPEND) {
    if (!fs.existsSync(SUITES_FILE)) {
      console.error(`[genSuites] lib/suites.ts 없음: ${SUITES_FILE} — append 스킵`);
    } else {
      const existing = fs.readFileSync(SUITES_FILE, 'utf-8');
      // 이미 AUTO-GENERATED 블록이 있으면 교체, 없으면 append
      const marker = '// AUTO-GENERATED by genSuites.ts';
      if (existing.includes(marker)) {
        const idx     = existing.indexOf(marker);
        const updated = existing.slice(0, idx) + output;
        fs.writeFileSync(SUITES_FILE, updated, 'utf-8');
        console.log(`✅ lib/suites.ts 기존 AUTO-GENERATED 블록 교체 완료`);
      } else {
        fs.appendFileSync(SUITES_FILE, '\n\n' + output, 'utf-8');
        console.log(`✅ lib/suites.ts 에 append 완료`);
      }
    }
  } else {
    console.log(`\n다음 단계:`);
    console.log(`  1. ${OUT_FILE} 검토`);
    console.log(`  2. lib/suites.ts 에 필요한 함수만 선택적으로 병합`);
    console.log(`  3. 또는: npx ts-node scripts/genSuites.ts --append 로 전체 append`);
  }
}

main();
