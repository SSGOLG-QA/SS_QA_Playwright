// Anomaly Detection (비파괴 범위) — 전이/관측을 규칙으로 평가해 Finding 산출. 판정=ANOMALY/NEEDS_REVIEW(결정론적 결함만 FAIL).
//   ⚠ report-standard: 발견 즉시 결함 확정 금지 → Finding으로 기록. 재현(Phase 9)으로 REPRODUCIBLE 승격.
//   비파괴: 데이터 변경/netfault 없음. 런타임 이상(4xx/5xx/JS예외)·예상외 nav·무동작·모달 교착·반복 비멱등만.
import * as fs from 'fs';
import * as path from 'path';
import type { RuntimeSignals } from './observers';
import { detailSignals } from './observers';

export type FindingStatus = 'FAIL' | 'ANOMALY' | 'NEEDS_REVIEW';
export type ReproVerdict = 'REPRODUCIBLE_ANOMALY' | 'FLAKY_OR_ENVIRONMENTAL' | 'not-checked' | 'not-applicable';
// 재현(Phase 9) 재생에 필요한 구조화 메타 — sequence(사람가독 문자열)로는 재실행 불가하므로 별도 부착.
export interface ReplayInfo {
  feature: string;
  sub: string;
  trigger: string;
  kind: 'modal' | 'newtab' | 'pagenav' | 'noop';
  rule: string;   // 재현 시 다시 평가할 규칙(runtime-error/http-4xx/unexpected-nav/modal-not-closeable/repeat-non-idempotent/netfault-*)
  status?: number;  // netfault 재현용 주입 상태코드
}
export interface Finding {
  id: string;
  screen: string;
  sequence: string[];
  status: FindingStatus;
  rule: string;
  reason: string;
  evidence: string;
  jiraKeys: string[];
  repro?: ReproVerdict;
  reproDetail?: string;   // 2회 재현 결과 요약(Phase 9)
  replay?: ReplayInfo;    // 재생 메타
  shotPath?: string;      // 재현 시점 이상 상태 스크린샷 경로(Phase 9/10 증거)
}

let counter = 0;
const nid = (): string => `F${String(++counter).padStart(3, '0')}`;

export interface TransitionEval {
  screen: string;
  feature: string; sub: string;
  trigger: string;
  kind: 'modal' | 'newtab' | 'pagenav' | 'noop';
  fromBs: string; toBs: string;
  fromPath: string; toPath: string;
  signals: RuntimeSignals;
  jiraKeys: string[];
}

const replayOf = (p: { feature: string; sub: string; trigger: string; kind: ReplayInfo['kind'] }, rule: string): ReplayInfo =>
  ({ feature: p.feature, sub: p.sub, trigger: p.trigger, kind: p.kind, rule });

// 전이 1건 → Finding[] (0개 이상). 비파괴 규칙만.
export function evalTransition(p: TransitionEval): Finding[] {
  const out: Finding[] = [];
  const seq = [`${p.screen} 진입`, `[${p.trigger}] (${p.kind})`];
  // R1 런타임 이상 — JS 예외/5xx = 강한 이상(ANOMALY), 4xx = 확인 필요.
  if (p.signals.pageErrors.length > 0 || p.signals.http5xx.length > 0) {
    out.push({ id: nid(), screen: p.screen, sequence: seq, status: 'ANOMALY', rule: 'runtime-error',
      reason: `전이 중 JS예외/5xx 발생 — [${p.trigger}]`, evidence: detailSignals(p.signals), jiraKeys: p.jiraKeys, repro: 'not-checked', replay: replayOf(p, 'runtime-error') });
  } else if (p.signals.http4xx.length > 0) {
    out.push({ id: nid(), screen: p.screen, sequence: seq, status: 'NEEDS_REVIEW', rule: 'http-4xx',
      reason: `전이 중 4xx 응답 — [${p.trigger}]`, evidence: detailSignals(p.signals), jiraKeys: p.jiraKeys, repro: 'not-checked', replay: replayOf(p, 'http-4xx') });
  }
  // R2 예상외 nav — 뷰/상세 트리거인데 홈('/')·랜딩으로 페이지 이탈(컨텍스트 상실).
  if (p.kind === 'pagenav' && /보기|상세|미리보기|현황|내역/.test(p.trigger) && (p.toPath === '/' || p.toPath === '')) {
    out.push({ id: nid(), screen: p.screen, sequence: seq, status: 'ANOMALY', rule: 'unexpected-nav',
      reason: `[${p.trigger}](뷰형) 클릭이 홈('/')으로 이탈 — 컨텍스트 상실`, evidence: `${p.fromPath} → ${p.toPath}`, jiraKeys: p.jiraKeys, repro: 'not-checked', replay: replayOf(p, 'unexpected-nav') });
  }
  return out;
}

// 모달 교착(닫기 컨트롤로 안 닫혀 하드내비 필요) — 잠재 UX 결함.
export function findingModalDeadlock(feature: string, sub: string, trigger: string, probe: string, jiraKeys: string[]): Finding {
  const screen = `${feature} > ${sub}`;
  return { id: nid(), screen, sequence: [`${screen} 진입`, `[${trigger}] 열기`, '닫기 시도(취소/X/Escape) 실패'], status: 'NEEDS_REVIEW',
    rule: 'modal-not-closeable', reason: `[${trigger}] 모달이 표준 닫기(취소/닫기/X/Escape/확인)로 안 닫힘 — 하드내비로만 복구`, evidence: probe, jiraKeys, repro: 'not-checked',
    replay: replayOf({ feature, sub, trigger, kind: 'modal' }, 'modal-not-closeable') };
}

// 반복 비멱등 — 동일 트리거 2회 열기 결과가 다르거나 2회차에 에러.
export function findingRepeatNonIdempotent(feature: string, sub: string, trigger: string, first: string, second: string, sig: RuntimeSignals, jiraKeys: string[]): Finding | null {
  const errored = sig.pageErrors.length > 0 || sig.http5xx.length > 0 || sig.http4xx.length > 0;
  if (first === second && !errored) return null;
  const screen = `${feature} > ${sub}`;
  return { id: nid(), screen, sequence: [`${screen} 진입`, `[${trigger}] 1회 열기·닫기`, `[${trigger}] 2회 열기`], status: 'ANOMALY',
    rule: 'repeat-non-idempotent', reason: `[${trigger}] 반복 열기 결과 상이/에러 — 1회 domSig=${first} vs 2회=${second}`,
    evidence: errored ? detailSignals(sig) : '2회차 상태 상이', jiraKeys, repro: 'not-checked',
    replay: replayOf({ feature, sub, trigger, kind: 'modal' }, 'repeat-non-idempotent') };
}

// Netfault(비파괴 API 장애주입) Finding — netfault-uncaught(ANOMALY)/netfault-silent-blank(NEEDS_REVIEW). replay로 재현(2회).
export function findingNetfault(feature: string, sub: string, rule: string, status: number, note: string, jiraKeys: string[]): Finding {
  const screen = `${feature} > ${sub}`;
  const st: FindingStatus = rule === 'netfault-uncaught' ? 'ANOMALY' : 'NEEDS_REVIEW';
  return { id: nid(), screen, sequence: [`${screen} 진입`, `API ${status} 주입 + refetch`, rule === 'netfault-uncaught' ? '앱 uncaught 예외' : '무음 백지'], status: st,
    rule, reason: `API 장애(${status}) 주입 시 ${rule === 'netfault-uncaught' ? 'uncaught JS 예외 발생(미처리)' : '본문 백지(에러표시 없음)'}`, evidence: note, jiraKeys, repro: 'not-checked',
    replay: { feature, sub, trigger: `(API ${status} 주입)`, kind: 'pagenav', rule, status } };
}

// Commit(파괴 커밋 시퀀스) Finding — **replay 없음**(재커밋 방지, 단발 확정). 상태별 매핑.
export function findingCommit(feature: string, sub: string, trigger: string, status: 'ANOMALY' | 'NEEDS_REVIEW', rule: string, note: string, jiraKeys: string[]): Finding {
  const screen = `${feature} > ${sub}`;
  return { id: nid(), screen, sequence: [`${screen} 진입`, `[${trigger}] 등록 모달`, '마커 채움 → 제출'], status,
    rule, reason: note, evidence: note, jiraKeys, repro: 'not-applicable' };
}

export class FindingSink {
  readonly findings: Finding[] = [];
  add(fs2: Finding[] | Finding | null): void {
    if (!fs2) return;
    if (Array.isArray(fs2)) this.findings.push(...fs2);
    else this.findings.push(fs2);
  }
  count(): number { return this.findings.length; }
  byStatus(): Record<string, number> {
    const r: Record<string, number> = {};
    for (const f of this.findings) r[f.status] = (r[f.status] || 0) + 1;
    return r;
  }
  persist(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), count: this.findings.length, byStatus: this.byStatus(), findings: this.findings }, null, 2), 'utf8');
  }
}
