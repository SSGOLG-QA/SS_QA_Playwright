import { test } from '../lib/fixtures';
import { switchLanguage, KOREAN } from '../lib/langCheck';
import { record, skip, capture, resetResults, resetNoTC, resetDiff, writeReport, gotoMenu } from '../lib/reporter';
import { settle } from '../lib/adminHelpers';
import { Modal } from '../lib/components/Modal';
import type { Page, Locator } from '@playwright/test';

// ════════════════════════════════════════════════════════════
//  대회 > 대회관리 — 영어 i18n E2E 검증 (버튼 클릭 → 랜딩 화면 검증)
//   ▶ 범위 확대: 버튼 클릭 시 랜딩되는 화면(인페이지 모달 + 새 탭)까지 언어 검증.
//       - 메인 / 대회 등록 모달 / 참가자 모달 / 조편성 모달 / 그룹편집 모달
//       - 스코어 새 탭(TournamentScore) / 결과집계 새 탭(TournamentRank)  ← 기존 검증 사각지대
//   ▶ 오탐 제거: 구조적 chrome(제목·버튼·컬럼헤더·폼라벨·placeholder)만 스캔.
//       tbody/input/vue-select 선택값/데이터 배제 + 클럽명·대회명 등 고유명사 명시 배제.
//   ▶ 비파괴: 모달 취소/닫기, 새 탭 닫기, 종료 시 한국어 원복. 저장/등록/삭제 클릭 금지.
//   실행: SUBDOMAIN=td18 npx playwright test --project=admin-chromium Admin/tournament-lang-e2e.spec.ts --no-deps
// ════════════════════════════════════════════════════════════
const EN = { label: 'English', ko: '영어' };
const P = '대회 > 대회관리 > 영어 E2E';
const R = '언어검증_대회관리_E2E';

// 구조적 chrome 텍스트만 수집(데이터 철저 배제). exclude=고유명사(클럽/대회명) 배제 리스트.
async function scanChrome(page: Page, root: 'page' | Locator, exclude: string[]): Promise<string[]> {
  const scope = root === 'page' ? page.locator('body') : root;
  return scope.evaluate((el, excludeVals) => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const st = getComputedStyle(e as HTMLElement); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'; };
    // 시스템 chrome 셀렉터(데이터가 들어올 여지가 적은 것만)
    const SEL = 'button, [role="button"], thead th, [role="columnheader"], label, .form-label, dt, legend, .modal-title, .pop-title, h1, h2, h3, h4, .sub-title, [class*="section-title"]';
    // 데이터 컨테이너 배제(tbody 데이터·입력값·선택값·뱃지·칩)
    const EXCL = 'tbody, input, textarea, .vs__selected, .vs__selected-options, [contenteditable="true"], [class*="badge"], [class*="chip"] [class*="value"]';
    const out = new Set<string>();
    const add = (t: string) => {
      t = (t || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 80) return;
      if (/^[\d.,:\/\s()~%+-]+$/.test(t)) return;                 // 숫자·날짜·시간·기호만
      if (/^\d{2,4}[-.]\d{1,2}[-.]\d{1,2}/.test(t)) return;        // 날짜
      if (/^\d{6}-[0-9A-Za-z]{3,6}$/.test(t)) return;              // 접속키(YYMMDD-XXXXX)
      if (excludeVals.some(v => v && t.includes(v))) return;       // 클럽·대회명 등 고유명사
      out.add(t);
    };
    for (const node of Array.from((el as HTMLElement).querySelectorAll(SEL))) {
      if ((node as HTMLElement).closest(EXCL)) continue;
      if (!vis(node)) continue;
      // leaf 우선: 자식에 동일 텍스트를 품은 컨테이너면 건너뜀(자식이 따로 잡힘)
      const own = Array.from(node.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent || '').join('').trim();
      const inner = ((node as HTMLElement).innerText || '').trim();
      add(own && own.length >= 2 ? own : inner);
    }
    // placeholder(입력 안내문구 — 시스템 텍스트)
    for (const node of Array.from((el as HTMLElement).querySelectorAll('input[placeholder], textarea[placeholder], .vs__search[placeholder]'))) {
      if (!vis(node)) continue;
      add((node as HTMLInputElement).getAttribute('placeholder') || '');
    }
    return [...out];
  }, exclude);
}

// 한글 포함 여부 / 혼재 판정
const KO_RE = /[가-힣]/;
const classify = (s: string): 'ok' | '한글노출' | '혼재' => {
  if (!KO_RE.test(s)) return 'ok';
  return /[A-Za-z]/.test(s) ? '혼재' : '한글노출';
};

// 랜딩 화면 chrome 검증: 한글 잔존/혼재 → FAIL, 없으면 PASS(영어 표기 샘플 기록)
function verifyLanding(tcId: string, label: string, texts: string[], shot: string) {
  const defects = texts.map(t => ({ t, c: classify(t) })).filter(x => x.c !== 'ok');
  const meta = { path: `${P} > ${label}`, tcRef: R, tcId, desc: `${label} 영어 랜딩 — 시스템 표기 번역 검증`, expected: '한글 잔존/혼재 0' };
  if (!texts.length) { skip(meta, `${label} chrome 텍스트 수집 0(랜딩 실패/데이터 의존)`); return; }
  if (defects.length) {
    record(meta, 'FAIL', { error: `한글 잔존 ${defects.length}건`, detail: defects.map(d => `[${d.c}] ${d.t}`).slice(0, 15).join(' / '), screenshot: shot });
  } else {
    record(meta, 'PASS', { actual: `chrome ${texts.length}개 전부 번역(예: ${texts.slice(0, 6).join(', ')})`, screenshot: shot });
  }
}

test('대회관리 영어 i18n E2E — 버튼 랜딩 화면 검증', async ({ admin }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff();

  if (!await gotoMenu(admin, '대회', '대회관리', { path: P, tcRef: R, tcId: '진입', desc: '대회관리 진입', failMsg: '진입 불가' })) {
    await writeReport('tournament-lang-e2e'); return;
  }
  await settle(admin, 2000);
  // ⚠ 언어 독립: 컬럼헤더 텍스트('대회명')로 필터하면 영어 전환 후 매칭 실패 → 테이블 행 존재로 필터(마지막 박스)
  const tableBox = admin.locator('.contents-box').filter({ has: admin.locator('table tbody tr') }).last();
  const modal = new Modal(admin);
  const norm = (s: string) => s.replace(/\s+/g, '');
  const heads = (await tableBox.getByRole('columnheader').allInnerTexts().catch(() => [])).map(norm);
  const colIdx = (key: string, fb: number) => { const k = norm(key); let i = heads.findIndex(h => h === k); if (i < 0) i = heads.findIndex(h => h.includes(k)); return i >= 0 ? i : fb; };

  // 데이터로 배제할 고유명사: 클럽명 + 스캔 대상 행들의 대회명
  const exclude = new Set<string>(['킹즈락']);
  // 완료/진행중 행(스코어·결과집계 데이터 有) + 진행전 행(편집 모달) 후보
  const pickRow = async (statuses: string[]): Promise<{ row: Locator; name: string } | null> => {
    const rows = tableBox.locator('tbody tr');
    const n = Math.min(await rows.count().catch(() => 0), 25);
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      if (await r.locator('td').count() < 12) continue;
      const st = (await r.locator('td').last().innerText().catch(() => '')).replace(/\s+/g, '');
      if (statuses.some(s => st.includes(s))) { const name = (await r.locator('td').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(); return { row: r, name }; }
    }
    return null;
  };
  const scoredRow = await pickRow(['완료', '진행중']);
  const editRow = await pickRow(['진행전']) || scoredRow;
  for (const rr of [scoredRow, editRow]) if (rr?.name) exclude.add(rr.name);
  const EXC = [...exclude];
  console.log(`\n[TLANG] scoredRow=${scoredRow?.name} editRow=${editRow?.name} exclude=${EXC.join(',')}\n`);

  // ⚠ 언어 독립 닫기: 버튼 텍스트(취소/Cancel)는 언어 의존 → 클래스 기반 Modal.closeNonDestructive + Escape
  const closeModal = async () => {
    for (let i = 0; i < 4 && (await modal.isOpen()); i++) {
      await modal.closeNonDestructive().catch(() => {});
      if (await modal.isOpen()) { await admin.keyboard.press('Escape').catch(() => {}); await admin.waitForTimeout(400); }
    }
  };
  const openModalByCol = async (row: Locator | null, key: string, fb: number): Promise<Locator | null> => {
    if (!row) return null;
    if (await modal.isOpen()) await closeModal();
    await row.locator('td').nth(colIdx(key, fb)).getByRole('button').first().click().catch(() => {});
    await admin.waitForTimeout(1500);
    const r = admin.locator('.modal-group').filter({ hasText: /\S/ }).last();
    return (await r.isVisible({ timeout: 1500 }).catch(() => false)) ? r : null;
  };
  const openTabByCol = async (row: Locator | null, key: string, fb: number): Promise<Page | null> => {
    if (!row) return null;
    if (await modal.isOpen()) await closeModal();   // 잔존 모달이 행 버튼 클릭을 가리는 것 방지
    const b = row.locator('td').nth(colIdx(key, fb)).getByRole('button').first();
    if (!(await b.isVisible({ timeout: 800 }).catch(() => false))) return null;
    await b.scrollIntoViewIfNeeded().catch(() => {});
    const [np] = await Promise.all([admin.context().waitForEvent('page', { timeout: 9000 }).catch(() => null), b.click().catch(() => {})]);
    if (np) { await np.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {}); await np.waitForTimeout(1800); }
    return np;
  };
  // 스코어/결과집계 탭 — 사전 캡처된 scoredRow(한국어 상태 기준) 우선, 없으면 첫 라운드 행(td≥12) 순회.
  //   ⚠ 상태 텍스트(완료/진행중)는 영어 전환 후 번역되므로 필터 조건에서 제외(언어 독립). [보기]는 상태 무관 탭 오픈.
  const openTabAnyRow = async (key: string, fb: number): Promise<Page | null> => {
    const candidates: Locator[] = [];
    if (scoredRow?.row) candidates.push(scoredRow.row);
    const rows = tableBox.locator('tbody tr');
    const n = Math.min(await rows.count().catch(() => 0), 25);
    for (let i = 0; i < n; i++) { const r = rows.nth(i); if ((await r.locator('td').count().catch(() => 0)) >= 12) candidates.push(r); }
    let tried = 0;
    for (const r of candidates) {
      if (tried >= 5) break;
      tried++;
      const tab = await openTabByCol(r, key, fb);
      if (tab) return tab;
    }
    return null;
  };

  // ── 언어 전환: English ──
  const switched = await switchLanguage(admin, EN.label);
  if (!switched) {
    skip({ path: P, tcRef: R, tcId: 'TLANG-EN', desc: '영어 전환' }, '영어 전환 실패');
    await writeReport('tournament-lang-e2e'); return;
  }
  await settle(admin, 1500);

  try {
    // ── TLANG-EN-01 메인 화면 ──
    {
      const shot = await capture(admin, { path: `${P} > 메인`, tcRef: R, tcId: 'TLANG-EN-01', desc: '메인 영어' });
      const texts = await scanChrome(admin, tableBox, EXC).catch(() => []);
      const info = await scanChrome(admin, admin.locator('.contents-box').first(), EXC).catch(() => []);
      verifyLanding('TLANG-EN-01', '메인 화면(검색·컬럼·액션)', [...new Set([...texts, ...info])], shot);
    }

    // ── TLANG-EN-06 스코어 새 탭 (랜딩 검증 — 신규 커버). 모달 오픈 전 clean 상태에서 먼저 수행 ──
    {
      const tab = await openTabAnyRow('스코어', 9);
      let texts: string[] = [];
      let shot = '';
      if (tab) { texts = await scanChrome(tab, 'page', EXC).catch(() => []); shot = await capture(tab, { path: `${P} > 스코어탭`, tcRef: R, tcId: 'TLANG-EN-06', desc: '스코어 탭 영어' }); await tab.close().catch(() => {}); }
      await admin.waitForTimeout(600);
      verifyLanding('TLANG-EN-06', '스코어 새 탭(TournamentScore)', texts, shot);
    }

    // ── TLANG-EN-07 결과집계 새 탭 (랜딩 검증 — 신규 커버) ──
    {
      const tab = await openTabAnyRow('결과집계', 10);
      let texts: string[] = [];
      let shot = '';
      if (tab) { texts = await scanChrome(tab, 'page', EXC).catch(() => []); shot = await capture(tab, { path: `${P} > 결과집계탭`, tcRef: R, tcId: 'TLANG-EN-07', desc: '결과집계 탭 영어' }); await tab.close().catch(() => {}); }
      await admin.waitForTimeout(600);
      verifyLanding('TLANG-EN-07', '결과집계 새 탭(TournamentRank)', texts, shot);
    }

    // ── TLANG-EN-02 대회 등록 모달 (top [신규 등록] = button-common.tertiary) ──
    {
      if (await modal.isOpen()) await closeModal();
      await admin.locator('.contents-box button.button-common.tertiary').first().click().catch(() => {});
      await admin.waitForTimeout(1500);
      const root = admin.locator('.modal-group').filter({ hasText: /\S/ }).last();
      const ok = await root.isVisible({ timeout: 1500 }).catch(() => false);
      const shot = await capture(admin, { path: `${P} > 대회등록`, tcRef: R, tcId: 'TLANG-EN-02', desc: '대회 등록 영어' });
      verifyLanding('TLANG-EN-02', '대회 등록 모달', ok ? await scanChrome(admin, root, EXC).catch(() => []) : [], shot);
      await closeModal();
    }

    // ── TLANG-EN-03 참가자 모달 ──
    {
      const root = await openModalByCol(editRow?.row ?? null, '참가자', 6);
      const shot = await capture(admin, { path: `${P} > 참가자`, tcRef: R, tcId: 'TLANG-EN-03', desc: '참가자 영어' });
      verifyLanding('TLANG-EN-03', '참가자 등록 모달', root ? await scanChrome(admin, root, EXC).catch(() => []) : [], shot);
      await closeModal();
    }

    // ── TLANG-EN-04 조편성 모달 ──
    {
      const root = await openModalByCol(editRow?.row ?? null, '조편성', 7);
      const shot = await capture(admin, { path: `${P} > 조편성`, tcRef: R, tcId: 'TLANG-EN-04', desc: '조편성 영어' });
      verifyLanding('TLANG-EN-04', '라운드 별 조편성 모달', root ? await scanChrome(admin, root, EXC).catch(() => []) : [], shot);
      await closeModal();
    }

    // ── TLANG-EN-05 그룹편집 모달 (불안정 → best effort, 마지막 수행) ──
    {
      const root = await openModalByCol(scoredRow?.row ?? null, '그룹편집', 8);
      const texts = root ? await scanChrome(admin, root, EXC).catch(() => []) : [];
      const shot = await capture(admin, { path: `${P} > 그룹편집`, tcRef: R, tcId: 'TLANG-EN-05', desc: '그룹편집 영어' });
      verifyLanding('TLANG-EN-05', '그룹편집/핸디관리 모달', texts, shot);
      await closeModal();
    }
  } finally {
    // 비파괴 원복: 한국어
    if (await modal.isOpen()) await closeModal();
    await switchLanguage(admin, KOREAN).catch(() => {});
    await settle(admin, 800);
  }

  await writeReport('tournament-lang-e2e');
  if (process.env.KEEP_OPEN) await admin.pause();
});
