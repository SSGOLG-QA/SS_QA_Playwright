/**
 * FAIL 자동 분류기 — **오프라인·결정론적**(외부 호출 0)
 *
 * 무엇:  all-suite 등 리포트의 FAIL 행(TCResult)을 5개 클래스로 1차 규칙 분류.
 *        reporter.writeReport() 말미에서 인메모리 getResults()로 호출 → 'FAIL 분류' 시트 1장.
 * 왜:   매주 수십 건 FAIL을 수동 triage하던 것을 자동 표로. 다음 run부터 즉시 분류 현황이 나옴.
 * 원칙: skipAudit.ts 와 동일한 우선순위 정규식 티어(결정론). Claude/LLM 2차 호출 없음
 *        (정직 리포팅·비결정론 방지). 매칭 안 되면 OTHER 로 남겨 수동 확인 신호로 둔다.
 *
 * 클래스(팁 A 기준):
 *   A 안내문구   — TC 원문 vs 화면 문구 불일치. 어느 쪽이 최신인지 확인.
 *   B 구조       — 컬럼·버튼·탭·섹션·헤더 미노출(구조 드리프트). ui-baseline diff 교차 권장.
 *   C 진입       — 메뉴 진입 실패(SNB 링크 有·네비 실패 → 결함 / 링크 無 → SKIP은 분류 대상 아님).
 *   D 타임아웃   — Timeout/소실/오버레이 가림 등 액션 실패.
 *   E 정합성     — 합계·총건수·불변식 위반(잠재 결함 또는 파싱 오류).
 *   OTHER        — 미분류(수동 확인 필요).
 */
import type { TCResult } from './reporter';

export type FailClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'OTHER';

export const FAIL_CLASS_LABEL: Record<FailClass, string> = {
  A: 'A. 안내문구 불일치',
  B: 'B. 컬럼·버튼·탭 미노출(구조)',
  C: 'C. 메뉴 진입 실패',
  D: 'D. 클릭/액션 타임아웃',
  E: 'E. 정합성 위반',
  OTHER: 'OTHER. 미분류(수동 확인)',
};

export const FAIL_CLASS_ACTION: Record<FailClass, string> = {
  A: '기대값(TC)과 화면 중 최신 확인 → TC 갱신 or 수정요청',
  B: 'ui-baseline diff 교차: 구현 제거(회귀) vs 원래 없던 요소',
  C: 'SNB 링크 유무로 "미구현(SKIP)" vs "진입 결함(FAIL)" 분리',
  D: '대상 버튼 소실/오버레이 가림/네비 레이스 여부 확인',
  E: '잠재 결함 or 총건수·합계 파싱 오류 — 실데이터 재확인',
  OTHER: '현상/상세 원문을 보고 수동 분류',
};

// ── 우선순위 정규식 티어(위에서부터 먼저 매칭). skipAudit.ts 패턴 포크 ──
//   매칭 소스 = error(현상·자연어) + detail(기술 원문) + desc(항목명) 합성 문자열.
const TIMEOUT_RE = /Timeout\s*\d+\s*ms|exceeded|시간\s*초과|detached|not\s*(visible|attached|stable)|intercepts pointer|outside of the viewport|element is not|waiting for/i;
const ENTRY_RE   = /메뉴\s*진입|진입\s*(불가|실패)|navigateMenu|하위.*미발견|SNB.*실패|페이지\s*미도달|이동\s*실패/;
const CONSIST_RE = /정합성|불변식|총\s*건수|합계|렌더.*행.*총|≠|불일치\s*\(계산|계산\s*(불일치|결함)|합=|평균\s*=|순위\s*(연속|단조)/;
const STRUCT_RE  = /컬럼|버튼|탭|헤더|섹션|미노출|노출\s*안|요소\s*(부재|없음|미발견)|존재하지\s*않|count\s*0|개수\s*0|라디오|체크박스|placeholder/;
const GUIDE_RE   = /안내\s*문구|문구\s*(불일치|차이)|TC\s*원문|원문\s*(일치|불일치)|텍스트\s*불일치|오타|맞춤법|띄어쓰기|문장/;

/**
 * FAIL 1건을 클래스로 분류(결정론).
 * 우선순위: C(진입) > B(구조·원인기준) > E(정합성) > D(타임아웃) > B(구조·증상기준) > A > OTHER.
 *
 * ⚠ B 우선 원칙: "컬럼/버튼/탭 미노출" 결함은 Playwright에서 `Timeout … waiting for element`로
 *   표출되는 경우가 많다. 자연어 현상(error)에 구조 키워드가 있으면 **원인=미노출**로 보아
 *   detail의 타임아웃보다 B를 먼저 판정한다(증상 아닌 원인 기준). error에 구조 신호가 없고
 *   detail만 타임아웃이면 순수 액션 실패로 D 처리.
 */
export function classifyFail(r: TCResult): FailClass {
  const err = r.error || '';                                   // 자연어 현상(원인 라벨)
  const hay = `${r.error || ''} ${r.detail || ''} ${r.desc || ''}`;
  if (ENTRY_RE.test(hay)) return 'C';
  if (STRUCT_RE.test(err)) return 'B';   // 현상(원인)에 구조 신호 → B 최우선. 절차명의 '합계/평균'(CONSIST)·타임아웃보다 앞.
                                         //   예: 현상='컬럼 미노출' + 절차명='컬럼 \'작업시간 합계\' 노출' → E 오분류 방지.
  if (CONSIST_RE.test(hay)) return 'E';
  if (TIMEOUT_RE.test(hay)) return 'D';
  if (STRUCT_RE.test(hay)) return 'B';   // 현상엔 없고 상세/항목에만 구조 신호 → 증상 기준 B
  if (GUIDE_RE.test(hay)) return 'A';
  return 'OTHER';
}

export type TriageRow = {
  cls: FailClass;
  tcId: string;
  menu: string;
  desc: string;
  error: string;
  detail: string;
};

export type TriageSummary = {
  total: number;
  counts: Record<FailClass, number>;
  rows: TriageRow[];
};

const CLASS_ORDER: FailClass[] = ['A', 'B', 'C', 'D', 'E', 'OTHER'];

/** FAIL 결과 전체를 분류·집계. topMenuFn 으로 대메뉴명을 뽑는다(reporter의 topMenu 주입). */
export function summarizeFails(
  results: TCResult[],
  topMenuFn: (path: string) => string = (p) => (p || '').split(/[>/]/)[0]?.trim() || '',
): TriageSummary {
  const fails = results.filter((r) => r.status === 'FAIL');
  const counts = { A: 0, B: 0, C: 0, D: 0, E: 0, OTHER: 0 } as Record<FailClass, number>;
  const rows: TriageRow[] = fails.map((r) => {
    const cls = classifyFail(r);
    counts[cls] += 1;
    return {
      cls,
      tcId: r.tcId || '',
      menu: topMenuFn(r.path),
      desc: r.desc || '',
      error: (r.error || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      detail: (r.detail || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    };
  });
  rows.sort((a, b) => CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls) || a.menu.localeCompare(b.menu, 'ko'));
  return { total: fails.length, counts, rows };
}
