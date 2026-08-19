import { Page, Locator } from '@playwright/test';
import { record, skip, diff, CheckMeta } from '../reporter';

// ──────────────────────────────────────────────────────────────
//  버튼 커버리지 감사(공용) — "고정 배터리가 없는 컨트롤엔 SKIP을 만들지만,
//  있으나 배터리에 없는 버튼은 케이스 자체가 없어 조용히 누락"되는 문제의 시스템적 해결.
//  각 화면 검사 끝에 호출 → 화면에 '표시된' 버튼을 전수 열거하고
//   handled(우리 스위트가 상호작용하는 알려진 버튼) / destructive(파괴=의도적 미클릭) /
//   framework(help·페이지네이션·모달·nav) / unhandled(어느 검사도 안 다룸=진짜 갭)로 분류.
//  unhandled>0 → diff로 '누락 명시화'(조용한 누락 금지). 비파괴(열거만).
// ──────────────────────────────────────────────────────────────

// 우리 스위트가 실제로 상호작용하는(=커버 의도) 비파괴 버튼 어휘(코스관리 도메인 전반).
//   ⚠ 등록/설정/업로드 액션 버튼은 course:btn-audit 스윕이 open→cancel로 실제 테스트하므로 handled.
const DEFAULT_HANDLED = new RegExp('^(' + [
  // 조회/열람/편집 배터리
  '검색', '적용', '조회', '초기화', '정렬\\s*초기화', '내보내기', '보기', '수정', '관리\\s*기준', '리스트\\s*확인하기',
  // 등록/추가/설정/업로드(스윕 probeOpenCancel로 테스트)
  '등록', '신규\\s*등록', '신규\\s*작업\\s*지시\\s*등록', '신규\\s*이슈\\s*등록', '거래처\\s*등록', '관심구역\\s*등록', '영상정보\\s*등록', '장비등록',
  '추가', '그룹\\s*추가', '추가\\s*입고', '표준.*설정', '엑셀\\s*업로드', '권장값\\s*적용',
  // 기간 프리셋
  '최근\\s*\\d+\\s*개월', '이후\\s*\\d+\\s*개월', '1개월', '3개월', '6개월', '1년', '1주일',
  // 식생/3D/그린 도구
  '스와이프\\s*비교', '값\\s*표시(\\(hover\\))?', '크게\\s*보기', '확대', '전체보기', '배수\\s*분석\\s*→?', '비교\\s*분석\\s*→?',
  '지점', '거리', '높이', '각도', '넓이', '좌', '우',
  // 레이어/구역/분류 필터 칩(코스 영역·구역 taxonomy — 필터 토글)
  '지상', '지하', '위성', '지도', '정사영상', '스카이뷰',
  '그린', '그린칼라', '티박스', '페어웨이', '러프', '벙커', '폰드', '에이프런', '카트패스',
  'West', 'East', 'South', 'North', '장비', '자재', '약품',
].join('|') + ')$');
// 파괴(저장/삭제/커밋 계열) → 비파괴 원칙상 클릭 안 함(노출만). 의도적 제외로 분류.
const DEFAULT_DESTRUCTIVE = /^(저장|저장하기|삭제|변경|사용중지|재개|관제\s*적용|적용하기|승인|반려|발송|전송|가져오기|불러오기|복사|초기화\s*저장)$/;
// 프레임워크/네비/모달 — 도메인 액션 아님.
const DEFAULT_FRAMEWORK = /^(이용가이드|확인|취소|닫기|이전|다음|처음|끝|편집|더보기|접기|펼치기|전체\s*선택|선택|\d+|[<>‹›«»])$/;

export interface AuditOpts {
  scope?: Locator;              // 감사 범위(기본 .contents/main)
  handled?: RegExp;             // handled 어휘 확장/치환
  destructive?: RegExp;         // 파괴 어휘 확장/치환
  framework?: RegExp;           // 프레임워크 어휘 확장/치환
  diffMenu?: string;            // diff 시트의 대메뉴명(기본 P의 첫 토큰)
  extraHandled?: string[];      // 이 화면에서 추가로 handled 처리할 버튼(정확 일치)
}

// 화면 표시 버튼 전수 감사. 각 스펙이 화면 검사 끝에서 1회 호출.
export async function auditButtonCoverage(admin: Page, P: string, tcRef: string, tcId: string, opts: AuditOpts = {}): Promise<void> {
  const m: CheckMeta = { path: `${P} > 버튼 커버리지`, tcRef, tcId, desc: '화면 표시 버튼 전수 감사(handled/파괴제외/프레임워크/미처리)', failMsg: '' };
  const scope = opts.scope ?? admin.locator('.contents, main').first();
  const texts = (await scope.locator('button:visible').allInnerTexts().catch(() => []))
    .map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const uniq = Array.from(new Set(texts));
  if (uniq.length === 0) { skip(m, '표시 버튼 없음(hover 노출형 액션만/버튼 미노출)'); return; }

  const handledRe = opts.handled ?? DEFAULT_HANDLED;
  const destrRe = opts.destructive ?? DEFAULT_DESTRUCTIVE;
  const fwRe = opts.framework ?? DEFAULT_FRAMEWORK;
  const extra = new Set(opts.extraHandled ?? []);
  const isHandled = (b: string) => handledRe.test(b) || extra.has(b);

  const handled = uniq.filter((b) => isHandled(b));
  const destructive = uniq.filter((b) => !isHandled(b) && destrRe.test(b));
  const framework = uniq.filter((b) => !isHandled(b) && !destrRe.test(b) && fwRe.test(b));
  const unhandled = uniq.filter((b) => !isHandled(b) && !destrRe.test(b) && !fwRe.test(b));

  const summary = `표시 ${uniq.length}종 = handled ${handled.length}[${handled.join('/')}] · 파괴제외 ${destructive.length}[${destructive.join('/')}] · 프레임워크 ${framework.length} · 미처리 ${unhandled.length}${unhandled.length ? `[${unhandled.join('/')}]` : ''}`;
  if (unhandled.length === 0) { record(m, 'PASS', { actual: summary }); return; }

  const menu = opts.diffMenu ?? P.split('>')[0].trim();
  diff(menu, `${P} 미처리 버튼`, `화면 표시되나 어느 검사도 다루지 않음: [${unhandled.join(', ')}] — 전용 검사 추가 대상(존재 버튼 조용한 누락 방지)`, tcRef, '해당 버튼별 검사 추가 필요');
  record(m, 'PASS', { actual: summary + ' → 미처리 diff 기록' });
}
