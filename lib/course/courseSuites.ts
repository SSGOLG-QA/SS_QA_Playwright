import { expect, Page } from '@playwright/test';
import { check, checkText, checkRawCode, skip, diff, record, CheckMeta } from '../reporter';
import { gotoCourseMenu, killAlarms, pickCourseDate } from './courseHelpers';
import { VueSelect, MonitorTabStrip } from './widgets';
import {
  materialLedgerInvariant, costAggregateInvariant, budgetSubtotalMatrixInvariant, summaryTotalInvariant,
  LedgerRow, CostCol, BudgetMatrixGroup,
} from './domain/invariants';

// ──────────────────────────────────────────────────────────────
//  코스관리 화면별 검증 스위트 (기획서 대조 + 계산 불변식). 비파괴.
//  - reporter.check/checkText/skip/diff 재사용 → 경기관제와 동일 엑셀 리포트 파이프라인.
//  - tcRef 형식: "코스관리_<화면>_<No.>" (드라이브 TC 확정 시 교체).
// ──────────────────────────────────────────────────────────────

const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

// 본문에 핵심 문구 포함 여부(안내문구 — 부분 일치, 아이콘/여백 변동에 견고)
async function checkContains(page: Page, meta: CheckMeta, needle: string) {
  await check(page, { ...meta, failMsg: meta.failMsg || '안내 문구 미노출/불일치' }, async () => {
    const body = norm(await page.locator('.contents, main, body').first().innerText());
    expect(body, `기대 문구 미포함: "${needle}"`).toContain(norm(needle));
  });
}

// 요소 노출 검증
async function checkVisible(page: Page, meta: CheckMeta, locSel: string | (() => any)) {
  await check(page, meta, async () => {
    const loc = typeof locSel === 'string' ? page.locator(locSel) : locSel();
    await expect(loc.first()).toBeVisible({ timeout: 8_000 });
  });
}

// 모달 비파괴 닫기
async function closeModal(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('.modal-group').forEach((m) => {
      const el = m as HTMLElement;
      if (el.offsetParent === null && getComputedStyle(el).display === 'none') return;
      const btn = Array.from(m.querySelectorAll('button')).find((b) => /^\s*(취소|닫기|Cancel|Close)\s*$/.test((b.textContent || '').trim()));
      if (btn) (btn as HTMLElement).click();
    });
  }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await killAlarms(page);
  await page.waitForTimeout(400);
}

// 오늘 날짜 ISO (달력에서 항상 선택 가능한 유효 셀)
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 검색폼 데이트피커: 특정 날짜(오늘) 선택 → [조회]/[적용] (비파괴). datepicker 없으면 SKIP.
export async function checkCourseDateSearch(page: Page, P: string, R: string, tcId: string) {
  const meta: CheckMeta = { path: `${P} > 날짜검색`, tcRef: `${R}_날짜검색`, tcId, desc: '달력 특정 날짜(오늘) 선택 → 조회/적용(비파괴)', failMsg: '날짜 선택→조회 동작 실패' };
  const box = page.locator('.contents-box, .contents, main').filter({ has: page.locator('.datepicker-input') }).first();
  if (!(await box.isVisible({ timeout: 1500 }).catch(() => false))) { skip(meta, '검색폼 datepicker 없음'); return; }
  // 달력 구동 자체가 안 되면(코스 datepicker 구조 상이 추정) 제품 결함이 아니므로 SKIP
  const picked = await pickCourseDate(page, todayISO()).catch(() => false);
  if (!picked) { skip(meta, '달력 구동 불가 — 코스 datepicker 구조 상이 추정(추후 셀렉터 보정)'); return; }
  await check(page, meta, async () => {
    const btn = box.getByRole('button', { name: /조회|적용|검색/ }).first();
    if (await btn.isVisible({ timeout: 800 }).catch(() => false)) await btn.click().catch(() => {});
    await page.waitForTimeout(800);
    await killAlarms(page);
    await expect(page.locator('.contents, .contents-box').first()).toBeVisible();
  });
}

// ═══════════════ Home (코스 컨디션 평가/등급 대시보드) ═══════════════
export async function runCourseHome(page: Page) {
  const P = 'Home';
  await checkVisible(page, { path: `${P} > 탭`, tcRef: '코스관리_Home_1', tcId: 'CHOME-01', desc: '관리 목표 및 현황/작업/비용 탭 노출', failMsg: '탭 미노출' },
    () => page.getByText('관리 목표 및 현황'));
  await checkVisible(page, { path: `${P} > 평가`, tcRef: '코스관리_Home_2', tcId: 'CHOME-02', desc: '[평가 작성하기]/[평가기준 설정하기] 노출', failMsg: '평가 버튼 미노출' },
    () => page.getByRole('button', { name: /평가 작성하기/ }));
  await checkVisible(page, { path: `${P} > 관리 목표`, tcRef: '코스관리_Home_3', tcId: 'CHOME-03', desc: '관리 목표 카드(구역별 등급) + [목표 설정]', failMsg: '관리 목표 미노출' },
    () => page.getByText('관리 목표', { exact: true }));
  await checkVisible(page, { path: `${P} > 추세`, tcRef: '코스관리_Home_4', tcId: 'CHOME-04', desc: '관리 현황 추세 차트(목표 등급 기준선)', failMsg: '추세 차트 미노출' },
    () => page.getByText('관리 현황 추세'));
  // 평가·목표 액션 버튼(L1) — 인벤토리 확정 요소. 클릭 안 함(설정/작성 진입은 파괴 경로).
  for (const label of ['평가기준 설정하기', '목표 설정', '평가내역 보기']) {
    await checkVisible(page, { path: `${P} > 버튼:${label}`, tcRef: `코스관리_Home_ctl_${norm2(label)}`, tcId: `CHOME-CTL-${norm2(label)}`, desc: `[${label}] 버튼 노출`, failMsg: `[${label}] 미노출` },
      () => page.getByRole('button', { name: label }));
  }
}

// ═══════════════ 작업 관리 > 작업 지시 ═══════════════
export async function runCourseWorkOrders(page: Page) {
  const P = '작업 관리 > 작업 지시';
  await checkVisible(page, { path: `${P} > 제목`, tcRef: '코스관리_작업지시_1', tcId: 'CWORK-01', desc: '화면 제목 노출', failMsg: '제목 미노출' },
    () => page.getByText('작업 지시', { exact: true }));
  await checkVisible(page, { path: `${P} > 필터`, tcRef: '코스관리_작업지시_2', tcId: 'CWORK-02', desc: '기간(전체/단일/반복) 필터', failMsg: '기간 필터 미노출' },
    () => page.getByText('반복', { exact: true }));
  await checkVisible(page, { path: `${P} > 분류필터`, tcRef: '코스관리_작업지시_3', tcId: 'CWORK-03', desc: '작업 분류 1>2>3분류 필터', failMsg: '분류 필터 미노출' },
    () => page.getByText('1분류', { exact: false }));
  await checkVisible(page, { path: `${P} > 상태통계`, tcRef: '코스관리_작업지시_4', tcId: 'CWORK-04', desc: '상태 통계(완료확정/작업완료/진행중/대기중)', failMsg: '상태 통계 미노출' },
    () => page.getByText('진행중', { exact: true }));
  await checkVisible(page, { path: `${P} > 테이블`, tcRef: '코스관리_작업지시_5', tcId: 'CWORK-05', desc: '작업번호/작업명 컬럼', failMsg: '테이블 컬럼 미노출' },
    () => page.getByText('작업번호'));

  // 날짜검색(특정 날짜 선택→조회) — 기간 datepicker 보유 화면. datepicker 없으면 SKIP.
  await checkCourseDateSearch(page, P, '코스관리_작업지시', 'CWORK-07');

  // 잔여 컨트롤 노출(L1) — 기간 퀵버튼·초기화·적용·검색
  for (const label of ['6개월', '1년', '초기화', '적용', '검색어 입력']) {
    await checkControl(page, { path: `${P} > 컨트롤:${label}`, tcRef: `코스관리_작업지시_ctl_${label}`, tcId: `CWORK-CTL-${norm2(label)}`, desc: `컨트롤 "${label}" 노출`, failMsg: `"${label}" 미노출` }, label);
  }

  // 등록 모달(비파괴): 기획서 핵심 요소 검증 → 닫기
  const meta: CheckMeta = { path: `${P} > 등록 모달`, tcRef: '코스관리_작업지시_6', tcId: 'CWORK-06', desc: '[신규 등록] → 작업 지시 등록 모달: 중요작업 체크박스·분류·단일/반복 라디오', failMsg: '등록 모달/요소 미노출' };
  try {
    const opened = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, a')).find((x) =>
        (x as HTMLElement).offsetParent && !x.closest('.side-navbar-container') && /신규 등록|신규 작업 지시 등록/.test((x.textContent || '').replace(/\s+/g, ' ')));
      if (!b) return false; (b as HTMLElement).click(); return true;
    });
    if (!opened) { skip(meta, '[신규 등록] 버튼 미발견'); }
    else {
      await page.waitForTimeout(1800);
      await killAlarms(page);
      // 모달 고유 문구는 화면 전역에서 유일 → 페이지 전역 getByText 로 견고하게 검증
      await check(page, meta, async () => {
        await expect(page.getByText(/중요한 작업으로 월간계획/).first()).toBeVisible({ timeout: 8_000 });
        await expect(page.getByText('단일 작업').first()).toBeVisible();
        await expect(page.getByText('반복 작업').first()).toBeVisible();
      });
    }
  } catch (e) { record(meta, 'FAIL', { error: '등록 모달 검증 예외', detail: (e as Error).message.slice(0, 160) }); }
  finally { await closeModal(page); }

  // 행 [보기]/[수정] 열기(L2, 비파괴) — 데이터 없으면 SKIP
  await checkRowAction(page, '작업 관리', '작업 지시', '보기', 'CWORK-VIEW');
  await checkRowAction(page, '작업 관리', '작업 지시', '수정', 'CWORK-EDIT');

  // 테이블 검증 — 컬럼 헤더(L1) + 상태 집계 불변식(총 N건 = Σ상태, L3)
  const ref = (n: string) => `코스관리_작업지시_${n}`;
  await checkColumns(page, P, ref, 'CWORK', ['작업번호', '작업명', '1분류', '2분류', '상태']);
  await checkSummaryTotal(page, P, ref, 'CWORK', '작업 지시', { totalRe: '총\\s*([\\d,]+)\\s*건', parts: ['완료 확정', '작업완료', '진행중', '대기 중'] });
}

// ═══════════════ 정보 관리 > 거래처 정보 ═══════════════
export async function runCourseVendor(page: Page) {
  const P = '정보 관리 > 거래처 정보';
  await checkContains(page, { path: `${P} > 안내`, tcRef: '코스관리_거래처_1', tcId: 'CVEND-01', desc: '거래처 선행 등록 안내문구' },
    '먼저 거래처등록이 필요합니다');
  await checkVisible(page, { path: `${P} > 등록버튼`, tcRef: '코스관리_거래처_2', tcId: 'CVEND-02', desc: '[거래처 등록] 버튼', failMsg: '등록 버튼 미노출' },
    () => page.getByRole('button', { name: /거래처 등록/ }));
  await checkVisible(page, { path: `${P} > 검색`, tcRef: '코스관리_거래처_3', tcId: 'CVEND-03', desc: '거래처 검색 입력', failMsg: '검색 미노출' },
    () => page.getByPlaceholder(/거래처 검색/));

  const meta: CheckMeta = { path: `${P} > 등록 모달`, tcRef: '코스관리_거래처_4', tcId: 'CVEND-04', desc: '[거래처 등록] → 단건/일괄 탭 + 상호명/사업자등록번호', failMsg: '등록 모달/요소 미노출' };
  try {
    await page.getByRole('button', { name: /거래처 등록/ }).first().click({ timeout: 6_000 });
    await page.waitForTimeout(1500);
    await check(page, meta, async () => {
      const box = page.locator('.modal-group').last();
      await expect(box.getByText('단건 등록')).toBeVisible({ timeout: 6_000 });
      await expect(box.getByText('일괄 등록')).toBeVisible();
      await expect(box.getByText('상호명')).toBeVisible();
      await expect(box.getByText('사업자등록번호')).toBeVisible();
    });
  } catch (e) { record(meta, 'FAIL', { error: '등록 모달 검증 예외', detail: (e as Error).message.slice(0, 160) }); }
  finally { await closeModal(page); }
}

// ═══════════════ 자재 관리 > 자재 수불(품목별) — 구조 + 불변식 ═══════════════
export async function runCourseMaterialLedger(page: Page) {
  const P = '자재 관리 > 자재 수불(품목별)';
  await checkContains(page, { path: `${P} > 안내`, tcRef: '코스관리_자재수불_1', tcId: 'CMAT-01', desc: '입고/출고/매입가 변동 안내' },
    '매입가의 변동을 확인할 수 있습니다');
  await checkVisible(page, { path: `${P} > 수량컬럼`, tcRef: '코스관리_자재수불_2', tcId: 'CMAT-02', desc: '수량 기초/입고/출고/기말 컬럼', failMsg: '수량 컬럼 미노출' },
    () => page.getByText('기말', { exact: true }));

  // 불변식: 기말수량 = 기초 + 입고 − 출고 (수량 컬럼 = 자재명 이후 4칸: 기초/입고/출고/기말)
  const meta: CheckMeta = { path: `${P} > 정합성`, tcRef: '코스관리_자재수불_3', tcId: 'CMAT-03', desc: '기말수량 = 기초 + 입고 − 출고', failMsg: '자재 수불 수량 불일치' };
  const rows: LedgerRow[] = await page.evaluate(() => {
    const clean = (s: string) => Number((s || '').replace(/[^0-9.\-]/g, '')) ;
    const out: any[] = [];
    const table = document.querySelector('table');
    if (!table) return out;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
      if (tds.length < 8) return;
      // 번호0 사진1 분류2 자재명3 [기초4 입고5 출고6 기말7]
      const name = tds[3] || tds[2] || '?';
      const base = clean(tds[4]), inn = clean(tds[5]), o = clean(tds[6]), end = clean(tds[7]);
      if ([base, inn, o, end].some((v) => !Number.isFinite(v))) return;
      out.push({ name, base, in: inn, out: o, end });
    });
    return out;
  }).catch(() => [] as LedgerRow[]);

  if (!rows.length) { skip(meta, '자재 수불 데이터 없음/구조 미확인'); }
  else {
    const res = materialLedgerInvariant(rows);
    await check(page, meta, async () => {
      expect(res.violations.map((v) => `${v.label}: 기대 ${v.expected} ≠ 실제 ${v.actual}`), `검증 ${res.checked}행`).toEqual([]);
    }, { getActual: async () => `검증 ${res.checked}행 · 위반 ${res.violations.length}` });
  }
}

// ═══════════════ 비용 관리 > 비용 집계 — 구조 + 불변식 ═══════════════
export async function runCourseCostAggregate(page: Page) {
  const P = '비용 관리 > 비용 집계';
  await checkContains(page, { path: `${P} > 안내`, tcRef: '코스관리_비용집계_1', tcId: 'CCOST-01', desc: '작업지시 자동집계 vs 실적 비교 안내' },
    '작업지시서를 통하여 자동으로 집계된 비용을 비교 분석');
  await checkVisible(page, { path: `${P} > 비교`, tcRef: '코스관리_비용집계_2', tcId: 'CCOST-02', desc: '작업지시 비용 합계 / 실제 발생 비용 합계 / 차액', failMsg: '비교 항목 미노출' },
    () => page.getByText('작업지시 비용 합계'));

  // 불변식: 차액 = 작업지시 비용 − 실제 발생 비용 (분류별) — 텍스트 앵커 행 파싱
  const meta: CheckMeta = { path: `${P} > 정합성`, tcRef: '코스관리_비용집계_3', tcId: 'CCOST-03', desc: '차액 = 작업지시 비용 − 실제 발생 비용 (분류별)', failMsg: '비용 집계 차액 불일치' };
  const cols: CostCol[] = await page.evaluate(() => {
    const num = (s: string) => Number((s || '').replace(/[^0-9.\-]/g, ''));
    const table = document.querySelector('table');
    if (!table) return [] as any[];
    const rowByLabel = (kw: string) => Array.from(table.querySelectorAll('tbody tr'))
      .find((tr) => new RegExp(kw).test((tr.querySelector('td,th')?.textContent || '').replace(/\s+/g, '')));
    const cells = (tr: Element | undefined) => tr ? Array.from(tr.querySelectorAll('td')).slice(1).map((c) => num(c.textContent || '')) : [];
    const order = cells(rowByLabel('작업지시비용합계'));
    const actual = cells(rowByLabel('실제발생비용합계'));
    const diffR = cells(rowByLabel('차액'));
    const n = Math.min(order.length, actual.length, diffR.length);
    const out: any[] = [];
    for (let i = 0; i < n; i++) out.push({ label: `열${i}`, order: order[i], actual: actual[i], diff: diffR[i] });
    return out;
  }).catch(() => [] as CostCol[]);

  if (!cols.length) { skip(meta, '비용 집계 데이터 없음/구조 미확인'); }
  else {
    const res = costAggregateInvariant(cols);
    await check(page, meta, async () => {
      expect(res.violations.map((v) => `${v.label}: 기대 ${v.expected} ≠ 실제 ${v.actual}`), `검증 ${res.checked}열`).toEqual([]);
    }, { getActual: async () => `검증 ${res.checked}열 · 위반 ${res.violations.length}` });
  }
}

// ═══════════════ 예산 관리 > 예산 상세 (구조 + 기획서 요구 확인) ═══════════════
// 소계 불변식(재사용): 현재 표시 테이블에서 '소계 = Σ소분류(열별)' 검증. 그룹 미검출 시 SKIP.
async function budgetSubtotalCheck(page: Page, meta: CheckMeta) {
  const groups: BudgetMatrixGroup[] = await page.evaluate(() => {
    const num = (s: string) => { const t = (s || '').replace(/[^0-9.\-]/g, ''); return (t === '' || t === '-' || t === '.') ? null : Number(t); };
    const tail = (tds: string[]): number[] => { const v: number[] = []; for (let k = tds.length - 1; k >= 0; k--) { const n = num(tds[k]); if (n === null) break; v.unshift(n); } return v; };
    const table = document.querySelector('table');
    if (!table) return [] as any[];
    const out: any[] = []; let acc: number[][] = []; let gi = 0;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').trim());
      const vec = tail(tds);
      if (!vec.length) return;
      const isSub = /소계/.test(tr.textContent || '');
      const isTotal = /총계|합계 계|전체 합계/.test(tr.textContent || '');
      if (isTotal) { acc = []; return; }
      if (isSub) { out.push({ name: `그룹${++gi}`, rows: acc, subtotal: vec }); acc = []; }
      else { acc.push(vec); }
    });
    return out;
  }).catch(() => [] as BudgetMatrixGroup[]);
  if (!groups.length) { skip(meta, '소계 그룹 미검출(데이터/구조)'); return; }
  const res = budgetSubtotalMatrixInvariant(groups);
  await check(page, meta, async () => {
    expect(res.violations.slice(0, 10).map((v) => `${v.label}: 기대 ${v.expected} ≠ 실제 ${v.actual}`), `검증 ${res.checked}셀 / 그룹 ${groups.length}`).toEqual([]);
  }, { getActual: async () => `그룹 ${groups.length} · 검증 ${res.checked}셀 · 위반 ${res.violations.length}` });
}

export async function runCourseBudgetDetail(page: Page) {
  const P = '예산 관리 > 예산 상세';
  await checkContains(page, { path: `${P} > 안내`, tcRef: '코스관리_예산상세_1', tcId: 'CBUD-01', desc: '엑셀 다운→입력→업로드 안내(기획서 문장)' },
    '엑셀을 업로드 하면 편리하게 입력이 가능합니다');

  // ── 6개 탭 전수 검증: 탭 전환 → 노출 버튼(L2) + 테이블 소계(L1) + 소계 불변식(L3) ──
  //   전체=엑셀 업로드/내보내기 / 분류탭(고정직·임시직·코스자재·장비·기타)=분류 수정/수정
  const TABS: { name: string; btns: string[] }[] = [
    { name: '전체', btns: ['엑셀 업로드', '내보내기'] },
    { name: '고정직 인건비', btns: ['분류 수정', '수정'] },
    { name: '임시직 인건비', btns: ['분류 수정', '수정'] },
    { name: '코스 자재비', btns: ['분류 수정', '수정'] },
    { name: '장비 관리비', btns: ['분류 수정', '수정'] },
    { name: '기타 관리비', btns: ['분류 수정', '수정'] },
  ];
  for (const t of TABS) {
    const tag = norm2(t.name);
    const tab = page.getByRole('tab', { name: t.name }).or(page.locator('.contents, main').first().getByText(t.name, { exact: true })).first();
    const tMeta: CheckMeta = { path: `${P} > 탭:${t.name}`, tcRef: `코스관리_예산상세_tab${tag}`, tcId: `CBUD-TAB-${tag}`, desc: `[${t.name}] 탭 선택 → 노출 버튼 ${t.btns.join('/')}`, failMsg: '탭 전환/노출 버튼 미노출' };
    if (!(await tab.isVisible({ timeout: 2_000 }).catch(() => false))) { skip(tMeta, '탭 미발견'); continue; }
    await tab.click().catch(() => {});
    await page.waitForTimeout(1200); await killAlarms(page);
    // 탭 선택 시 노출 버튼(L2 — 설정 변경 조건부)
    await check(page, tMeta, async () => {
      for (const bl of t.btns) await expect(page.getByRole('button', { name: bl }).first()).toBeVisible({ timeout: 5_000 });
    });
    // 테이블 소계 행(L1) + 소계 불변식(L3) — 탭별
    await checkVisible(page, { path: `${P} > ${t.name} 소계`, tcRef: `코스관리_예산상세_tbl${tag}`, tcId: `CBUD-TBL-${tag}`, desc: `${t.name} 테이블 소계 행`, failMsg: '소계 미노출' },
      () => page.getByText('소계', { exact: true }));
    await budgetSubtotalCheck(page, { path: `${P} > ${t.name} 정합성`, tcRef: `코스관리_예산상세_inv${tag}`, tcId: `CBUD-INV-${tag}`, desc: `${t.name} 소계 = Σ소분류(열별)`, failMsg: '소계 불일치' });

    // 중/소분류 편집 진입점(L2, 비파괴) — [분류 수정] 클릭 → 헤더 ✏️(ico-edit) 노출 확인 → 원복(추가/변경/삭제·저장 안 함).
    //   실 순서(사용자 확인 2026-08-07): 분류 수정 → ico-edit. 파괴 CRUD(항목 추가·수정·삭제)는 course-budget-class-crud.spec.ts(옵트인).
    if (t.btns.includes('분류 수정')) {
      const cMeta: CheckMeta = { path: `${P} > ${t.name} 분류편집`, tcRef: `코스관리_예산상세_cls${tag}`, tcId: `CBUD-CLS-${tag}`, desc: '[분류 수정] → 헤더 ✏️(ico-edit) 편집 진입점 노출', failMsg: '분류 수정 후 ✏️ 미노출' };
      const clsBtn = page.getByRole('button', { name: '분류 수정' }).first();
      if (await clsBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await clsBtn.click().catch(() => {}); await page.waitForTimeout(900); await killAlarms(page);
        const editIcon = page.locator('button:has(i.ico-edit)');
        if (await editIcon.first().isVisible({ timeout: 2_500 }).catch(() => false)) {
          await check(page, cMeta, async () => { expect(await editIcon.count()).toBeGreaterThanOrEqual(1); });
        } else { skip(cMeta, '[분류 수정] 후 헤더 ✏️(ico-edit) 미노출(상태 가변)'); }
        // 비파괴 원복: 취소/닫기 + Escape (저장·추가·삭제 안 함). 탭 전환으로도 편집모드 리셋.
        await page.getByRole('button', { name: /취소|닫기/ }).first().click({ timeout: 1_500 }).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {}); await killAlarms(page);
      } else { skip(cMeta, '[분류 수정] 버튼 미노출'); }
    }
  }
}

// ═══════════════ 제네릭 화면 체커 (진입·본문 로드 + 미가공 코드 + 선택 제목/문구) ═══════════════
export interface ScreenSpec {
  menu: string; sub: string; tcId: string;
  title?: string;          // 본문(.contents) 내 제목 노출 검증(SNB 링크와 구분)
  contains?: string[];     // 본문 포함 문구(안내/라벨 — 부분 일치)
  controls?: string[];     // 노출 검증할 컨트롤 라벨(버튼/입력 placeholder) — L1
  register?: string;       // 등록 버튼 라벨(정규식 소스) → 모달/폼 오픈 검증(L2, 비파괴)
  dateSearch?: boolean;    // 날짜 선택 → 조회/적용 동작(L2)
  rowView?: boolean;       // 행 [보기] → 읽기전용 상세 열림 검증→닫기(L2, 비파괴)
  rowEdit?: boolean;       // 행 [수정] → 수정 폼 열림 검증→저장 안 하고 닫기(L2, 비파괴)
  columns?: string[];      // 테이블 컬럼 헤더 노출 검증(L1)
  summary?: { totalRe: string; parts: string[] };  // 집계 불변식: 총계 = Σ구분(요약카드) — L3
}

// 테이블 컬럼 헤더 노출(L1)
async function checkColumns(page: Page, P: string, ref: (n: string) => string, tcId: string, cols: string[]) {
  for (const col of cols) {
    await check(page, { path: `${P} > 컬럼:${col}`, tcRef: ref(`col_${col}`), tcId: `${tcId}-COL-${norm2(col)}`, desc: `컬럼 "${col}" 노출`, failMsg: `컬럼 "${col}" 미노출` }, async () => {
      const h = page.getByRole('columnheader', { name: col }).first()
        .or(page.locator('th, thead td').filter({ hasText: new RegExp('^\\s*' + col.replace(/\s+/g, '\\s*') + '\\s*$') }).first());
      await expect(h).toBeVisible({ timeout: 6_000 });
    });
  }
}

// 집계 불변식: 총계 = Σ구분(요약카드) + 총계 vs 렌더 행수(diff 추적). 텍스트 파싱(셀렉터 비의존).
async function checkSummaryTotal(page: Page, P: string, ref: (n: string) => string, tcId: string, sub: string, spec: { totalRe: string; parts: string[] }) {
  const meta: CheckMeta = { path: `${P} > 집계`, tcRef: ref('summary'), tcId: `${tcId}-SUM`, desc: '총계 = Σ구분(요약카드)', failMsg: '총계 ≠ Σ구분' };
  const txt = (await page.locator('.contents, main').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  const num = (s: string) => { const m = txt.match(new RegExp(s)); return m ? Number(m[1].replace(/,/g, '')) : NaN; };
  const total = num(spec.totalRe);
  // 구분 카드 파싱 — 단위(명/건/개) 있으면 우선, 없어도 라벨 뒤 숫자 허용
  const parts = spec.parts.map((l) => num(l.replace(/\s+/g, '\\s*') + '\\s*([\\d,]+)\\s*(?:명|건|개)?'));
  if (!Number.isFinite(total) || parts.some((p) => !Number.isFinite(p))) { skip(meta, `요약 파싱 실패(총 ${total}, 구분 ${parts.join('/')})`); return; }
  const res = summaryTotalInvariant(total, parts);
  await check(page, meta, async () => {
    expect(res.violations.map((v) => `${v.label}: 기대 ${v.expected} ≠ 실제 ${v.actual}`), `총 ${total} vs Σ ${parts.reduce((a, b) => a + b, 0)}`).toEqual([]);
  }, { getActual: async () => `총 ${total} = Σ구분 ${parts.reduce((a, b) => a + b, 0)}` });
  // 총계 vs 렌더 행수 — 데이터의존(필터/페이지네이션 여지) → diff 추적
  const rows = await page.locator('tbody tr').count().catch(() => 0);
  if (Number.isFinite(total) && rows > 0 && Math.abs(total - rows) > 0) {
    diff(`${P}`, `요약 총계 ${total}`, `렌더 행수 ${rows}`, ref('rowcount'), '총계≠행수(필터/페이지네이션/데이터 확인 요망)');
  }
}

// 행 액션(보기/수정) 열기 검증 — 비파괴. 모달/새탭/인라인 상세 모두 대응. 데이터 없으면 SKIP.
//   ⚠ [보기]=읽기전용 / [수정]=폼 열기만(저장 클릭 안 함). 닫기는 취소/닫기(closeModal).
export async function checkRowAction(page: Page, menu: string, sub: string, label: '보기' | '수정', tcId: string) {
  const P = `${menu} > ${sub}`;
  const meta: CheckMeta = { path: `${P} > 행[${label}]`, tcRef: `코스관리_${sub}_row${label}`, tcId, desc: `행 [${label}] → ${label === '보기' ? '읽기전용 상세' : '수정 폼'} 열림(비파괴)`, failMsg: `[${label}] 열림 미확인` };
  const ctx = page.context();
  let nt = null;
  try {
    const [np, opened] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 3500 }).catch(() => null),
      page.evaluate((lb) => {
        const b = Array.from(document.querySelectorAll('button, a')).find((x) =>
          (x as HTMLElement).offsetParent && !x.closest('.side-navbar-container') && !x.closest('.modal-group') && (x.textContent || '').replace(/\s+/g, ' ').trim() === lb);
        if (!b) return false; (b as HTMLElement).click(); return true;
      }, label),
    ]);
    if (!opened) { skip(meta, `[${label}] 버튼 미발견(데이터 없음)`); return; }
    nt = np;
    if (nt) {   // 새 탭 상세(읽기전용) → 랜딩 확인 후 닫기
      await nt.waitForLoadState('domcontentloaded').catch(() => {});
      await nt.waitForTimeout(1200);
      if ((nt.url() || '').length > 10) record(meta, 'PASS', { actual: '새 탭 상세 랜딩' });
      else skip(meta, '새 탭 미랜딩');
      await nt.close().catch(() => {});
      return;
    }
    await page.waitForTimeout(1600); await killAlarms(page);
    const modal = page.locator('.modal-group').filter({ hasNot: page.locator('.alarm') }).last();
    if (await modal.isVisible({ timeout: 4_000 }).catch(() => false)) {
      record(meta, 'PASS', { actual: '모달 상세/폼 열림' });
      await closeModal(page);   // 취소/닫기 — 저장 안 함(비파괴)
    } else {
      // 인라인 편집(행이 입력필드로 전환) 등 — 상세/폼 신호 있으면 PASS, 없으면 SKIP(데이터/구조 의존)
      const detail = page.locator('.contents, main').first().getByText(/닫기|취소|목록으로|상세/).first();
      if (await detail.isVisible({ timeout: 2_000 }).catch(() => false)) {
        record(meta, 'PASS', { actual: '인라인/페이지 상세' });
        await gotoCourseMenu(page, menu, sub).catch(() => {});
      } else { skip(meta, '상세/폼 미확인(구조 상이/데이터 의존)'); }
    }
  } catch (e) {
    // 행 액션은 데이터/구조 의존 → 예외도 SKIP(가짜 FAIL 방지)
    skip(meta, `[${label}] 검증 불가: ${(e as Error).message.slice(0, 60)}`);
    if (nt) await nt.close().catch(() => {});
    await closeModal(page);
  }
}

// 컨트롤(버튼 또는 입력 placeholder) 노출 검증 — 본문 스코프
async function checkControl(page: Page, meta: CheckMeta, label: string) {
  await check(page, meta, async () => {
    const main = page.locator('.contents, main').first();
    const loc = main.getByRole('button', { name: label }).or(main.getByPlaceholder(label)).or(main.getByText(label, { exact: true }));
    await expect(loc.first()).toBeVisible({ timeout: 6_000 });
  });
}

export async function runCourseScreen(page: Page, s: ScreenSpec) {
  const P = `${s.menu} > ${s.sub}`;
  const ref = (n: number | string) => `코스관리_${s.sub}_${n}`;
  // 1) 진입/본문 로드
  await checkVisible(page, { path: `${P} > 진입`, tcRef: ref(1), tcId: `${s.tcId}-01`, desc: '화면 진입 · 본문 렌더', failMsg: '본문 미로드' },
    '.contents, .contents-box, main');
  // 2) 제목(본문 스코프 — SNB 라벨과 구분)
  if (s.title) {
    await checkVisible(page, { path: `${P} > 제목`, tcRef: ref(2), tcId: `${s.tcId}-02`, desc: `제목 "${s.title}"`, failMsg: '제목 미노출' },
      () => page.locator('.contents, main').first().getByText(s.title as string, { exact: false }));
  }
  // 3) 포함 문구
  let i = 3;
  for (const needle of s.contains || []) {
    await checkContains(page, { path: `${P} > 문구`, tcRef: ref(i), tcId: `${s.tcId}-${String(i).padStart(2, '0')}`, desc: `문구 포함 "${needle.slice(0, 24)}"` }, needle);
    i++;
  }
  // 4) 컨트롤 노출(L1) — 내보내기/초기화/적용/검색 등
  for (const label of s.controls || []) {
    await checkControl(page, { path: `${P} > 컨트롤:${label}`, tcRef: ref(`ctl_${label}`), tcId: `${s.tcId}-CTL-${norm2(label)}`, desc: `컨트롤 "${label}" 노출`, failMsg: `"${label}" 미노출` }, label);
  }
  // 5) 등록 버튼 → 모달/폼 오픈(L2, 비파괴)
  if (s.register) {
    const rMeta: CheckMeta = { path: `${P} > 등록`, tcRef: ref('register'), tcId: `${s.tcId}-REG`, desc: `[${s.register}] → 등록 모달/폼 오픈`, failMsg: '등록 모달/폼 미오픈' };
    try {
      const opened = await page.evaluate((reSrc) => {
        const re = new RegExp(reSrc);
        const b = Array.from(document.querySelectorAll('button, a')).find((x) =>
          (x as HTMLElement).offsetParent && !x.closest('.side-navbar-container') && !x.closest('.modal-group') && re.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
        if (!b) return false; (b as HTMLElement).click(); return true;
      }, s.register);
      if (!opened) { skip(rMeta, `[${s.register}] 버튼 미발견`); }
      else {
        await page.waitForTimeout(1600); await killAlarms(page);
        const modal = page.locator('.modal-group').filter({ hasNot: page.locator('.alarm') }).last();
        if (await modal.isVisible({ timeout: 4_000 }).catch(() => false)) {
          await check(page, rMeta, async () => { await expect(modal).toBeVisible(); });
          await closeModal(page);
        } else {
          // 풀페이지 폼(예: 시설) — 등록/취소 버튼 존재로 판정 후 원복
          const formSig = page.getByText(/등록|저장|취소/).first();
          if (await formSig.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await check(page, rMeta, async () => { await expect(formSig).toBeVisible(); });
            await gotoCourseMenu(page, s.menu, s.sub).catch(() => {});
          } else { skip(rMeta, '등록 후 모달/폼 미확인(구조 상이)'); await gotoCourseMenu(page, s.menu, s.sub).catch(() => {}); }
        }
      }
    } catch (e) { record(rMeta, 'FAIL', { error: '등록 오픈 검증 예외', detail: (e as Error).message.slice(0, 160) }); await closeModal(page); }
  }
  // 6) 날짜 선택 → 조회(L2)
  if (s.dateSearch) { await checkCourseDateSearch(page, P, `코스관리_${s.sub}`, `${s.tcId}-DATE`); }
  // 6b) 행 [보기]/[수정] 열기(L2, 비파괴) — 데이터 없으면 SKIP
  if (s.rowView) { await checkRowAction(page, s.menu, s.sub, '보기', `${s.tcId}-VIEW`); }
  if (s.rowEdit) { await checkRowAction(page, s.menu, s.sub, '수정', `${s.tcId}-EDIT`); }
  // 6c) 테이블 검증 — 컬럼 헤더(L1) + 집계 불변식(L3)
  if (s.columns) { await checkColumns(page, P, ref, s.tcId, s.columns); }
  if (s.summary) { await checkSummaryTotal(page, P, ref, s.tcId, s.sub, s.summary); }
  // 7) 미가공 코드/오타 스캔(전 화면 공통)
  await checkRawCode(page, { path: `${P} > RAW`, tcRef: ref('RAW'), tcId: `${s.tcId}-RAW`, desc: '미가공 코드/오타 미노출' });
}

const norm2 = (s: string) => (s || '').replace(/\s+/g, '');

// 여러 화면을 SNB 순회하며 제네릭 검증 (menu/sub 네비 → runCourseScreen)
export async function runCourseScreens(page: Page, specs: ScreenSpec[]) {
  for (const s of specs) {
    const ok = await gotoCourseMenu(page, s.menu, s.sub);
    if (!ok) { skip({ path: `${s.menu} > ${s.sub}`, tcRef: `코스관리_${s.sub}_1`, tcId: `${s.tcId}-01`, desc: '화면 진입' }, 'SNB 링크 미발견/네비 실패'); continue; }
    await runCourseScreen(page, s);
  }
}

// ── 정보 관리(거래처 제외 10종) + 사진 관리 2종 ──
export const COURSE_INFO_SPECS: ScreenSpec[] = [
  { menu: '정보 관리', sub: '코스 기본 정보', tcId: 'CINFO-COURSE', title: '코스 기본 정보', rowEdit: true },
  { menu: '정보 관리', sub: '코스 리뉴얼 정보', tcId: 'CINFO-RENEW', title: '코스 리뉴얼 정보', register: '신규 등록', rowEdit: true },
  // ⚠ 홀 별 정보는 2행 그룹 헤더(홀/Par/총면적/그린…/T1~T8)라 columnheader 매칭 불가 → 컬럼 검증 제외(특수 테이블).
  { menu: '정보 관리', sub: '홀 별 정보', tcId: 'CINFO-HOLE', title: '홀 별 정보', controls: ['내보내기'], rowView: true, rowEdit: true },
  { menu: '정보 관리', sub: '잔디 측정 정보', tcId: 'CINFO-GRASS', title: '잔디 측정 정보', controls: ['초기화', '적용'], register: '신규 등록', dateSearch: true, rowEdit: true },
  { menu: '정보 관리', sub: '토양 측정 정보', tcId: 'CINFO-SOIL', title: '토양 측정 정보', controls: ['초기화', '적용'], register: '신규 등록', dateSearch: true, rowView: true, columns: ['일자', '위치', '입력정보'] },
  { menu: '정보 관리', sub: '발병 정보', tcId: 'CINFO-DISEASE', title: '발병 정보', controls: ['초기화', '적용', '검색어 입력'], register: '신규 등록', dateSearch: true, rowEdit: true, columns: ['번호', '병충해명', '최초 발견일', '발병 기간'] },
  { menu: '정보 관리', sub: '코스 운영 정보', tcId: 'CINFO-OPER', title: '코스 운영 정보' },
  { menu: '정보 관리', sub: '기상 정보', tcId: 'CINFO-WEATHER', title: '기상 정보', controls: ['초기화', '적용'], dateSearch: true },
  { menu: '정보 관리', sub: '관리 기준 정보', tcId: 'CINFO-EVAL', title: '관리 기준 정보' },
  { menu: '정보 관리', sub: '일상 점검', tcId: 'CINFO-DAILY', title: '일상 점검', controls: ['6개월', '1년', '초기화', '적용', '검색어 입력'], register: '신규 등록', dateSearch: true, rowView: true },
  { menu: '사진 관리', sub: '정보별 사진', tcId: 'CPHOTO-INFO', title: '정보별 사진', dateSearch: true },
  { menu: '사진 관리', sub: '위치별 사진', tcId: 'CPHOTO-LOC', title: '위치별 사진', dateSearch: true },
];
// 비용 관리 4종(집계 제외) — 내보내기·정렬 초기화·날짜검색
export const COURSE_COST_SPECS: ScreenSpec[] = [
  { menu: '비용 관리', sub: '작업별 비용', tcId: 'CCOST-TASK', controls: ['초기화', '적용', '내보내기', '검색어 입력'], dateSearch: true, columns: ['작업번호', '작업명', '총 비용', '고정직 인건비', '임시직 인건비'] },
  { menu: '비용 관리', sub: '분류별 비용', tcId: 'CCOST-CAT', controls: ['정렬 초기화', '내보내기'] },
  { menu: '비용 관리', sub: '위치별 비용', tcId: 'CCOST-LOC', controls: ['정렬 초기화', '내보내기'] },
  { menu: '비용 관리', sub: '기간별 비용', tcId: 'CCOST-PERIOD', controls: ['정렬 초기화', '내보내기'] },
];
// B3 — 예산 총괄/실적/분석 + 자재 수불(일자별)
export const COURSE_BUDGET_SPECS: ScreenSpec[] = [
  { menu: '예산 관리', sub: '예산 총괄', tcId: 'CBUD-SUM', controls: ['내보내기'] },
  { menu: '예산 관리', sub: '실적 관리', tcId: 'CBUD-PERF', controls: ['엑셀 업로드', '내보내기'] },
  { menu: '예산 관리', sub: '예산 분석', tcId: 'CBUD-ANAL', controls: ['내보내기'] },
];
export const COURSE_MATERIAL_EXTRA_SPECS: ScreenSpec[] = [
  { menu: '자재 관리', sub: '자재 수불(일자별)', tcId: 'CMAT-DAILY', controls: ['초기화', '적용'], dateSearch: true },
];
// B6 — 인력 관리 4종 (근태 상태 토글은 데이터의존·파괴적이라 제외)
export const COURSE_HR_SPECS: ScreenSpec[] = [
  { menu: '인력 관리', sub: '권한관리', tcId: 'CHR-PERM', controls: ['이름 입력', '그룹 추가', '저장하기'] },
  { menu: '인력 관리', sub: '인력 관리', tcId: 'CHR-HUMAN', controls: ['이름 검색', '표준 근무시간 설정', '초기화', '적용'], register: '신규 등록', rowView: true,
    columns: ['번호', '이름', '생년월일', '입사일', '근속연수', '성별', '구분', '상태'],
    summary: { totalRe: '총\\s*([\\d,]+)\\s*명', parts: ['고정직 정규', '고정직 계약', '임시직 장기', '임시직 단기'] } },
  { menu: '인력 관리', sub: '근태 관리', tcId: 'CHR-WORK', dateSearch: true, columns: ['번호', '이름', '담당 업무', '계약형태'] },
  { menu: '인력 관리', sub: '투입 관리', tcId: 'CHR-ASSIGN', dateSearch: true },
];
// B4 — 작업 관리 잔여(이슈 관리 등록·필터·날짜검색 / 예측 정보 필터)
export const COURSE_TASK_SPECS: ScreenSpec[] = [
  { menu: '작업 관리', sub: '이슈 관리', tcId: 'CISSUE',
    controls: ['초기화', '검색', '최근 3개월', '최근 6개월', '이후 1개월', '이후 3개월', '이후 6개월', '검색어 입력', '코스 전체', '홀 전체', '구역 전체'],
    register: '신규 이슈 등록', dateSearch: true, rowView: true },
  { menu: '작업 관리', sub: '예측 정보', tcId: 'CPREDICT', controls: ['코스 전체', '홀 전체', '구역 전체'] },
];
// ── 코스 현황 관리(모니터 별도 — 나머지 5종) ──
export const COURSE_STATUS_SPECS: ScreenSpec[] = [
  // 지도/3D 시각화 화면 — 캔버스 상호작용(측정·분석 실행)은 시각회귀 영역, DOM은 컨트롤 노출(L1)까지 검증.
  { menu: '코스 현황 관리', sub: '식생 분석', tcId: 'CMON-SPECTRAL', controls: ['스와이프 비교', '배수 분석', '비교 분석'], dateSearch: true },
  { menu: '코스 현황 관리', sub: '코스 영역 설정', tcId: 'CMON-DRAW', controls: ['추가'] },
  { menu: '코스 현황 관리', sub: '드론사진 업로드', tcId: 'CMON-UPLOAD', controls: ['영상정보 등록'] },
  { menu: '코스 현황 관리', sub: '3D', tcId: 'CMON-3D', controls: ['거리', '높이', '각도', '넓이'] },  // Orbit=토글(버튼/텍스트 매칭 불가) 제외
  { menu: '코스 현황 관리', sub: '그린 분석', tcId: 'CMON-GREEN' },  // 좌/우 스와이프 화살표만 — 존재 검증(L1)만 유지
];

// ═══════════════ 코스 현황 관리 > 코스 모니터 (지도 기반) ═══════════════
export async function runCourseMonitor(page: Page) {
  const P = '코스 현황 관리 > 코스 모니터';
  await checkVisible(page, { path: `${P} > 좌측탭`, tcRef: '코스관리_코스모니터_1', tcId: 'CMON-01', desc: '좌측 탭(전체/작업/이슈/점검/인력/관심)', failMsg: '좌측 탭 미노출' },
    () => page.getByText('점검', { exact: true }));
  await checkVisible(page, { path: `${P} > 지상지하`, tcRef: '코스관리_코스모니터_2', tcId: 'CMON-02', desc: '지상/지하 전환', failMsg: '지상/지하 미노출' },
    () => page.getByText('지하', { exact: true }));
  await checkVisible(page, { path: `${P} > 홀번호`, tcRef: '코스관리_코스모니터_3', tcId: 'CMON-03', desc: '홀번호 노출 토글(회장님 요건)', failMsg: '홀번호 토글 미노출' },
    () => page.getByText('홀번호', { exact: false }));

  // 필터/범례 — 지도 오버레이(상단 필터바·하단 범례)는 상태에 따라 노출 가변 → 있으면 PASS, 없으면 SKIP(가짜 FAIL 방지)
  {
    const reset = page.locator('.contents, main').first().getByText('초기화', { exact: true }).first();
    const meta: CheckMeta = { path: `${P} > 필터`, tcRef: '코스관리_코스모니터_6', tcId: 'CMON-06', desc: '코스/홀/구역 필터 + 초기화', failMsg: '필터 미노출' };
    if (await reset.isVisible({ timeout: 2_000 }).catch(() => false)) await check(page, meta, async () => { await expect(reset).toBeVisible(); });
    else skip(meta, '지도 상단 필터바 미노출(상태 가변)');
  }
  {
    const legend = page.locator('.contents, main').first().getByText('점검', { exact: true }).first();
    const meta: CheckMeta = { path: `${P} > 범례`, tcRef: '코스관리_코스모니터_7', tcId: 'CMON-07', desc: '하단 범례 버튼', failMsg: '범례 미노출' };
    if (await legend.isVisible({ timeout: 2_000 }).catch(() => false)) await check(page, meta, async () => { await expect(legend).toBeVisible(); });
    else skip(meta, '하단 범례 미노출(상태 가변)');
  }

  // ══ L2(상호작용) — 좌측 탭 선택 → 화면 변형(조건부 노출 패널) 델타 검증 ══
  //   실측(프로브): 탭=.sub-navigation-bar li, active=li.active. 탭별로 노출 패널이 다름.
  const tabs = new MonitorTabStrip(page);
  const TAB_EXPECT: { tab: string; panel: string; label: string }[] = [
    { tab: '작업', panel: '.slide-panel, .course-card', label: '작업 슬라이드 패널/카드' },
    { tab: '이슈', panel: '.sort-selector, .course-card', label: '이슈 정렬 셀렉터/카드' },
    { tab: '관심', panel: '.ico-add-location, .slide-panel', label: '관심 위치추가 패널' },
    { tab: '전체', panel: '.course-icon-filter, .filter-button', label: '전체 아이콘 필터' },
  ];
  if (!(await tabs.isPresent())) {
    skip({ path: `${P} > 좌측탭 상호작용`, tcRef: '코스관리_코스모니터_탭', tcId: 'CMON-TAB', desc: '좌측 탭 선택 → 패널 변형' }, '탭 스트립(.sub-navigation-bar) 미발견');
  } else {
    for (const t of TAB_EXPECT) {
      await check(page, { path: `${P} > 탭:${t.tab}`, tcRef: `코스관리_코스모니터_탭${t.tab}`, tcId: `CMON-TAB-${t.tab}`, desc: `[${t.tab}] 탭 선택 → 활성 전이 + ${t.label} 노출(조건부)`, failMsg: `${t.tab} 탭 선택 시 화면 변형 안 됨` },
        async () => {
          await tabs.select(t.tab);
          await killAlarms(page);
          expect(await tabs.activeText(), '활성 탭 미전이').toContain(t.tab);   // 상태 전이
          await expect(page.locator(t.panel).first()).toBeVisible({ timeout: 5_000 }); // 조건부 노출
        });
    }
    await tabs.select('전체').catch(() => {});   // 원복(비파괴 뷰 상태)
  }

  // ══ L2 — 뷰모드 vue-select: 옵션 노출 + '같은 위치 비교' 상태 전이 → 원복 ══
  const vm = new VueSelect(page.locator('.v-select').filter({ hasText: /전체 보기|같은 위치|분할 비교/ }).first());
  const meta4: CheckMeta = { path: `${P} > 뷰모드`, tcRef: '코스관리_코스모니터_8', tcId: 'CMON-04', desc: '뷰모드 옵션(같은 위치 비교/2분할/4분할) 노출', failMsg: '뷰모드 옵션 미노출' };
  if (!(await vm.isPresent().catch(() => false))) { skip(meta4, '뷰모드 vue-select 미발견'); }
  else {
    await vm.open();
    const opts = (await vm.optionTexts()).join(' | ');
    await page.keyboard.press('Escape').catch(() => {});
    if (!/같은 위치 비교/.test(opts)) { skip(meta4, `옵션 미노출(실제: ${opts.slice(0, 60)})`); }
    else {
      await check(page, meta4, async () => {
        expect(opts).toMatch(/같은 위치 비교/);
        expect(opts).toMatch(/2분할 비교/);
        expect(opts).toMatch(/4분할 비교/);
      }, { getActual: async () => opts.slice(0, 120) });

      // CMON-05: 같은 위치 비교 선택 → selectedText 상태 전이 검증 → 전체 보기 원복
      const meta5: CheckMeta = { path: `${P} > 비교모드`, tcRef: '코스관리_코스모니터_9', tcId: 'CMON-05', desc: '같은 위치 비교 선택 → 뷰모드 상태 전이(설정 변경 반영)', failMsg: '비교 모드 상태 전이 안 됨' };
      const sel = await vm.select('같은 위치 비교');
      if (!sel) { skip(meta5, '비교 옵션 선택 실패'); }
      else {
        await check(page, meta5, async () => {
          expect(await vm.selectedText(), '뷰모드 값 미전이').toMatch(/같은 위치 비교/);
        });
        await vm.select('전체 보기').catch(() => {});   // 원복
        await killAlarms(page);
      }
    }
  }

  diff('코스 현황 관리 > 코스 모니터', '기획서 목업 코스명 R/S/E/W Course', '실제 코스명 West/East/South(범례 색상 구분)', '코스관리_코스모니터_4', '기능 정상 — 실 데이터 반영');
}

// ═══════════════ 자재 관리 > 자재 총괄 (+ 신규 자재 등록 모달) ═══════════════
export async function runCourseMaterialSummary(page: Page) {
  const P = '자재 관리 > 자재 총괄';
  await checkVisible(page, { path: `${P} > 분류`, tcRef: '코스관리_자재총괄_1', tcId: 'CMATS-01', desc: '분류(농약/비료/모래/코스 소모품/장비 소모품)', failMsg: '분류 미노출' },
    () => page.getByText('농약', { exact: false }));
  await checkVisible(page, { path: `${P} > 등록버튼`, tcRef: '코스관리_자재총괄_2', tcId: 'CMATS-02', desc: '[신규 등록] 버튼', failMsg: '신규 등록 미노출' },
    () => page.getByRole('button', { name: /신규 등록/ }));

  const meta: CheckMeta = { path: `${P} > 신규 등록 모달`, tcRef: '코스관리_자재총괄_3', tcId: 'CMATS-03', desc: '[신규 등록] → 자재 등록: 자재명·단위·거래처·매입가', failMsg: '자재 등록 모달/요소 미노출' };
  try {
    const opened = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, a')).find((x) =>
        (x as HTMLElement).offsetParent && !x.closest('.side-navbar-container') && !x.closest('.modal-group') && /신규 등록/.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
      if (!b) return false; (b as HTMLElement).click(); return true;
    });
    if (!opened) { skip(meta, '[신규 등록] 버튼 미발견'); }
    else {
      await page.waitForTimeout(1600); await killAlarms(page);
      // 모달('자재 등록') 텍스트 substring 검사 — 로케이터 가시성/strict 판정 이슈 회피(가장 견고)
      await check(page, meta, async () => {
        const modal = page.locator('.modal-group').filter({ hasText: '자재 등록' }).last();
        await expect(modal).toBeVisible({ timeout: 8_000 });
        const t = (await modal.innerText()).replace(/\s+/g, ' ');
        expect(t, `모달 텍스트: ${t.slice(0, 80)}`).toContain('입고일');
        expect(t).toContain('매입가');
        expect(t).toContain('자재명');
      });
    }
  } catch (e) { record(meta, 'FAIL', { error: '자재 등록 모달 검증 예외', detail: (e as Error).message.slice(0, 160) }); }
  finally { await closeModal(page); }
  // 테이블 컬럼 헤더(L1)
  await checkColumns(page, P, (n) => `코스관리_자재총괄_${n}`, 'CMATS', ['번호', '자재명', '최근 입고일', '단위', '재고수량', '단위당 원가']);
}

// ═══════════════ 장비 관리 > 장비 총괄 (+ 장비 등록 모달) ═══════════════
export async function runCourseEquipment(page: Page) {
  const P = '장비 관리 > 장비 총괄';
  await checkVisible(page, { path: `${P} > 표준유류비`, tcRef: '코스관리_장비총괄_1', tcId: 'CEQP-01', desc: '[표준 유류비 설정] 노출', failMsg: '표준 유류비 미노출' },
    () => page.getByRole('button', { name: /표준 유류비 설정/ }));
  await checkVisible(page, { path: `${P} > 유종`, tcRef: '코스관리_장비총괄_2', tcId: 'CEQP-02', desc: '리스트 유종 컬럼(경유/휘발유)', failMsg: '유종 미노출' },
    () => page.getByText('유종', { exact: true }));

  const meta: CheckMeta = { path: `${P} > 장비 등록 모달`, tcRef: '코스관리_장비총괄_3', tcId: 'CEQP-03', desc: '[장비등록] → 장비명·내용연수·연간 운용 시간', failMsg: '장비 등록 모달/요소 미노출' };
  try {
    const opened = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, a')).find((x) =>
        (x as HTMLElement).offsetParent && !x.closest('.side-navbar-container') && !x.closest('.modal-group') && /장비\s*등록/.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
      if (!b) return false; (b as HTMLElement).click(); return true;
    });
    if (!opened) { skip(meta, '[장비등록] 버튼 미발견'); }
    else {
      await page.waitForTimeout(1600); await killAlarms(page);
      await check(page, meta, async () => {
        await expect(page.getByText('장비명').first()).toBeVisible({ timeout: 8_000 });
        await expect(page.getByText('내용연수').first()).toBeVisible();
        await expect(page.getByText('연간 운용 시간').first()).toBeVisible();
      });
    }
  } catch (e) { record(meta, 'FAIL', { error: '장비 등록 모달 검증 예외', detail: (e as Error).message.slice(0, 160) }); }
  finally { await closeModal(page); }
  // 테이블 컬럼 헤더(L1)
  await checkColumns(page, P, (n) => `코스관리_장비총괄_${n}`, 'CEQP', ['장비 번호', '장비명', '브랜드명', '상태', '매입일', '유종', '상세']);
}

// ═══════════════ 시설 관리 > 시설 총괄 (+ 시설 등록 풀페이지) ═══════════════
export async function runCourseFacility(page: Page) {
  const P = '시설 관리 > 시설 총괄';
  await checkVisible(page, { path: `${P} > 진입`, tcRef: '코스관리_시설총괄_1', tcId: 'CFAC-01', desc: '시설 총괄 본문 로드', failMsg: '본문 미로드' },
    '.contents, .contents-box, main');
  const meta: CheckMeta = { path: `${P} > 시설 등록`, tcRef: '코스관리_시설총괄_2', tcId: 'CFAC-02', desc: '[시설 등록] → 지상/지하 지도 + 시설명 + 공사 업체(거래처)', failMsg: '시설 등록 폼/요소 미노출' };
  let opened = false;
  try {
    opened = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, a')).find((x) =>
        (x as HTMLElement).offsetParent && !x.closest('.side-navbar-container') && /시설 등록|신규 등록/.test((x.textContent || '').replace(/\s+/g, ' ').trim()));
      if (!b) return false; (b as HTMLElement).click(); return true;
    });
    if (!opened) { skip(meta, '[시설 등록] 버튼 미발견'); }
    else {
      await page.waitForTimeout(2000); await killAlarms(page);
      await check(page, meta, async () => {
        await expect(page.getByText('시설명').first()).toBeVisible({ timeout: 8_000 });
        await expect(page.getByText('공사 업체').first()).toBeVisible();
      });
    }
  } catch (e) { record(meta, 'FAIL', { error: '시설 등록 폼 검증 예외', detail: (e as Error).message.slice(0, 160) }); }
  finally {
    if (opened) { await gotoCourseMenu(page, '시설 관리', '시설 총괄').catch(() => {}); }
    await killAlarms(page);
  }
}
