// 액션 후보 열거 — MVP: 화면 표시 버튼(ScreenInfo.btns)에서 후보 도출 + destructive/apiLikely 태깅.
//   ⚠ coverageAudit.auditButtonCoverage 는 reporter 부작용(diff 기록)이 있어 관측용으론 부적합 → MVP는 순수 열거.
//   Phase 7 에서 전이맵·ScreenSpec 병합 + Risk 스코어 결합.
import type { ScreenInfo } from '../screenBattery';
import type { ActionCandidate, ActionKind } from './types';

// 코스관리 액션 어휘(coverageAudit 정규식 어휘 참조) — 데이터 변경(파괴) 후보.
const DESTRUCTIVE = /저장|삭제|등록|수정|적용|완료|제출|초기화|추가|확정|배치|생성|보내기|업로드|불러오기/;
// 순수 내비/닫기(후보 제외 — 화면 안 열림, 흐름만 깸).
const NAV = /^취소$|^닫기$|^이전$|^다음$|로그아웃|^뒤로$|^홈$|^확인$|모두 선택/;
// 요청 유발 가능성.
const API = /조회|검색|적용|저장|삭제|등록|제출|내보내기|업로드|불러오기|다운로드/;

// 날짜/기간 프리셋(적용 전엔 화면 무변화가 정상 → view로 오탐 방지) · 정렬 토글.
const DATE_PRESET = /^\d+\s*(개월|주|년|일)$|달력|날짜|기간/;

function kindOf(label: string): ActionKind {
  if (/검색/.test(label)) return 'search';
  if (/초기화/.test(label)) return 'reset';
  if (/정렬|최신순|이름순|오름차순|내림차순/.test(label)) return 'sort';
  if (DATE_PRESET.test(label)) return 'date';
  if (/조회|보기|상세|현황|내역|미리보기|더보기|일자별|개인별|투입/.test(label)) return 'view';
  if (/삭제/.test(label)) return 'delete';
  if (/저장/.test(label)) return 'save';
  if (/제출|확정|완료/.test(label)) return 'submit';
  if (/등록|추가|생성/.test(label)) return 'openModal';
  return 'view';
}

export function enumerateActions(info: ScreenInfo): ActionCandidate[] {
  const out: ActionCandidate[] = [];
  const seen = new Set<string>();
  for (const label of info.btns) {
    if (!label || label.length > 24 || NAV.test(label)) continue;
    if (/^\d+$/.test(label)) continue;              // 순수 숫자(페이지네이션·달력 날짜) 제외
    if (/^[<>‹›«»]+$/.test(label)) continue;         // 화살표/페이저 글리프 제외
    const id = 'btn:' + label.replace(/\s+/g, '');
    if (seen.has(id)) continue; seen.add(id);
    out.push({
      id,
      kind: kindOf(label),
      label,
      destructive: DESTRUCTIVE.test(label),
      apiLikely: API.test(label),
      risk: 0,
      reasons: [],
    });
  }
  return out;
}
