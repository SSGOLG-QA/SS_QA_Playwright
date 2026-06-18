import { Page } from '@playwright/test';
import * as fs from 'fs';

// ────────────────────────────────────────────────────────────────
//  UX Probe — 탐색적 시각/UX 점검 (ui-ux-tester PoC 정식화, 비파괴)
//  DOM 존재 검증이 못 잡는 신호: 반응형 가로 overflow·테이블 컨테이너 overflow·
//  i18n 키 누출·콘솔 에러·네트워크 실패. navigate/read/resize/screenshot만(클릭 변경 없음).
//  결과는 영역·심각도(상/중/하/정보)·상세로 구조화 → diff/Confluence 흡수 가능.
// ────────────────────────────────────────────────────────────────
export type Severity = '상' | '중' | '하' | '정보';
export interface UxFinding { screen: string; area: string; severity: Severity; detail: any }
export interface UxObservers { errors: string[]; netFails: string[] }

/** console error / network 실패 옵저버 설치(네비게이션 전에 1회). */
export function attachUxObservers(admin: Page): UxObservers {
  const o: UxObservers = { errors: [], netFails: [] };
  admin.on('console', m => { if (m.type() === 'error') o.errors.push(m.text().replace(/\s+/g, ' ').slice(0, 200)); });
  admin.on('requestfailed', r => o.netFails.push(`${r.method()} ${r.url().slice(0, 110)} — ${r.failure()?.errorText || ''}`));
  admin.on('response', r => { if (r.status() >= 400) o.netFails.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`); });
  return o;
}

/** 현재 진입된 화면을 비파괴 UX 점검. screen=화면 라벨(파일명 슬러그로도 사용). */
export async function probeScreenUx(admin: Page, screen: string, observers?: UxObservers, opts?: { widths?: number[]; dir?: string }): Promise<UxFinding[]> {
  const widths = opts?.widths ?? [1366, 1024];
  const dir = opts?.dir ?? 'reports/screenshots/ux-probe';
  const slug = screen.replace(/[>\s/]+/g, '_');
  const f: UxFinding[] = [];
  fs.mkdirSync(dir, { recursive: true });
  await admin.waitForTimeout(700);
  const errBefore = observers?.errors.length ?? 0;
  const netBefore = observers?.netFails.length ?? 0;

  await admin.screenshot({ path: `${dir}/${slug}-full.png`, fullPage: true }).catch(() => {});

  // ① 테이블 컨테이너 가로 overflow(현 뷰포트=최대화) — 스크롤 어포던스 없이 넘치면 결함
  const ov = await admin.evaluate(() => {
    for (const s of ['.table-overflow-item', '.list-table-group', '.table-overflow-x']) {
      const e = document.querySelector(s) as HTMLElement;
      if (e && e.scrollWidth > e.clientWidth + 2) return { sel: s, scrollW: e.scrollWidth, clientW: e.clientWidth };
    }
    return null;
  });
  if (ov) f.push({ screen, area: '테이블 컨테이너 가로 overflow(최대 뷰포트)', severity: '중', detail: ov });

  // ② 반응형 — 폭 축소 시 body 가로 overflow(콘텐츠 잘림 위험)
  for (const w of widths) {
    const ok = await admin.setViewportSize({ width: w, height: 800 }).then(() => true).catch(() => false);
    if (!ok) { f.push({ screen, area: '반응형', severity: '정보', detail: `setViewportSize 미지원(${w})` }); break; }
    await admin.waitForTimeout(450);
    await admin.screenshot({ path: `${dir}/${slug}-${w}.png` }).catch(() => {});
    const r = await admin.evaluate(() => {
      const e = document.querySelector('.table-overflow-item, .list-table-group') as HTMLElement;
      return { bodyOverflowX: document.body.scrollWidth > window.innerWidth + 2, tblHasScroll: e ? e.scrollWidth > e.clientWidth + 2 : null };
    });
    if (r.bodyOverflowX) f.push({ screen, area: `반응형 ${w}px — body 가로 overflow`, severity: '하', detail: r });
  }
  await admin.setViewportSize({ width: 1600, height: 900 }).catch(() => {});
  await admin.waitForTimeout(300);

  // ③ i18n 키 누출(ui.NNNN)
  const body = await admin.locator('body').innerText().catch(() => '');
  const leaks = [...new Set((body.match(/\bui\.\d{2,}/g) || []))];
  if (leaks.length) f.push({ screen, area: 'i18n 키 누출', severity: '중', detail: leaks });

  // ④ 콘솔/네트워크(이 화면 동안 증가분)
  if (observers) {
    const newErr = observers.errors.slice(errBefore);
    const newNet = observers.netFails.slice(netBefore);
    if (newErr.length) f.push({ screen, area: '콘솔 에러', severity: '중', detail: { count: newErr.length, sample: newErr.slice(0, 5) } });
    if (newNet.length) f.push({ screen, area: '네트워크 실패(4xx/5xx/failed)', severity: '중', detail: { count: newNet.length, sample: newNet.slice(0, 5) } });
  }
  return f;
}
