import { test, Page, BrowserContext } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms, setCourseDateRange } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport } from '../lib/reporter';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  [내보내기] 오류 검출 감사(비파괴) — 내보내기 클릭 시 오류(에러 알럿/토스트/콘솔/4xx)가 나는 화면을 검출.
//   실행: npm run course:auth 후 npm run course:export-audit → reports/코스관리_내보내기감사_report_*.xlsx
//   ⚠ 배경(블라인드 스팟): 기존 checkExport는 다운로드 미발생을 '빈 데이터'로 SKIP 처리하고,
//      killAlarms(dismissBlockingOverlays)가 에러 알럿(.modal-group.alarm)을 텍스트 확인 없이 자동으로 닫아
//      "내보내기 클릭 → 오류" 화면을 전혀 못 잡았음. 본 감사기는 클릭 전 오류 관찰자를 설치하고
//      killAlarms를 오류 포착 이후로 미뤄 오류를 검출한다.
//   판정: 다운로드 발생=PASS / 오류신호(알럿·토스트·pageerror·4xx)=FAIL(오류 검출) / 무반응·빈데이터=SKIP.
//   전부 비파괴(내보내기=읽기 전용 export, 다운로드 파일 저장 후 삭제).
// ──────────────────────────────────────────────────────────────

interface Scr { menu: string; sub: string; tcId: string; dateRange?: boolean; tab?: string; }
const SCREENS: Scr[] = [
  { menu: '정보 관리', sub: '홀 별 정보', tcId: 'EXP-HOLE' },
  { menu: '비용 관리', sub: '작업별 비용', tcId: 'EXP-COST-TASK', dateRange: true },
  { menu: '비용 관리', sub: '분류별 비용', tcId: 'EXP-COST-CAT' },
  { menu: '비용 관리', sub: '위치별 비용', tcId: 'EXP-COST-LOC' },
  { menu: '비용 관리', sub: '기간별 비용', tcId: 'EXP-COST-PERIOD' },
  { menu: '예산 관리', sub: '예산 총괄', tcId: 'EXP-BUD-SUM' },
  { menu: '예산 관리', sub: '예산 상세', tcId: 'EXP-BUD-DETAIL', tab: '전체' },
  { menu: '예산 관리', sub: '실적 관리', tcId: 'EXP-BUD-PERF' },
  { menu: '예산 관리', sub: '예산 분석', tcId: 'EXP-BUD-ANAL' },
  { menu: '예산 관리', sub: '예산 분석', tcId: 'EXP-BUD-ANAL-YR', tab: '연간 그래프' },
];

const ERR_RE = /오류|실패|에러|error|exception|처리\s*(할|되지|중)|불가|잘못|다시\s*시도|문제가|찾을\s*수\s*없|권한/i;
const NODATA_RE = /없습니다|없음|데이터가\s*없|내역이\s*없|대상이\s*없/;

test('내보내기 오류 검출 감사(비파괴)', async ({ page, context }) => {
  test.setTimeout(400_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  const dump: Record<string, unknown> = {};
  const errScreens: string[] = [];

  for (const s of SCREENS) {
    const P = `${s.menu} > ${s.sub}${s.tab ? ' > ' + s.tab : ''}`;
    const meta = { path: `${P} > 내보내기`, tcRef: `코스관리_내보내기_${s.tcId}`, tcId: s.tcId, desc: '[내보내기] 클릭 → 다운로드 발생(오류 없이)', failMsg: '내보내기 오류' };
    if (!(await gotoCourseMenu(admin, s.menu, s.sub).then(() => true).catch(() => false))) { skip(meta, '진입 실패'); continue; }
    await admin.waitForTimeout(1600); await killAlarms(admin);
    if (s.tab) { const t = admin.locator('.contents, main').getByText(s.tab, { exact: true }).first(); if (await t.isVisible({ timeout: 2000 }).catch(() => false)) { await t.click({ timeout: 2000 }).catch(() => {}); await admin.waitForTimeout(1200); await killAlarms(admin); } }
    if (s.dateRange) { const ty = new Date(); await setCourseDateRange(admin, `${ty.getFullYear()}-01-01`, `${ty.getFullYear()}-${String(ty.getMonth() + 1).padStart(2, '0')}-${String(ty.getDate()).padStart(2, '0')}`).catch(() => false); await admin.waitForTimeout(1200); await killAlarms(admin); }

    // 내보내기 버튼 로케이터 — 스코프 제거(상단 툴바 대응) + button/a + 정규식 + 스크롤/재시도
    const btn = admin.getByRole('button', { name: /내보내기/ })
      .or(admin.locator('button, a, [role="button"], [class*="btn"], [class*="button"]').filter({ hasText: /내보내기/ }))
      .or(admin.getByText(/^\s*내보내기\s*$/)).first();
    let btnVisible = false;
    for (let tryN = 0; tryN < 3 && !btnVisible; tryN++) {
      await btn.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      btnVisible = await btn.isVisible({ timeout: 2500 }).catch(() => false);
      if (!btnVisible) { await admin.waitForTimeout(1200); await killAlarms(admin); }
    }
    if (!btnVisible) { skip(meta, '내보내기 버튼 미노출(3회 재시도·페이지 전역 탐색 후)'); continue; }

    // ① 클릭 전 오류 관찰자 설치(에러 알럿/토스트를 killAlarms가 닫기 전에 텍스트 포착)
    await admin.evaluate(() => {
      const w = window as unknown as { __exp?: { hits: string[] }; __expMO?: MutationObserver };
      w.__exp = { hits: [] };
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const grab = (el: Element) => {
        if (!(el instanceof HTMLElement)) return;
        const cls = typeof el.className === 'string' ? el.className : '';
        const t = norm(el.textContent);
        if (!t) return;
        if (/modal-group/.test(cls) && /alarm|notice/.test(cls)) w.__exp!.hits.push('ALERT:' + t.slice(0, 200));
        else if (/toast/i.test(cls)) w.__exp!.hits.push('TOAST:' + t.slice(0, 200));
      };
      const mo = new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return; grab(n);
        n.querySelectorAll('.modal-group, [class*="toast"]').forEach(grab);
      })));
      mo.observe(document.body, { childList: true, subtree: true });
      w.__expMO = mo;
      document.querySelectorAll('.modal-group.alarm, [class*="toast"]').forEach(grab);   // 이미 떠있는 것
    }).catch(() => {});

    // ② 콘솔/페이지에러/4xx 응답 감시
    const consoleErr: string[] = []; const pageErr: string[] = []; const badResp: string[] = [];
    const onConsole = (m: { type: () => string; text: () => string }) => { if (m.type() === 'error') consoleErr.push(m.text().slice(0, 160)); };
    const onPageErr = (e: Error) => pageErr.push((e.message || '').slice(0, 160));
    const onResp = (r: { status: () => number; url: () => string }) => { const u = r.url(); if (r.status() >= 400 && /(export|download|excel|xls|report|file)/i.test(u)) badResp.push(`${r.status()} ${u.split('?')[0].slice(-60)}`); };
    admin.on('console', onConsole as never); admin.on('pageerror', onPageErr as never); admin.on('response', onResp as never);

    // ③ 클릭 + 다운로드/오류 대기(오류 포착 전 killAlarms 금지)
    const [dl] = await Promise.all([
      admin.waitForEvent('download', { timeout: 10_000 }).catch(() => null),
      btn.click({ timeout: 3000 }).catch(() => {}),
    ]);
    await admin.waitForTimeout(2200);   // 에러 알럿/토스트가 뜰 시간 확보(닫지 않음)

    const hits = await admin.evaluate(() => {
      const w = window as unknown as { __exp?: { hits: string[] }; __expMO?: MutationObserver };
      try { w.__expMO?.disconnect(); } catch { /* noop */ }
      return w.__exp?.hits || [];
    }).catch(() => [] as string[]);
    admin.off('console', onConsole as never); admin.off('pageerror', onPageErr as never); admin.off('response', onResp as never);

    const alertErrs = hits.filter((h) => ERR_RE.test(h) && !NODATA_RE.test(h));
    const noData = hits.some((h) => NODATA_RE.test(h)) || (!dl && hits.length === 0);
    const anyErr = alertErrs.length > 0 || pageErr.length > 0 || badResp.length > 0;

    let dlOk = false; let dlName = '';
    if (dl) {
      dlName = dl.suggestedFilename();
      const sp = path.join('reports', 'downloads', dlName);
      await dl.saveAs(sp).catch(() => {});
      const size = fs.existsSync(sp) ? fs.statSync(sp).size : 0;
      dlOk = /\.(xlsx|xls|csv)$/i.test(dlName) && size > 0;
      try { if (fs.existsSync(sp)) fs.unlinkSync(sp); } catch { /* noop */ }
    }

    dump[s.tcId] = { P, dl: dlName, dlOk, hits, consoleErr, pageErr, badResp };

    if (dlOk && !anyErr) {
      record(meta, 'PASS', { actual: `다운로드 정상: ${dlName}` });
    } else if (anyErr) {
      errScreens.push(P);
      const detail = [alertErrs.length ? `에러알럿: ${alertErrs.join(' | ')}` : '', badResp.length ? `HTTP: ${badResp.join(', ')}` : '', pageErr.length ? `pageerror: ${pageErr.join(' | ')}` : '', consoleErr.length ? `console: ${consoleErr.slice(0, 2).join(' | ')}` : ''].filter(Boolean).join(' · ');
      record(meta, 'FAIL', { error: '내보내기 클릭 시 오류 발생', detail: detail + (dl ? ' (다운로드도 발생 — 부분 오류)' : ' (다운로드 미발생)') });
    } else if (dl && !dlOk) {
      record(meta, 'FAIL', { error: '다운로드 파일 이상', detail: `${dlName} (확장자/크기 비정상)` });
    } else if (noData) {
      skip(meta, `무반응/빈 데이터 — 다운로드·오류 모두 없음${hits.length ? '(알림: ' + hits.join(' | ').slice(0, 120) + ')' : ''}`);
    } else {
      // 다운로드 없음 + 비에러 알림만(예: 데이터 없음 외 안내) → 확인 필요
      record({ ...meta, desc: '[내보내기] 클릭 → 다운로드 없이 안내 노출(확인 필요)' }, 'FAIL', { error: '다운로드 미발생(확인 필요)', detail: `알림: ${hits.join(' | ').slice(0, 160) || '없음'}` });
    }
    await killAlarms(admin);   // 이제 정리(다음 화면 진입 위해)
  }

  // 종합
  diff('비용/예산 관리', '내보내기 오류 검출',
    errScreens.length ? `내보내기 클릭 시 오류 발생 화면 ${errScreens.length}건: ${errScreens.join(', ')}. 기존 자동화(checkExport)는 다운로드 미발생을 '빈 데이터'로 SKIP + killAlarms가 에러 알럿 자동 닫음 → 미검출이었음. 본 감사기로 검출.`
      : '전 내보내기 화면에서 오류 미검출(다운로드 정상 또는 빈 데이터 SKIP).',
    '코스관리_내보내기_감사', '내보내기 오류 검출 감사(오류 관찰자 + killAlarms 지연)');

  try {
    const dir = path.join('analysis'); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '코스관리_내보내기감사_프로브.json'), JSON.stringify(dump, null, 2), 'utf8');
  } catch { /* noop */ }

  await killAlarms(admin);
  await writeReport('코스관리_내보내기감사');
});
