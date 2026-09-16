// Risk 기반 Action 선택 — past-defects.json(QA-15289 PC) + 미방문/데이터변경/API 기준으로 트리거 우선순위 산출.
//   목표: Coverage가 아니라 **결함 발견 가능성이 높은 행동 우선**. 연관 Jira key를 함께 부착(회귀 추적성).
import * as fs from 'fs';
import * as path from 'path';
import type { ActionKind } from './types';

interface PastDefect { key: string; feature: string; summary: string; primaryPattern: string; patterns: string[]; }
interface PastDefects { defects: PastDefect[]; }

// 고위험 패턴(탐색 우선순위 부스트 대상 — UI 문구차이 제외).
const HV_PATTERNS = new Set(['STATE_TRANSITION_DATA_LOSS', 'API_ERROR', 'SAVE_EDIT_ORDER', 'SEARCH_FILTER_STATE_RESET', 'BOUNDARY_VALIDATION', 'CALC_CONSISTENCY']);

export function loadPastDefects(): PastDefects {
  try {
    const p = path.join(process.cwd(), 'Course', 'exploration', 'knowledge', 'past-defects.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { defects: Array.isArray(j.defects) ? j.defects : [] };
  } catch { return { defects: [] }; }
}

export interface RiskScore { score: number; reasons: string[]; jiraKeys: string[]; }

// 트리거 라벨 → 액션 종류(간이). frontier와 동일 어휘.
function kindOf(label: string): ActionKind {
  if (/검색/.test(label)) return 'search';
  if (/조회/.test(label)) return 'search';
  if (/신규|등록|추가|생성/.test(label)) return 'openModal';
  if (/편집|수정|설정|관리/.test(label)) return 'openModal';
  if (/보기|상세|현황|내역|미리보기/.test(label)) return 'view';
  return 'view';
}
const BASE: Partial<Record<ActionKind, number>> = { view: -1, search: 1, openModal: 1, save: 3, submit: 3, delete: 3, reset: 0, nav: -2 };
const norm = (s: string): string => (s || '').replace(/\s+/g, '');

// 과거결함 매칭 부스트 — 현재 화면(feature/sub) 결함 밀집도 + 라벨 연관 + 고위험 패턴.
function matchBoost(feature: string, sub: string, label: string, pd: PastDefects): { boost: number; keys: string[]; reasons: string[] } {
  const nf = norm(feature); const ns = norm(sub);
  const defs = pd.defects.filter((d) => { const df = norm(d.feature); return df === ns || df === nf || df.includes(ns) || ns.includes(df); });
  if (!defs.length) return { boost: 0, keys: [], reasons: [] };
  const reasons: string[] = [`${sub} 과거결함 ${defs.length}건(회귀 위험 화면)`];
  let boost = Math.min(3, Math.ceil(defs.length / 8));   // 화면 hotspot(결함 많을수록 ↑, 최대 3)
  // 라벨 키워드가 결함 요약에 등장 → 직접 연관.
  const kw = norm(label);
  const labelHits = kw.length >= 2 ? defs.filter((d) => norm(d.summary).includes(kw)) : [];
  const keys = labelHits.slice(0, 3).map((d) => d.key);
  if (labelHits.length) { boost += 2; reasons.push(`'${label}' 연관 결함 ${labelHits.length}건 [${keys.join(', ')}]`); }
  // 고위험 패턴 존재 → +1.
  const hv = Array.from(new Set(defs.flatMap((d) => d.patterns).filter((p) => HV_PATTERNS.has(p))));
  if (hv.length) { boost += 1; reasons.push(`고위험 패턴 ${hv.slice(0, 4).join('/')}`); }
  return { boost: Math.min(boost, 6), keys, reasons };
}

export interface ScoreCtx { unvisited: boolean; visits: number; destructive?: boolean; apiLikely?: boolean; }
export function scoreTrigger(feature: string, sub: string, label: string, ctx: ScoreCtx, pd: PastDefects): RiskScore {
  const kind = kindOf(label);
  const reasons: string[] = [];
  let s = BASE[kind] ?? 0;
  reasons.push(`base(${kind}) ${s >= 0 ? '+' : ''}${s}`);
  if (ctx.unvisited) { s += 3; reasons.push('미방문 전이 +3'); } else { s -= 2; reasons.push('방문됨 -2'); }
  if (ctx.destructive) { s += 3; reasons.push('데이터 변경 +3'); }
  if (ctx.apiLikely) { s += 2; reasons.push('API 유발 +2'); }
  s -= Math.min(3, ctx.visits);   // 반복 감쇠
  const mb = matchBoost(feature, sub, label, pd);
  s += mb.boost;
  reasons.push(...mb.reasons);
  return { score: s, reasons, jiraKeys: mb.keys };
}
