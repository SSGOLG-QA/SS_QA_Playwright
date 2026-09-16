// 코스관리 PC 탐색 Agent — 핵심 타입 (Phase 4 MVP; 아키텍처 설계 §3 준수, MVP 사용분만)
//   전체 타입(Finding/Verdict/Candidate 등)은 Phase 5~에서 확장. 지금은 관측·그래프에 필요한 최소만.

export type BusinessState =
  | '미작성' | '작성중' | '임시저장' | '저장' | '수정중'
  | '작업완료' | '완료확정' | '완료' | '조회' | '알수없음';

export type ActionKind =
  | 'view' | 'search' | 'filter' | 'sort' | 'date'
  | 'openModal' | 'nav' | 'tab' | 'input' | 'save' | 'submit' | 'delete' | 'reset';

export interface ActionCandidate {
  id: string;
  kind: ActionKind;
  label: string;
  destructive: boolean;   // 데이터 변경 여부 → 실행 시 파괴 가드 필요
  apiLikely: boolean;     // 요청 유발 가능성
  risk: number;           // Phase 7 risk.ts 산출(MVP=0)
  reasons: string[];      // 우선순위 근거(과거결함 key 등, MVP=[])
}

export interface ExplorerState {
  url: string;
  feature: string;        // COURSE_IA 대메뉴
  sub: string;            // 소메뉴/화면
  businessState: BusinessState;
  domSig: string;         // dumpScreen 요약 해시
  slotSig: string;        // captureSlots 텍스트 지문 해시
  actions: ActionCandidate[];
}

export interface Transition { from: string; action: string; to: string; ts: string; }

export interface Budget {
  maxActionsPerSession: number;
  maxDepth: number;
  maxScenarios: number;
  maxRepeatedAction: number;
  maxExecutionMinutes: number;
}

export function loadBudget(): Budget {
  const n = (k: string, d: number): number => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  return {
    maxActionsPerSession: n('EXPLORE_MAX_ACTIONS', 120),
    maxDepth: n('EXPLORE_MAX_DEPTH', 4),
    maxScenarios: n('EXPLORE_MAX_SCENARIOS', 30),
    maxRepeatedAction: n('EXPLORE_MAX_REPEAT', 3),
    maxExecutionMinutes: n('EXPLORE_MAX_MIN', 18),
  };
}
