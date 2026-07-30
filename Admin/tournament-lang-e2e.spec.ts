import { test } from '../lib/fixtures';
import { switchLanguage, KOREAN, TARGET_LANGS, type Lang } from '../lib/langCheck';
import { record, skip, capture, resetResults, resetNoTC, resetDiff, writeReport, gotoMenu } from '../lib/reporter';
import { settle } from '../lib/adminHelpers';
import { Modal } from '../lib/components/Modal';
import type { Page, Locator } from '@playwright/test';

// ════════════════════════════════════════════════════════════
//  대회 > 대회관리 — 다국어 i18n E2E (7개국, per-element, 대회모드_Cloud TC 참조)
//   ▶ 표준 langCheck(applySlotComparison)과 동일 수준: 요소별로 PASS(번역값 기록)/한글노출/혼재/미번역 분류, tcRef·zone 기록.
//   ▶ 랜딩 7종: 메인 / 대회 등록·참가자·조편성·그룹편집 모달 / 스코어·결과집계 새 탭(버튼 클릭 랜딩까지 검증).
//   ▶ 오탐 제거: 구조적 chrome(제목·버튼·컬럼·라벨·placeholder)만 · tbody/입력값/선택값/고유명사(클럽·대회명) 배제.
//   ▶ 방식: 한국어 baseline 캡처(요소 DOM경로 키) → 언어 전환 → 동일 키 대조 → 요소별 기록 → 한국어 원복(비파괴).
//   ▶ 언어별 리포트: reports/tournament-lang-<언어>_report_*.xlsx
//   실행(전체): SUBDOMAIN=td18 npx playwright test --project=admin-chromium Admin/tournament-lang-e2e.spec.ts --no-deps
//   실행(일부): $env:LANGS="영어"; ...
// ════════════════════════════════════════════════════════════
const FILTER = (process.env.LANGS || '').split(',').map(s => s.trim()).filter(Boolean);
const LANGS: Lang[] = FILTER.length ? TARGET_LANGS.filter(l => FILTER.includes(l.ko) || FILTER.includes(l.label)) : TARGET_LANGS;

// 접속 인증키 [복사] 안내 모달은 clipboard.writeText 성공 시에만 노출 → 컨텍스트에 클립보드 권한 부여(미부여 시 복사 실패로 모달 미노출)
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
const HANGUL = /[가-힣]/;
const OTHER_SCRIPT = /[A-Za-z฀-๿぀-ヿ一-鿿]/;

type Slot = { key: string; text: string; zone: string };

// 스코프(모달/탭/영역) 내 구조적 chrome을 DOM경로 키로 수집(데이터 배제)
async function capKeyed(scope: Locator, prefix: string): Promise<Slot[]> {
  const raw: Slot[] = await scope.evaluate((root: Element) => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const ownText = (e: Element) => Array.from(e.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent || '').join('').replace(/\s+/g, ' ').trim();
    const pathKey = (node: Element) => { const parts: string[] = []; let e: Element | null = node; while (e && e !== root && e.nodeType === 1) { let i = 1, sib: Element | null = e; while ((sib = sib.previousElementSibling)) if (sib.tagName === e.tagName) i++; parts.unshift(e.tagName.toLowerCase() + ':' + i); e = e.parentElement; } return parts.join('>'); };
    const SEL = 'button,[role="button"],thead th,[role="columnheader"],label,.form-label,dt,legend,.modal-title,.pop-title,h1,h2,h3,h4,.sub-title,[class*="section-title"]';
    const EXCL = 'tbody,input,textarea,.vs__selected,.vs__selected-options,[contenteditable="true"],[class*="badge"]';
    const zoneOf = (el: Element) => { const t = el.tagName.toLowerCase(); if (/^h[1-4]$/.test(t) || el.matches('.modal-title,.pop-title,.sub-title,[class*="section-title"]')) return '제목'; if (el.matches('button,[role="button"]')) return '버튼'; if (el.matches('thead th,[role="columnheader"]')) return '컬럼'; return '라벨'; };
    const out: { key: string; text: string; zone: string }[] = [];
    const seen = new Set<string>();
    for (const el of Array.from(root.querySelectorAll(SEL))) {
      if ((el as HTMLElement).closest(EXCL)) continue;
      if (!vis(el)) continue;
      const own = ownText(el); if (!own || own.length > 80) continue;
      const key = pathKey(el); if (seen.has(key)) continue; seen.add(key);
      out.push({ key, text: own, zone: zoneOf(el) });
    }
    for (const el of Array.from(root.querySelectorAll('input[placeholder],textarea[placeholder],.vs__search[placeholder]'))) {
      if (!vis(el)) continue; const ph = (el as HTMLInputElement).getAttribute('placeholder') || ''; if (!ph) continue;
      const key = pathKey(el) + '#ph'; if (seen.has(key)) continue; seen.add(key);
      out.push({ key, text: ph, zone: 'placeholder' });
    }
    // 안내문구/설명 문단 — 버튼/라벨 SEL이 못 잡는 긴 시스템 텍스트(<p>·안내·설명 블록). 데이터(tbody/입력값) 배제, leaf 텍스트만.
    const GSEL = 'p,li,dd,[class*="guide"],[class*="notice"],[class*="desc"],[class*="info"],[class*="comment"],[class*="message"],[class*="text-box"],[class*="txt"]';
    for (const el of Array.from(root.querySelectorAll(GSEL))) {
      if ((el as HTMLElement).closest('tbody,input,textarea,.vs__selected,thead')) continue;
      if (!vis(el)) continue;
      const own = ownText(el); if (!own || own.length < 15 || own.length > 500) continue;   // 안내문구 문장 길이대
      const key = pathKey(el) + '#g'; if (seen.has(key)) continue; seen.add(key);
      out.push({ key, text: own, zone: '안내문구' });
    }
    return out;
  }).catch(() => [] as Slot[]);
  return raw.map(s => ({ ...s, key: `${prefix}|${s.key}` }));
}

// 메인 상단 안내문구(정보 박스) — <div>/<span> 등 일반 태그에 담긴 긴 소개 문구까지 캡처(정보 박스는 데이터 없음 → 폭넓게 안전).
//  ⚠ 한글 필터 미적용: FG(번역문)도 같은 키로 잡혀야 KO↔FG 페어링됨(판정은 비교 로직이 koText 한글여부로 수행).
async function capInfoGuide(scope: Locator): Promise<Slot[]> {
  return scope.evaluate((root: Element) => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const ownText = (e: Element) => Array.from(e.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent || '').join('').replace(/\s+/g, ' ').trim();
    const pathKey = (node: Element) => { const parts: string[] = []; let e: Element | null = node; while (e && e !== root && e.nodeType === 1) { let i = 1, sib: Element | null = e; while ((sib = sib.previousElementSibling)) if (sib.tagName === e.tagName) i++; parts.unshift(e.tagName.toLowerCase() + ':' + i); e = e.parentElement; } return parts.join('>'); };
    const out: { key: string; text: string; zone: string }[] = []; const seen = new Set<string>();
    for (const el of Array.from(root.querySelectorAll('p,div,span,li,dd,em,strong'))) {
      if ((el as HTMLElement).closest('button,a,input,textarea,.vs__selected')) continue;
      if (!vis(el)) continue;
      const own = ownText(el); if (!own || own.length < 15 || own.length > 500) continue;   // 안내문구 문장 길이대
      const key = 'guide|' + pathKey(el); if (seen.has(key)) continue; seen.add(key);
      out.push({ key, text: own, zone: '안내문구' });
    }
    return out;
  }).catch(() => [] as Slot[]);
}

// 행(tbody) 시스템 텍스트: 행 액션 버튼명 + 상태 값(진행전/진행중/완료). 구조적 키로 KO↔FG 페어링.
//  ⚠ 데이터(대회명·날짜·인원수·이름·접속키)는 배제 — 버튼과 상태(마지막 td, 짧은 값)만.
async function capRowSystem(scope: Locator): Promise<Slot[]> {
  return scope.evaluate((root: Element) => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const pathKey = (node: Element) => { const parts: string[] = []; let e: Element | null = node; while (e && e !== root && e.nodeType === 1) { let i = 1, sib: Element | null = e; while ((sib = sib.previousElementSibling)) if (sib.tagName === e.tagName) i++; parts.unshift(e.tagName.toLowerCase() + ':' + i); e = e.parentElement; } return parts.join('>'); };
    const out: { key: string; text: string; zone: string }[] = [];
    const seen = new Set<string>();
    for (const b of Array.from(root.querySelectorAll('tbody button,tbody [role="button"]'))) {
      if (!vis(b)) continue; const t = ((b as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim(); if (!t || t.length > 30) continue;
      const key = 'rowsys|btn>' + pathKey(b); if (seen.has(key)) continue; seen.add(key);
      out.push({ key, text: t, zone: '행 버튼' });
    }
    for (const tr of Array.from(root.querySelectorAll('tbody tr'))) {
      const tds = tr.querySelectorAll('td'); if (tds.length < 12) continue;      // 첫 라운드 행만(상태=마지막 td)
      const last = tds[tds.length - 1]; const t = ((last as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 12) continue;
      const key = 'rowsys|status>' + pathKey(last); if (seen.has(key)) continue; seen.add(key);
      out.push({ key, text: t, zone: '상태' });
    }
    return out;
  }).catch(() => [] as Slot[]);
}

// ⚠ td18 세션은 재로그인 1회당 1테스트만 생존(공유 QA 계정 동시 사용) → 언어별 test() 분리 시 첫 언어만 성공.
//   따라서 단일 test/단일 컨텍스트에서 openAdmin 1회 후 7개국을 in-place 언어 전환으로 순회(재로그인 없음).
//   언어별 리포트는 resetResults→writeReport(언어)로 분리. 세션 death 시 완료 언어 리포트는 보존, 이후 언어는 graceful SKIP.
test('대회관리 다국어 i18n E2E — 7개국 (단일 컨텍스트)', async ({ admin }) => {
  test.setTimeout(2_400_000);
  const P = '대회 > 대회관리 > 다국어';
  {
    resetResults(); resetNoTC(); resetDiff();

    if (!await gotoMenu(admin, '대회', '대회관리', { path: P, tcRef: '대회_대회관리', tcId: '진입', desc: '대회관리 진입', failMsg: '진입 불가' })) { await writeReport('tournament-lang-실패'); return; }
    await settle(admin, 2000);
    const tableBox = admin.locator('.contents-box').filter({ has: admin.locator('table tbody tr') }).last();
    const infoBox = admin.locator('.contents-box').first();
    const modal = new Modal(admin);
    const norm = (s: string) => s.replace(/\s+/g, '');
    const heads = (await tableBox.getByRole('columnheader').allInnerTexts().catch(() => [])).map(norm);
    const colIdx = (k: string, fb: number) => { let i = heads.findIndex(h => h === norm(k)); if (i < 0) i = heads.findIndex(h => h.includes(norm(k))); return i >= 0 ? i : fb; };
    const pickRow = async (sts: string[]): Promise<{ row: Locator; name: string } | null> => { const rows = tableBox.locator('tbody tr'); const n = Math.min(await rows.count().catch(() => 0), 25); for (let i = 0; i < n; i++) { const r = rows.nth(i); if (await r.locator('td').count() < 12) continue; const st = (await r.locator('td').last().innerText().catch(() => '')).replace(/\s+/g, ''); if (sts.some(s => st.includes(s))) return { row: r, name: (await r.locator('td').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim() }; } return null; };
    const scoredRow = await pickRow(['완료', '진행중']);
    const editRow = await pickRow(['진행전']) || scoredRow;
    const exclude = new Set<string>(['킹즈락']);
    for (const rr of [scoredRow, editRow]) if (rr?.name) exclude.add(rr.name);

    const closeModal = async () => { for (let i = 0; i < 4 && await modal.isOpen(); i++) { await modal.closeNonDestructive().catch(() => {}); if (await modal.isOpen()) { await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(300); } } };
    // 언어 전환 전 오버레이(모달/드롭다운/달력) 정리 — 잔존 오버레이가 헤더 언어 트리거를 가려 전환 실패하는 것 방지.
    //  ⚠ 그룹편집/복사 안내처럼 [확인]으로만 닫히는 알럿형 모달은 Escape/취소로 안 닫힘 → [확인]/[닫기]도 클릭(dismiss, 저장 아님).
    const cleanOverlays = async () => {
      if (await modal.isOpen()) await closeModal();
      for (let i = 0; i < 5; i++) {
        const open = await admin.locator('.modal-group, .modal-box, .vs__dropdown-menu, .datepicker-layer, .slot-list').filter({ visible: true }).count().catch(() => 0);
        if (!open) break;
        await admin.keyboard.press('Escape').catch(() => {});
        await admin.waitForTimeout(200);
        if (await modal.isOpen()) {   // Escape 무반응 알럿형 → 확인/닫기(dismiss) 클릭
          const btn = admin.locator('.modal-group button, .modal-box button').filter({ hasText: /확인|닫기|Confirm|OK|Close|閉じる|确定|確定|Đóng|ปิด|Tutup/i }).last();
          if (await btn.isVisible({ timeout: 300 }).catch(() => false)) { await btn.click({ force: true }).catch(() => {}); await admin.waitForTimeout(250); }
          else await modal.closeNonDestructive().catch(() => {});
        }
      }
    };
    // 오버레이 정리 + 재시도로 견고하게 전환(3회). 실패 시 false.
    const switchLangRobust = async (label: string): Promise<boolean> => {
      for (let a = 0; a < 3; a++) { await cleanOverlays(); if (await switchLanguage(admin, label)) return true; await admin.waitForTimeout(500); }
      return false;
    };
    const modalRoot = () => admin.locator('.modal-group').filter({ hasText: /\S/ }).last();
    const openModalCol = async (row: Locator | null | undefined, key: string, fb: number): Promise<Locator | null> => { if (!row) return null; await cleanOverlays(); await row.locator('td').nth(colIdx(key, fb)).getByRole('button').first().click().catch(() => {}); await admin.waitForTimeout(1400); return (await modalRoot().isVisible({ timeout: 1200 }).catch(() => false)) ? modalRoot() : null; };
    // 새 탭(window.open) 오픈 — 언어 전환·모달 개폐 후 waitForEvent가 간헐 실패 → 오버레이 정리 + 클릭 재시도(3회)로 견고화.
    const openTabCol = async (row: Locator | null | undefined, key: string, fb: number): Promise<Page | null> => {
      if (!row) return null;
      const idx = colIdx(key, fb);
      for (let a = 0; a < 3; a++) {
        await cleanOverlays();
        const b = row.locator('td').nth(idx).getByRole('button').first();
        if (!(await b.isVisible({ timeout: 800 }).catch(() => false))) return null;
        await b.scrollIntoViewIfNeeded().catch(() => {});
        const [np] = await Promise.all([admin.context().waitForEvent('page', { timeout: 8000 }).catch(() => null), b.click({ force: true }).catch(() => {})]);
        if (np) { await np.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {}); await np.waitForTimeout(1600); return np; }
        await admin.waitForTimeout(600);   // 재시도 전 안정화
      }
      return null;
    };
    const scoreIdx = colIdx('스코어', 9), rankIdx = colIdx('결과집계', 10);
    const keyColIdx = heads.findIndex(h => h.includes('접속'));   // 접속 인증키 컬럼(리더보드) — [복사] 버튼

    // 랜딩 정의: capture()가 현재 언어에서 열고 스캔 후 닫음 → 슬롯 반환. (그룹편집=불안정 → 스코어/결과집계 뒤로 배치)
    type Landing = { id: string; label: string; tcRef: string; capture: () => Promise<Slot[]> };
    const LANDINGS: Landing[] = [
      { id: 'main', label: '메인 화면', tcRef: '대회_대회관리_1-61', capture: async () => [...await capKeyed(infoBox, 'info'), ...await capInfoGuide(infoBox), ...await capKeyed(tableBox, 'table'), ...await capRowSystem(tableBox)] },
      // 새 탭(스코어/결과집계)은 모달 개폐 누적 전 clean 상태에서 먼저 열어야 안정적 → 메인 직후 배치.
      { id: 'score', label: '스코어 새 탭', tcRef: '대회_대회관리_262-283', capture: async () => { const tab = await openTabCol(scoredRow?.row, '스코어', scoreIdx); if (!tab) return []; const r = await capKeyed(tab.locator('body'), 'score'); await tab.close().catch(() => {}); await admin.waitForTimeout(400); return r; } },
      { id: 'rank', label: '결과집계 새 탭', tcRef: '대회_대회관리_284-419', capture: async () => { const tab = await openTabCol(scoredRow?.row, '결과집계', rankIdx); if (!tab) return []; const r = await capKeyed(tab.locator('body'), 'rank'); await tab.close().catch(() => {}); await admin.waitForTimeout(400); return r; } },
      { id: 'reg', label: '대회 등록 모달', tcRef: '대회_대회관리_62-99', capture: async () => { await cleanOverlays(); await admin.locator('.contents-box button.button-common.tertiary').first().click().catch(() => {}); await admin.waitForTimeout(1400); const r = (await modalRoot().isVisible({ timeout: 1200 }).catch(() => false)) ? await capKeyed(modalRoot(), 'reg') : []; await cleanOverlays(); return r; } },
      { id: 'part', label: '참가자 등록 모달', tcRef: '대회_대회관리_100-161', capture: async () => { const root = await openModalCol(editRow?.row, '참가자', 6); const r = root ? await capKeyed(root, 'part') : []; await cleanOverlays(); return r; } },
      { id: 'group', label: '조편성 모달', tcRef: '대회_대회관리_204-261', capture: async () => { const root = await openModalCol(editRow?.row, '조편성', 7); const r = root ? await capKeyed(root, 'group') : []; await cleanOverlays(); return r; } },
      { id: 'copyPopup', label: '접속 인증키 복사 안내 팝업', tcRef: '대회_대회관리_50', capture: async () => {
        if (keyColIdx < 0) return [];
        await cleanOverlays();
        const cell = (scoredRow?.row || tableBox.locator('tbody tr').first()).locator('td').nth(keyColIdx);
        // [복사] 트리거 — role=button 우선, 없으면 복사/copy 관련 클릭요소로 폴백(언어 독립)
        let b = cell.getByRole('button').first();
        if (!(await b.isVisible({ timeout: 800 }).catch(() => false))) b = cell.locator('button, a, [class*="copy"], [class*="Copy"], [class*="btn"], [role="button"]').first();
        if (!(await b.isVisible({ timeout: 800 }).catch(() => false))) return [];
        await b.click({ force: true }).catch(() => {});   // [복사] → 클립보드 복사 + 안내 모달/토스트(비파괴)
        await admin.waitForTimeout(1200);
        const mOpen = await modalRoot().isVisible({ timeout: 800 }).catch(() => false);
        // 안내 모달이 아니면 토스트(.toast-box) 확인 — 현 빌드에서 복사 안내가 토스트일 수 있음
        if (!mOpen) {
          const toast = admin.locator('.toast-box').filter({ hasText: /\S/ }).first();
          if (await toast.isVisible({ timeout: 800 }).catch(() => false)) {
            const t = (await toast.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
            await cleanOverlays();
            return t ? [{ key: 'copyPopup|toast', text: t.slice(0, 400), zone: '안내문구(토스트)' }] : [];
          }
          await cleanOverlays();
          return [];   // 복사 안내 팝업/토스트 미노출 → 검증 대상 없음(SKIP)
        }
        let slots: Slot[] = [];
        if (await modalRoot().isVisible({ timeout: 1200 }).catch(() => false)) {
          slots = await modalRoot().evaluate((root: Element) => {
            const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; };
            const T = (e: Element) => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
            const pathKey = (node: Element) => { const parts: string[] = []; let e: Element | null = node; while (e && e !== root && e.nodeType === 1) { let i = 1, sib: Element | null = e; while ((sib = sib.previousElementSibling)) if (sib.tagName === e.tagName) i++; parts.unshift(e.tagName.toLowerCase() + ':' + i); e = e.parentElement; } return parts.join('>'); };
            const m = new Map<string, { key: string; text: string; zone: string }>();
            for (const el of Array.from(root.querySelectorAll('.modal-title,.pop-title,h1,h2,h3,h4,button,[role="button"],p,.modal-body,.modal-content,[class*="desc"],[class*="text"]'))) {
              if (!vis(el)) continue; const t = T(el); if (!t || t.length > 400) continue;
              const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent || '').join('').trim();
              const txt = own && own.length >= 2 ? own : t;
              const zone = el.matches('button,[role="button"]') ? '버튼' : (el.matches('.modal-title,.pop-title,h1,h2,h3,h4') ? '제목' : '안내문구');
              m.set('copyPopup|' + pathKey(el), { key: 'copyPopup|' + pathKey(el), text: txt, zone });
            }
            return [...m.values()];
          }).catch(() => [] as Slot[]);
        }
        await cleanOverlays();
        return slots;
      } },
      // 그룹편집: [설정] 모달이 순간 노출 후 자동 닫힘 → 대기 없이 클릭 직후 빠르게 폴링해 열린 즉시 캡처(레이스 최소화). 최대 3회 재시도.
      { id: 'grpedit', label: '그룹편집 모달', tcRef: '대회_대회관리_163-205', capture: async () => {
        for (let a = 0; a < 3; a++) {
          await cleanOverlays();
          const gb = (scoredRow?.row || tableBox.locator('tbody tr').first()).locator('td').nth(colIdx('그룹편집', 8)).locator('button:enabled').first();
          if (!(await gb.isVisible({ timeout: 800 }).catch(() => false))) return [];
          await gb.click().catch(() => {});
          // 대기 최소화: 열린 순간을 빠르게 포착(≈100ms 간격 ×15) → 보이면 즉시 원자 캡처
          for (let t = 0; t < 15; t++) {
            if (await modalRoot().isVisible({ timeout: 100 }).catch(() => false)) {
              const r = await capKeyed(modalRoot(), 'grpedit');
              await cleanOverlays();
              if (r.length) return r;
              break;
            }
            await admin.waitForTimeout(100);
          }
          await cleanOverlays();
        }
        return [];
      } },
    ];

    // ① 한국어 baseline (1회 — 전 언어 공용)
    const koMap: Record<string, Slot[]> = {};
    // ⚠ copyPopup/grpedit 등 일부 랜딩은 모달 렌더/닫힘 레이스로 KO baseline이 간헐 0 → 0이면 재시도(최대 3회)해 baseline 확보(없으면 FG가 있어도 비교 불가로 SKIP됨).
    for (const L of LANDINGS) {
      let ko: Slot[] = [];
      for (let a = 0; a < 3 && !ko.length; a++) ko = await L.capture().catch(() => []);
      koMap[L.id] = ko;
    }

    // ② 언어별 순회 (in-place 전환, 재로그인 없음). 언어별 리포트 분리.
    //   ⚠ 언어당 활동(모달·새 탭 다수 개폐)이 누적되면 3번째 언어부터 헤더 언어 트리거가 막힘 →
    //      각 언어 시작 시 대회관리로 재진입(페이지 리로드)해 누적 상태 초기화(한국어 SNB 기준).
    for (const lang of LANGS) {
      resetResults(); resetNoTC(); resetDiff();
      await switchLangRobust(KOREAN);   // 재진입은 한국어 SNB 필요
      await gotoMenu(admin, '대회', '대회관리', { path: P, tcRef: '대회_대회관리', tcId: `RENAV-${lang.ko}`, desc: `${lang.ko} 전 재진입`, failMsg: '재진입 실패' }).catch(() => false);
      await settle(admin, 1500);
      const base = { path: `${P} > 언어전환`, tcRef: '대회_대회관리', tcId: `LANG-${lang.ko}`, desc: `${lang.ko}(${lang.label}) 전환` };
      const sw = await switchLangRobust(lang.label);
      if (!sw) { skip(base, `${lang.label} 전환 실패(전환/오버레이 이슈)`); await writeReport(`tournament-lang-${lang.ko}`); await switchLangRobust(KOREAN); continue; }
      await settle(admin, 1500);

      const shot = await capture(admin, { path: `${P}_${lang.ko}`, tcRef: '대회_대회관리', tcId: `LANG-${lang.ko}`, desc: `${lang.ko} 캡처` });
      const seen = new Set<string>();
      for (const L of LANDINGS) {
        const ko = koMap[L.id] || [];
        let fg = await L.capture().catch(() => []);
        // KO baseline이 있는데 FG가 0이면 레이스일 수 있어 재시도(최대 3회) → 조용한 누락 방지
        for (let a = 0; a < 2 && ko.length && !fg.length; a++) fg = await L.capture().catch(() => []);
        const fgMap = new Map(fg.map(s => [s.key, s.text]));
        if (!ko.length) {
          // KO baseline 미확보(모달 렌더 레이스)인데 FG는 캡처됨 → FG 단독 분류(원문 없이 한글잔존 판정). 둘 다 0이면 SKIP.
          if (fg.length) {
            for (const s of fg) {
              if ([...exclude].some(v => v && s.text.includes(v))) continue;
              if (!HANGUL.test(s.text) && !OTHER_SCRIPT.test(s.text)) continue;   // 숫자·기호만은 제외
              const dedup = `${L.id}|${s.zone}|${s.text}`; if (seen.has(dedup)) continue; seen.add(dedup);
              const meta = { path: `${P} > ${L.label} > ${s.zone}`, tcRef: L.tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} ${L.label} "${s.text.slice(0, 30)}"`, expected: '-(KO baseline 미확보, FG 단독 판정)' };
              if (HANGUL.test(s.text)) record(meta, 'FAIL', { actual: `${lang.label}: "${s.text}"`, error: OTHER_SCRIPT.test(s.text) ? '언어 혼재' : '한글 노출', screenshot: shot });
              else record(meta, 'PASS', { actual: `${lang.label}: "${s.text}"`, screenshot: shot });
            }
          } else skip({ path: `${P} > ${L.label}`, tcRef: L.tcRef, tcId: `LANG-${lang.ko}`, desc: `${L.label} ${lang.ko}` }, `${L.label} baseline·FG 모두 0(랜딩 실패/데이터 의존)`);
          continue;
        }
        for (const s of ko) {
          if (!HANGUL.test(s.text)) continue;                       // 한글 있는 시스템 요소만
          if ([...exclude].some(v => v && s.text.includes(v))) continue;   // 클럽·대회명 등 데이터 배제
          const dedup = `${L.id}|${s.zone}|${s.text}`; if (seen.has(dedup)) continue; seen.add(dedup);
          const fgText = fgMap.get(s.key);
          const meta = { path: `${P} > ${L.label} > ${s.zone}`, tcRef: L.tcRef, tcId: `LANG-${lang.ko}`, desc: `${lang.ko} ${L.label} "${s.text.slice(0, 30)}"`, expected: `한국어: "${s.text}"` };
          if (fgText === undefined) continue;                        // 대응 요소 없음(레이아웃 차이) → 판정 보류
          if (fgText.trim() === '') record(meta, 'FAIL', { actual: '(빈값/미노출)', error: '미노출(미번역)', screenshot: shot });
          else if (HANGUL.test(fgText)) record(meta, 'FAIL', { actual: `${lang.label}: "${fgText}"`, error: OTHER_SCRIPT.test(fgText) ? '언어 혼재' : '한글 노출', screenshot: shot });
          else record(meta, 'PASS', { actual: `${lang.label}: "${fgText}"`, screenshot: shot });
        }
      }

      // 다음 언어 위해 한국어 원복(비파괴) — 견고 전환
      await switchLangRobust(KOREAN);
      await settle(admin, 800);
      await writeReport(`tournament-lang-${lang.ko}`);
    }
    if (process.env.KEEP_OPEN) await admin.pause();
  }
});
