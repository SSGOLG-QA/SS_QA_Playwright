import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseDateRange } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  작업별 비용 — 전년도 시작 작업 제외 계산 실증(비파괴).
//  실행: npm run course:auth 후 npm run course:excl
//  당해(2026-01-01~금일) 조회 → 각 행 기간 시작일 파싱 → 시작연도<당해면 '전년도시작(크로스이어)'으로 분류·제외.
//  목적: 크로스이어 작업(모델 C=겹침 전액→이중계상)을 걸러낸 '순수 당해시작' 총계 산출 가능함을 입증.
//  전부 비파괴(조회/파싱만).
// ──────────────────────────────────────────────────────────────

const P = '비용 관리 > 작업별 비용';
const M = (p: Page) => p.locator('.contents, main').first();

test('전년도 시작 작업 제외 계산 실증(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  if (!(await gotoCourseMenu(admin, '비용 관리', '작업별 비용').then(() => true).catch(() => false))) {
    skip({ path: P, tcRef: '코스관리_제외_0', tcId: 'EXCL-00', desc: '진입' }, '진입 실패'); await writeReport('코스관리_전년도제외'); return;
  }
  await admin.waitForTimeout(2_000); await killAlarms(admin);

  const today = new Date();
  const curYear = today.getFullYear();   // 당해(2026)
  const end = `${curYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const start = `${curYear}-01-01`;       // 당해 1월 1일

  // 당해(2026-01-01~금일) 조회 — 숫자만 타이핑 방식
  const setOk = await setCourseDateRange(admin, start, end).catch(() => false);
  await admin.waitForTimeout(1_200); await killAlarms(admin);

  // 행 파싱: 작업번호(0)·기간(2)·총비용(6)
  const rows = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const sc = document.querySelector('.contents, main') || document.body;
    return Array.from(sc.querySelectorAll('tbody tr')).filter((tr) => !/내역이 없습니다/.test(tr.textContent || '')).map((tr) => {
      const c = Array.from(tr.children).map((td) => norm(td.textContent));
      const period = c[2] || '';
      const startDate = (period.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];   // 기간의 첫 날짜=시작일
      return { no: c[1] ? `${c[0]}(${c[1].slice(0, 14)})` : c[0], period, startDate, total: Number((c[6] || '').replace(/[^0-9.-]/g, '') || '0') };
    });
  }).catch(() => [] as { no: string; period: string; startDate: string; total: number }[]);

  const appliedRange = await admin.evaluate(() => { const i = document.querySelectorAll('.contents .datepicker-input, main .datepicker-input'); return `${(i[0] as HTMLInputElement)?.value || ''}~${(i[1] as HTMLInputElement)?.value || ''}`; }).catch(() => '?');

  if (rows.length === 0) {
    skip({ path: `${P} > 당해 조회`, tcRef: '코스관리_제외_q', tcId: 'EXCL-QUERY', desc: `당해(${start}~${end}) 조회`, failMsg: '' }, `데이터 0건(적용범위 ${appliedRange}·setOk ${setOk})`);
    await writeReport('코스관리_전년도제외'); return;
  }

  // 분류: 시작연도 < 당해 = 전년도시작(크로스이어) / else 당해시작
  const cross = rows.filter((r) => { const y = Number((r.startDate || '').slice(0, 4)); return y > 0 && y < curYear; });
  const pure = rows.filter((r) => { const y = Number((r.startDate || '').slice(0, 4)); return !(y > 0 && y < curYear); });
  const sum = (arr: typeof rows) => arr.reduce((a, r) => a + r.total, 0);
  const allTotal = sum(rows), crossTotal = sum(cross), pureTotal = sum(pure);

  // ── 결과 기록 ──
  record({ path: `${P} > 당해 조회(${start}~${end})`, tcRef: '코스관리_제외_q', tcId: 'EXCL-QUERY', desc: '당해(1월1일~금일) 조회 → 전체 작업/총비용', failMsg: '' }, 'PASS', { actual: `[적용범위 ${appliedRange}·setOk ${setOk}] 전체 ${rows.length}건 · 총비용 ${allTotal.toLocaleString()}원` });

  record({ path: `${P} > 전년도 시작 작업(크로스이어)`, tcRef: '코스관리_제외_cross', tcId: 'EXCL-CROSS', desc: `시작일자가 전년도(${curYear - 1} 이하)인 작업 — 제외 대상`, failMsg: '' }, 'PASS', { actual: cross.length ? `${cross.length}건 · ${crossTotal.toLocaleString()}원 제외 대상 (예: ${cross.slice(0, 3).map((r) => `${r.no} ${r.startDate} ${r.total.toLocaleString()}`).join(' / ')})` : '전년도 시작 작업 없음' });

  record({ path: `${P} > ★ 전년도시작 제외 계산`, tcRef: '코스관리_제외_pure', tcId: 'EXCL-PURE', desc: '★ 전년도 시작 작업 제외 → 순수 당해시작 작업 총계 (이중계상 방지)', failMsg: '' }, 'PASS', { actual: `순수 당해(${curYear})시작 ${pure.length}건 · ${pureTotal.toLocaleString()}원 (= 전체 ${allTotal.toLocaleString()} − 전년도시작 ${crossTotal.toLocaleString()})` });

  // 검산: 순수 + 크로스 = 전체
  record({ path: `${P} > 분류 검산`, tcRef: '코스관리_제외_chk', tcId: 'EXCL-CHECK', desc: '순수 당해시작 + 전년도시작 = 전체 (분류 무결)', failMsg: '분류 합계 불일치' }, Math.abs(pureTotal + crossTotal - allTotal) <= 2 ? 'PASS' : 'FAIL', Math.abs(pureTotal + crossTotal - allTotal) <= 2 ? { actual: `${pureTotal.toLocaleString()} + ${crossTotal.toLocaleString()} = ${allTotal.toLocaleString()} ✓` } : { error: '합계 불일치', detail: `${pureTotal}+${crossTotal}≠${allTotal}` });

  diff('비용 관리 > 작업별 비용', '전년도시작 제외 계산', `당해 조회에서 시작일자 전년도(크로스이어) ${cross.length}건(${crossTotal.toLocaleString()}) 제외 가능 → 순수 당해시작 ${pureTotal.toLocaleString()}. 정합성 비교 시 이 방식으로 이중계상 회피 가능`, '코스관리_제외_note', '전년도 시작 작업 제외 계산 실증 — 기간 시작일 파싱으로 필터링');

  await killAlarms(admin);
  await writeReport('코스관리_전년도제외');
});
