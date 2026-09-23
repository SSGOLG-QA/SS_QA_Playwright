// 모바일 관측 — snapshotMobileState = 모바일 DOM 신호(헤더 스택·버튼·카드·검색·빈상태·모달) + 텍스트 지문 + businessState.
//   ⚠ 코스 모바일은 별개 Vue앱(카드/헤더 기반, 테이블 없음) → PC observe(dumpScreen: table/thead 전제) 재사용 불가.
//   순수 헬퍼(hashStr·slotSigOf·stateKey)와 타입(ExplorerState)만 PC에서 재사용. [[course-mobile-web-separate-app]]
import type { Page } from '@playwright/test';
import type { ExplorerState, ActionCandidate, ActionKind } from '../types';
import { hashStr, slotSigOf } from '../observe';
import { captureMobileSlots } from '../../courseMobileLang';
import { isCourseLoggedOut, killAlarms } from '../../courseHelpers';

// 화면별 카드 클래스 상이(딥 인터랙션서 확정): 시설 bd-dde3ec / 자재 bd-0b7f / 공통 bdr-14 / 작업 order-card 등.
export const MOBILE_CARD_SEL = '[class*="bd-dde3ec"], [class*="bd-0b7f"], [class*="bdr-14"], [class*="-card"], [class*="order-card"]';

export interface MobileScreenInfo {
  headers: string[];      // header-title 텍스트(스택 레이어 — 마지막=프론트)
  btns: string[];         // 보이는 button 텍스트
  cards: number;          // 카드 수
  searchActive: boolean;  // 검색 input 활성
  hasEmpty: boolean;      // "결과가 없습니다"/"등록된 … 없습니다" 등 빈상태 안내
  modalOpen: boolean;     // 비-알림 모달 노출
  total: number | null;   // "총 N건"
}

export async function mobileScreenInfo(page: Page): Promise<MobileScreenInfo> {
  return page.evaluate((cardSel) => {
    const norm = (s: string | null): string => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const headers = Array.from(document.querySelectorAll('[class*="header-title"]')).filter(vis).map((e) => norm(e.textContent)).filter(Boolean);
    const btns = Array.from(document.querySelectorAll('button')).filter(vis).map((e) => norm(e.textContent)).filter(Boolean);
    const cards = Array.from(document.querySelectorAll(cardSel)).filter(vis).length;
    const searchActive = !!document.querySelector('input.search-header.active, input.active.search-header');
    const bodyTxt = norm(document.body.innerText).slice(0, 4000);
    const hasEmpty = /결과가 없습니다|등록된[^]{0,12}없습니다|데이터가 없습니다|내역이 없습니다|정보가 없습니다/.test(bodyTxt);
    const modalOpen = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).some((m) => {
      const r = m.getBoundingClientRect(); const c = typeof m.className === 'string' ? m.className : '';
      return r.width > 1 && r.height > 1 && !/alarm/.test(c);
    });
    const tm = bodyTxt.match(/총\s*([\d,]+)\s*건/); const total = tm ? Number(tm[1].replace(/,/g, '')) : null;
    return { headers: Array.from(new Set(headers)), btns: Array.from(new Set(btns)).slice(0, 40), cards, searchActive, hasEmpty, modalOpen, total };
  }, MOBILE_CARD_SEL).catch(() => ({ headers: [], btns: [], cards: 0, searchActive: false, hasEmpty: false, modalOpen: false, total: null } as MobileScreenInfo));
}

// businessState 추론(모바일): 프론트 헤더 타이틀 접미 + 모달/카드 기반.
function inferMobileBusinessState(i: MobileScreenInfo): ExplorerState['businessState'] {
  const front = i.headers[i.headers.length - 1] || '';
  if (i.modalOpen || /등록|추가$/.test(front)) return '작성중';
  if (/수정$/.test(front)) return '수정중';
  if (/상세$/.test(front)) return '조회';
  if (i.cards > 0 || i.total != null) return '조회';
  return '알수없음';
}

// 액션 후보 열거(모바일 버튼 라벨 기반). destructive=커밋류(저장/등록하기/삭제/완료확정) — 실행 게이트.
const DESTRUCTIVE = /저장|등록하기|삭제|완료\s*확정|제출|적용|입고 등록|사용 등록/;
const SEARCHY = /검색|조회|불러오기/;
const OPENISH = /연결|조건설정|정렬|보기|상세|크게|이력|추가|등록$|등록하기$|만들기|선택/;
function kindOf(label: string): ActionKind {
  if (SEARCHY.test(label)) return 'search';
  if (/정렬|최신순|과거순|이름순|최근/.test(label)) return 'sort';
  if (/조건설정|필터/.test(label)) return 'filter';
  if (DESTRUCTIVE.test(label)) return /삭제/.test(label) ? 'delete' : 'save';
  if (/연결|추가|등록|만들기|설정/.test(label)) return 'openModal';
  if (/보기|상세|크게|이력|선택/.test(label)) return 'view';
  return 'view';
}
export function enumerateMobileActions(i: MobileScreenInfo): ActionCandidate[] {
  const out: ActionCandidate[] = [];
  for (const label of i.btns) {
    if (label.length < 2 || label.length > 24) continue;
    if (!(OPENISH.test(label) || SEARCHY.test(label) || DESTRUCTIVE.test(label) || /정렬|최신순|과거순|이름순/.test(label))) continue;
    const kind = kindOf(label);
    out.push({
      id: hashStr(label + '|' + kind), kind, label,
      destructive: DESTRUCTIVE.test(label),
      apiLikely: kind === 'search' || kind === 'filter',
      risk: 0, reasons: [],
    });
  }
  return out;
}

function mobileDomSig(i: MobileScreenInfo): string {
  return hashStr([
    ...i.headers.slice().sort(),
    ...i.btns.slice().sort(),
    'c' + (i.cards > 0 ? '1' : '0'), 's' + (i.searchActive ? '1' : '0'),
    'm' + (i.modalOpen ? '1' : '0'), 'e' + (i.hasEmpty ? '1' : '0'),
  ].join('|'));
}

export async function snapshotMobileState(page: Page, feature: string, sub: string): Promise<ExplorerState> {
  if (isCourseLoggedOut(page)) throw new Error('SESSION_EXPIRED');
  await killAlarms(page);
  const info = await mobileScreenInfo(page);
  const slots = await captureMobileSlots(page).catch(() => []);
  return {
    url: page.url(), feature, sub,
    businessState: inferMobileBusinessState(info),
    domSig: mobileDomSig(info),
    slotSig: slotSigOf(slots),
    actions: enumerateMobileActions(info),
  };
}
