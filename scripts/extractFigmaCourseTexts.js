/* eslint-disable */
// ──────────────────────────────────────────────────────────────
//  Figma(코스관리 1.1 기획서) → checkText 매핑 추출기.
//  목적: 설계 정본(Figma) 텍스트를 근거로, 인벤토리의 정적 UI 텍스트(안내문구·타이틀·섹션라벨)만
//        선별 → checkText 검증 대상 매핑 산출. 데이터 인스턴스(인명·거래처·날짜·수치)는 Figma 미존재로 자동 배제.
//  입력: slim_layers.json (Figma REST 추출 슬림 트리 — TEXT 노드 .characters)
//        baselines/course-components.<sub>.json (인벤토리 = 화면별 구성요소, 커버리지 분모)
//  산출: baselines/course-figma-texts.<sub>.json  { "화면키": [{kind,label,tab,via}], _meta:{...} }
//  실행: node scripts/extractFigmaCourseTexts.js  (기본 FIGMA_JSON 경로 사용, env로 재지정 가능)
//    $env:FIGMA_JSON="D:/Py/Figma 추출/통합/dist/output/20260821_081015/slim_layers.json"
//  ⚠ 매칭 규칙(투명):
//    - eq   : 인벤토리 라벨 == Figma 텍스트(공백무시)  → 설계 문구/라벨 정확 일치.
//    - sub  : 인벤토리 라벨(≥5자)이 어떤 Figma 텍스트에 포함 → 안내문구 잘림/부분(인벤토리 44자 truncation 대응).
//    - super: 어떤 Figma 텍스트(≥6자)가 인벤토리 라벨에 포함 → 라벨이 설계 문구의 연결(섹션 헤더 등).
//    - 데이터 패턴(날짜·순수숫자·통화·등급·W-id)은 Figma 일치와 무관하게 제외(정직한 정적요소만).
// ──────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SUB = process.env.COURSE_SUBDOMAIN || 'course-mng-td';
const ROOT = process.cwd();
const DEFAULT_FIGMA = 'D:/Py/Figma 추출/통합/dist/output/20260821_081015/slim_layers.json';
const FIGMA_JSON = process.env.FIGMA_JSON || DEFAULT_FIGMA;
const invPath = path.join(ROOT, 'baselines', `course-components.${SUB}.json`);
const outPath = path.join(ROOT, 'baselines', `course-figma-texts.${SUB}.json`);

const norm = (s) => (s || '').replace(/\s+/g, '').trim();
// 정적 UI 텍스트 후보 kind (표시 문구/제목/섹션). 데이터·컨트롤 kind는 대상 아님.
const KINDS = new Set(['text', 'title', 'section']);
// 순수 데이터 패턴(날짜·숫자·통화·등급·주간ID) — Figma 일치와 무관하게 제외.
const isData = (t) => {
  const s = (t || '').trim();
  return /^\d/.test(s)
    || /^\(?\d{4}[-.]\d/.test(s)
    || /^[\d.,\/%\s원건명개점일m²-]+$/.test(s)
    || /^W-\d+$/.test(s)
    || /^[A-F][+-]?$/.test(s)
    || /^\d{2}\.\d{2}$/.test(s);
};

function main() {
  if (!fs.existsSync(FIGMA_JSON)) {
    console.error(`[figma-extract] ✗ Figma JSON 없음: ${FIGMA_JSON}\n  FIGMA_JSON env 로 경로를 지정하세요.`);
    process.exit(1);
  }
  if (!fs.existsSync(invPath)) {
    console.error(`[figma-extract] ✗ 인벤토리 없음: ${invPath}\n  먼저 npm run course:inventory 로 생성하세요.`);
    process.exit(1);
  }
  const fig = JSON.parse(fs.readFileSync(FIGMA_JSON, 'utf8'));
  const figNorm = new Set();
  const figList = [];
  (function walk(n) {
    if (n && n.type === 'TEXT' && n.characters) { figList.push(n.characters); figNorm.add(norm(n.characters)); }
    (n && n.children || []).forEach(walk);
  })(fig);
  const figBlob = figList.map(norm).join('\u0001');

  const inFigma = (label) => {
    const nl = norm(label);
    if (nl.length < 2) return false;
    if (figNorm.has(nl)) return 'eq';
    if (nl.length >= 5 && figBlob.includes(nl)) return 'sub';
    if (nl.length >= 6) { for (const f of figNorm) { if (f.length >= 6 && nl.includes(f)) return 'super'; } }
    return false;
  };

  const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
  const out = {};
  let cand = 0, exclData = 0, hit = 0;
  const viaC = { eq: 0, sub: 0, super: 0 };
  for (const scr of Object.keys(inv)) {
    for (const c of (inv[scr] || [])) {
      if (!KINDS.has(c.kind)) continue;
      cand++;
      if (isData(c.label)) { exclData++; continue; }
      const via = inFigma(c.label);
      if (!via) continue;
      hit++; viaC[via]++;
      (out[scr] = out[scr] || []).push({ kind: c.kind, label: c.label, tab: c.tab || '', via });
    }
  }
  out._meta = {
    generated: new Date().toISOString(),
    figmaSource: FIGMA_JSON,
    figmaTextNodes: figList.length,
    figmaUniqueNorm: figNorm.size,
    inventory: path.basename(invPath),
    candidates: cand,
    excludedData: exclData,
    matched: hit,
    via: viaC,
    screens: Object.keys(out).filter((k) => k !== '_meta').length,
    note: '인벤토리 text/title/section 중 Figma 설계에 실재하는 정적 UI 텍스트만 선별(데이터 인스턴스 배제). checkText 대상.',
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`[figma-extract] Figma 텍스트노드 ${figList.length} (고유 ${figNorm.size})`);
  console.log(`[figma-extract] 인벤토리 정적텍스트 후보 ${cand} · 데이터배제 ${exclData} · Figma확정 ${hit} (eq ${viaC.eq}·sub ${viaC.sub}·super ${viaC.super})`);
  console.log(`[figma-extract] 화면 ${out._meta.screens}개 → ${path.relative(ROOT, outPath)}`);
}
main();
