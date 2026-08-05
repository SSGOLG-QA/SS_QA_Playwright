/**
 * SKIP 투명화 감사 — 검증 스위트 전체의 skip() 호출 지점을 정적 스캔하여
 *   "무엇이 실제로 검증되지 않는가"를 가시화한다.
 *
 *  배경: reporter의 skip()은 실패가 아니라 '해당 케이스 미수행'을 기록한다.
 *    데이터 부재로 SKIP된 케이스는 리포트에서 PASS와 섞이지 않지만,
 *    "SKIP=검증 안 함"이 누적되면 커버리지가 실제보다 높아 보이는 착시가 생긴다.
 *    이 스크립트는 SKIP 사유를 3분류로 나눠 '잠재 커버리지 구멍'을 분리 집계한다.
 *
 *  분류:
 *    - LEGIT   (의도적 비검증): 미구현·범위제외·자동화 부적합·수동확인·파괴가드·비파괴·
 *                                기능제거·가변데이터 제외 등 → 정상. 자동화 대상 아님/영구 불가.
 *    - ENV     (환경/런타임):   메뉴 진입 불가·언어 전환 실패·토스트 미출현 등
 *                                → 조건부 가드가 런타임 실패로 발동. 플레이크 또는 실제 파손 신호.
 *    - DATA    (데이터 부재):   행 0건·데이터 없음·미노출·미오픈 등
 *                                → 잠재 커버리지 구멍. 데이터가 있으면 검증됐을 케이스.
 *    - OTHER   (미분류):        위 키워드에 안 걸린 사유 → 사람이 확인 필요.
 *
 *  실행: npm run audit:skip
 *  산출: 콘솔 요약 + reports/skip-audit_<ts>.md
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOTS = ['lib', 'Admin'];
const REPORTS = 'reports';

type Cls = 'LEGIT' | 'ENV' | 'DATA' | 'OTHER';

interface Hit {
  file: string;
  line: number;
  fn: string;        // 근접 상위 함수/테스트명
  tcId: string;
  desc: string;
  path: string;
  reason: string;
  cls: Cls;
}

// 정당(의도적 비검증) 키워드 — 최우선 판정
const LEGIT_RE = /부적합|범위\s*제외|미구현|별도\s*프로젝트|고도화|수동|window\.open|지도|재생|편집|알림 자동|자동 핸들러|파괴|가드|비파괴|보류|DYNAMIC_SKIP|가변\s*데이터|제거|N\/A/;
// 환경/런타임 조건 키워드 — LEGIT 다음 우선
const ENV_RE = /전환\s*실패|진입\s*불가|미출현|충돌|상호작용\s*불가/;
// 데이터 부재(잠재 커버리지 구멍) 키워드
const DATA_RE = /데이터\s*없음|데이터\s*의존|0\s*건|행\s*없음|미노출|미검출|미오픈|조회\s*결과\s*0|빈\s*상태|없음|미발생|사전조건|미충족|미선택/;

function classify(reason: string): Cls {
  if (LEGIT_RE.test(reason)) return 'LEGIT';
  if (ENV_RE.test(reason)) return 'ENV';
  if (DATA_RE.test(reason)) return 'DATA';
  return 'OTHER';
}

function listSources(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) { out.push(...listSources(full)); continue; }
    if (!/\.ts$/.test(name)) continue;
    if (/_probe|_verify/.test(name)) continue;      // 스크래치/진단 스펙 제외
    out.push(full);
  }
  return out;
}

const FN_RE = /(?:export\s+)?(?:async\s+)?function\s+(run[A-Za-z0-9_]+)/;
const TEST_RE = /^\s*test(?:\.\w+)?\(\s*['"`]([^'"`]+)['"`]/;

function field(src: string, key: string): string {
  // tcId: 'X' | tcId: "X" | tcId: `X`
  const m = src.match(new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`));
  return m ? m[1] : '';
}

function extractReason(src: string): string {
  // skip({...}, '이유')  또는  skip({...}, `이유`) — 메타 객체 뒤 첫 문자열
  const m = src.match(/\}\s*,\s*['"`]([^'"`]*)['"`]\s*\)/);
  return m ? m[1] : '';
}

function scanFile(file: string): Hit[] {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const hits: Hit[] = [];
  let fn = '(top)';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(FN_RE);
    if (fm) fn = fm[1];
    else { const tm = line.match(TEST_RE); if (tm) fn = `test: ${tm[1]}`; }

    const idx = line.indexOf('skip(');
    if (idx < 0) continue;
    // reporter의 skip() 만 대상 — test.skip / page.skip 등 배제
    const pre = line.slice(Math.max(0, idx - 1), idx);
    if (pre === '.') continue;

    // 단일 라인에서 못 찾으면 다음 3줄까지 합쳐 파싱(멀티라인 대비)
    let src = line;
    for (let k = 1; k <= 3 && !/\}\s*,\s*['"`]/.test(src); k++) src += ' ' + (lines[i + k] ?? '');

    const reason = extractReason(src);
    if (!reason) continue;              // skip 호출이지만 사유 문자열 미검출 → 스킵
    hits.push({
      file, line: i + 1, fn,
      tcId: field(src, 'tcId'),
      desc: field(src, 'desc'),
      path: field(src, 'path'),
      reason,
      cls: classify(reason),
    });
  }
  return hits;
}

function main() {
  const files = ROOTS.flatMap(listSources);
  const hits: Hit[] = files.flatMap(scanFile);

  const by = (c: Cls) => hits.filter(h => h.cls === c);
  const legit = by('LEGIT'), env = by('ENV'), data = by('DATA'), other = by('OTHER');

  console.log(`\n[SKIP 감사] 총 ${hits.length}건  ·  LEGIT ${legit.length} · ENV ${env.length} · DATA ${data.length} · OTHER ${other.length}`);
  console.log(`  🕳  잠재 커버리지 구멍(DATA): ${data.length}건 — 데이터/시드가 있으면 검증됐을 케이스`);
  if (env.length) console.log(`  ⚙  환경/런타임(ENV): ${env.length}건 — 진입/전환 실패 등, 플레이크 또는 실제 파손 신호`);
  if (other.length) console.log(`  ❓ 미분류(OTHER): ${other.length}건 — 사유 키워드 확인 필요`);

  const fmt = (h: Hit) => `- \`${path.basename(h.file)}:${h.line}\` · **${h.tcId || '-'}** · ${h.fn}\n    - ${h.desc || h.path || ''}\n    - 사유: ${h.reason}`;

  // DATA를 화면(path 접두)별로 묶어 커버리지 구멍이 어느 화면에 몰렸는지 표시
  const dataByScreen: Record<string, number> = {};
  data.forEach(h => {
    // path가 정적 문자열이면 대메뉴(첫 세그먼트), 템플릿 변수(${...})/공란이면 함수명으로 폴백
    const s = (h.path && !h.path.includes('${'))
      ? (h.path.split('>')[0] || h.file).trim()
      : (h.fn !== '(top)' ? h.fn : path.basename(h.file));
    dataByScreen[s] = (dataByScreen[s] || 0) + 1;
  });
  const screenRank = Object.entries(dataByScreen).sort((a, b) => b[1] - a[1]);

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const md = [
    `# SKIP 투명화 감사 — ${ts}`, ``,
    `> reporter \`skip()\` 호출 정적 스캔. SKIP=미검증이 커버리지 착시를 만들지 않도록 사유별 분류.`, ``,
    `## 요약`, ``,
    `| 분류 | 건수 | 의미 |`,
    `|------|-----:|------|`,
    `| **LEGIT** (의도적 비검증) | ${legit.length} | 미구현·범위제외·자동화 부적합·파괴가드·비파괴 — 정상 |`,
    `| **ENV** (환경/런타임) | ${env.length} | ⚙ 진입/전환 실패·토스트 미출현 — 플레이크 또는 실제 파손 신호 |`,
    `| **DATA** (데이터 부재) | ${data.length} | 🕳 잠재 커버리지 구멍 — 데이터/시드가 있으면 검증됐을 케이스 |`,
    `| **OTHER** (미분류) | ${other.length} | ❓ 사유 키워드 확인 필요 |`,
    `| 합계 | ${hits.length} | |`, ``,
    `## 🕳 잠재 커버리지 구멍 — 화면별 집계 (DATA)`, ``,
    ...(screenRank.length ? screenRank.map(([s, n]) => `- ${s} — ${n}건`) : ['- 없음']), ``,
    `## 🕳 DATA (${data.length}) — 데이터 부재로 미검증`, ``,
    ...(data.length ? data.map(fmt) : ['- 없음']), ``,
    `## ⚙ ENV (${env.length}) — 환경/런타임 조건`, ``,
    ...(env.length ? env.map(fmt) : ['- 없음']), ``,
    `## ❓ OTHER (${other.length}) — 미분류`, ``,
    ...(other.length ? other.map(fmt) : ['- 없음']), ``,
    `## ✅ LEGIT (${legit.length}) — 의도적 비검증(참고)`, ``,
    ...(legit.length ? legit.map(fmt) : ['- 없음']),
  ].join('\n');

  if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS, { recursive: true });
  const outPath = path.join(REPORTS, `skip-audit_${ts}.md`);
  fs.writeFileSync(outPath, md);
  console.log(`[report] ${outPath}\n`);
}

main();
