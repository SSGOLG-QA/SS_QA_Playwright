// 관측 — snapshotState = 구조(dumpScreen) + 텍스트지문(captureSlots) + URL + businessState 추론 통합.
//   비파괴 · 세션가드(isCourseLoggedOut) 선행. 동일 URL이라도 businessState/domSig 다르면 다른 상태.
import type { Page } from '@playwright/test';
import { dumpScreen, type ScreenInfo } from '../screenBattery';
import { captureSlots, type Slot } from '../../langCheck';
import { isCourseLoggedOut, killAlarms } from '../courseHelpers';
import type { BusinessState, ExplorerState } from './types';
import { enumerateActions } from './frontier';

// FNV-1a 32bit 문자열 해시(외부 의존 없이 안정 지문).
export function hashStr(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}

export function domSigOf(info: ScreenInfo): string {
  return hashStr([
    ...info.btns.slice().sort(),
    't' + info.tables, 'r' + (info.rows > 0 ? '1' : '0'),
    's' + info.selects, 'v' + info.vsels, 'd' + info.dps, 'i' + info.searchInp,
    ...info.heads.slice().sort(),
  ].join('|'));
}

export function slotSigOf(slots: Slot[]): string {
  return hashStr(slots.map((s) => s.key + '=' + s.text).sort().join('|'));
}

// businessState 추론(Phase 5: 리스트/폼/상세 구분) — 모달 개폐 + 화면 버튼으로 판정.
//   ⚠ 리스트 화면의 **행 액션 버튼**(보기/수정/삭제/완료확정)이 폼 상태로 오추론되지 않게 **모달·폼 신호 우선, 리스트 차선**.
//   화면별 정밀 규칙은 후속 확장. modalOpen = 비-알림 모달 노출 여부(등록/편집 폼 진입 감지).
// 폼 저작(작성중) 신호 — 등록/저장/확정/추가/불러오기/연결. ⚠ 단독 '수정'(상세의 편집 진입 버튼)은 제외(상세=조회 유지).
const FORM_SIG = /등록하기|^등록$|등록\b|저장|확정|항목\s*추가|위치\s*저장|불러오기|연결|임시\s*저장/;
export function inferBusinessState(info: ScreenInfo, _slots: Slot[], modalOpen: boolean): BusinessState {
  const btns = info.btns.join(' ');
  if (modalOpen) return FORM_SIG.test(btns) ? '작성중' : '조회';  // 등록/편집 폼 vs 뷰(상세) 모달
  if (/임시\s*저장/.test(btns)) return '작성중';          // 인페이지 등록/편집 폼(임시저장 노출)
  if (info.tables > 0 || info.rows > 0) return '조회';     // 리스트 화면(행 액션은 상태 신호 아님)
  if (/완료\s*확정/.test(btns)) return '저장';             // 상세(리스트 아님)에서 완료확정 노출
  if (/작업\s*완료/.test(btns)) return '작업완료';
  return '알수없음';
}

// 비-알림 모달(.modal-group) 노출 여부 — 등록/편집 폼 진입 감지용.
async function isModalOpen(admin: Page): Promise<boolean> {
  return admin.evaluate(() => Array.from(document.querySelectorAll('.modal-group, [class*="modal"]'))
    .some((m) => { const r = m.getBoundingClientRect(); const cls = typeof m.className === 'string' ? m.className : ''; return r.width > 1 && r.height > 1 && !/alarm/.test(cls); }))
    .catch(() => false);
}

// 모달 스코프 화면 정보 — ⚠ dumpScreen 은 whole-doc 이라 모달 서브상태에서 리스트 버튼과 섞임(오염).
//   모달 진입 상태는 **모달 컨테이너 내부만** 관측해야 상세/등록폼이 구분됨. dumpScreen 과 동일 shape.
async function scopedScreenInfo(admin: Page, rootSel: string): Promise<ScreenInfo> {
  return admin.evaluate((sel) => {
    const norm = (s: string | null): string => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const roots = Array.from(document.querySelectorAll(sel)).filter((m) => vis(m) && !/alarm/.test(typeof m.className === 'string' ? m.className : ''));
    const root = roots[roots.length - 1] || document.body;   // 최상단(마지막) 비-알림 모달
    const btns = Array.from(root.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean);
    const heads = Array.from(root.querySelectorAll('thead th')).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 20);
    return {
      btns: Array.from(new Set(btns)).slice(0, 30),
      selects: root.querySelectorAll('select').length,
      vsels: root.querySelectorAll('.v-select, .vs__dropdown-toggle').length,
      dps: root.querySelectorAll('input.datepicker-input, [class*="datepicker"]').length,
      tables: root.querySelectorAll('table, .list-table-group').length,
      rows: root.querySelectorAll('tbody tr').length,
      searchInp: root.querySelectorAll('input[placeholder*="검색"]').length,
      heads,
    };
  }, rootSel).catch(() => ({ btns: [], selects: 0, vsels: 0, dps: 0, tables: 0, rows: 0, searchInp: 0, heads: [] }));
}

// snapshotState — opts.rootSel 지정 시 그 컨테이너(모달)로 관측 스코프. 미지정=whole-doc(리스트/상세페이지/새탭).
export async function snapshotState(admin: Page, feature: string, sub: string, opts: { rootSel?: string } = {}): Promise<ExplorerState> {
  if (isCourseLoggedOut(admin)) throw new Error('SESSION_EXPIRED');
  await killAlarms(admin);
  const info = opts.rootSel ? await scopedScreenInfo(admin, opts.rootSel) : await dumpScreen(admin);
  const slots = await captureSlots(admin);
  const modalOpen = await isModalOpen(admin);
  return {
    url: admin.url(),
    feature, sub,
    businessState: inferBusinessState(info, slots, modalOpen),
    domSig: domSigOf(info),
    slotSig: slotSigOf(slots),
    actions: enumerateActions(info),
  };
}

export function stateKey(s: ExplorerState): string {
  return `${s.feature}|${s.sub}|${s.businessState}|${s.domSig}`;
}
