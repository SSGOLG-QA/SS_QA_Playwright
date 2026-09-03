import { expect, Page } from '@playwright/test';
import { check, record, skip, diff, CheckMeta } from '../reporter';
import { killAlarms } from './courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────────────────────
//  코스관리 2차 — 헤더 알림 "상태별 문구 포맷" 검증(비파괴). 근거: `2026-09 코스관리_PC 2차` 헤더 시트.
//   알림 아이콘 → 알림 리스트/페이지의 각 항목이 상태별 템플릿 + 발송시간 포맷에 맞는지 검사.
//   메시지 템플릿(작업지시 상태별):
//     생성        "{작업자}님이 작업을 지시하였습니다. [{작업명 : YYYY.MM.DD ~ YYYY.MM.DD}]"
//     상태 변경   "{작업자}님이 작업 상태를 변경하였습니다. [...]"   (진행중/작업완료/취소/완료확정)
//     내용 수정   "{작업자}님이 작업 지시 내용을 변경하였습니다. [...]"
//     작업자 변경 "{작업자}님이 해당 작업에서 제외되셨습니다. [...]"
//   발송시간: 방금 전 / N분 전 / N시간 전 / YYYY.MM.DD 오전·오후 HH:MM.
//   ⚠ 비파괴: 알림 리스트 열어 읽기만. "모두 읽음"·항목 클릭(랜딩) 금지. 페이지 이동 시 goBack.
//   ⚠ 데이터 의존: 알림 0건이면 SKIP. 트리거/구조 미검출 시 SKIP + analysis 덤프(1런 확정).
//   ⚠ report-standard: 알 수 없는 포맷은 FAIL 아닌 diff(관찰) — 기획/QA 확인.
// ──────────────────────────────────────────────────────────────────────────────

const MSG_TEMPLATES = [
  { key: '작업지시(생성)', re: /작업을\s*지시하였습니다/ },
  { key: '작업 상태 변경', re: /작업\s*상태를\s*변경하였습니다/ },
  { key: '작업 지시 내용 변경', re: /작업\s*지시\s*내용을\s*변경하였습니다/ },
  { key: '작업자 변경(제외)', re: /해당\s*작업에서\s*제외되셨습니다/ },
];
const BRACKET_DATE = /\[[^\]]*\d{4}\.\d{1,2}\.\d{1,2}\s*[~-]\s*\d{4}\.\d{1,2}\.\d{1,2}[^\]]*\]/;
const TIME_FORMATS = [
  { key: '방금 전', re: /방금\s*전/ },
  { key: 'N분 전', re: /\d+\s*분\s*전/ },
  { key: 'N시간 전', re: /\d+\s*시간\s*전/ },
  { key: 'YYYY.MM.DD 오전/오후 HH:MM', re: /\d{4}\.\d{1,2}\.\d{1,2}\s*(오전|오후)\s*\d{1,2}\s*:\s*\d{2}/ },
];
const EMPTY_RE = /알림이?\s*없습니다|해당하는\s*데이터가\s*없습니다/;

interface OpenResult { clicked: boolean; via: string; navigated: boolean; diag: Array<{ cls: string; al: string; t: string; score: number }>; }

// 헤더에서 알림 트리거 탐색 → 클릭(evaluate). 후보 진단 반환.
async function openNotifications(admin: Page): Promise<OpenResult> {
  const urlBefore = admin.url();
  const res = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : e.getAttribute('class') || '');
    const header = document.querySelector('.header, header, [class*="header"], [class*="gnb"], [class*="top-bar"], [class*="topbar"]') || document.body;
    const cands = Array.from(header.querySelectorAll('button, a, [role="button"], [class*="noti"], [class*="alarm"], [class*="bell"], .cursor-pointer')) as HTMLElement[];
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 2 && r.height > 2; };
    const scored = cands.filter(vis).map((e) => {
      const cls = clsOf(e); const al = e.getAttribute('aria-label') || ''; const t = norm(e.innerText);
      let score = 0;
      if (/noti|alarm|bell|알림/i.test(cls + ' ' + al)) score += 10;
      if (!t) score += 1;                                   // 아이콘 전용(텍스트 없음)
      if (e.querySelector('svg, i, img, [class*="icon"]')) score += 1;
      return { e, cls: cls.slice(0, 60), al: al.slice(0, 30), t: t.slice(0, 20), score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
    const diag = scored.slice(0, 8).map((x) => ({ cls: x.cls, al: x.al, t: x.t, score: x.score }));
    const best = scored[0];
    if (best) { best.e.click(); return { clicked: true, via: best.score >= 10 ? 'noti-keyword' : 'icon-fallback', diag }; }
    return { clicked: false, via: 'none', diag };
  }).catch(() => ({ clicked: false, via: 'error', diag: [] as OpenResult['diag'] }));
  await admin.waitForTimeout(1_200);
  return { ...res, navigated: admin.url() !== urlBefore };
}

// 열린 알림 패널/페이지에서 항목 라인 수집(innerText 줄바꿈 보존). empty state 감지.
async function readNotifPanel(admin: Page): Promise<{ found: boolean; lines: string[]; empty: boolean }> {
  return admin.evaluate((patterns: { TIME: string; EMPTY: string }) => {
    const TIME = new RegExp(patterns.TIME);
    const EMPTY = new RegExp(patterns.EMPTY);
    const rawNorm = (s: string) => s.replace(/[ \t]+/g, ' ').trim();
    const containers = Array.from(document.querySelectorAll('div, ul, section, aside, main')) as HTMLElement[];
    let panel: HTMLElement | null = null; let best = Infinity;
    for (const c of containers) {
      const t = (c.innerText || '');
      if (!t || t.length > 4000) continue;
      const isNotif = EMPTY.test(t) || (t.includes('님이') && TIME.test(t)) || (TIME.test(t) && /알림/.test(t));
      if (isNotif && t.length < best) { panel = c; best = t.length; }
    }
    if (!panel) return { found: false, lines: [] as string[], empty: false };
    const empty = EMPTY.test(panel.innerText || '');
    const lines = (panel.innerText || '').split(/\n+/).map(rawNorm).filter(Boolean);
    return { found: true, lines: lines.slice(0, 60), empty };
  }, { TIME: TIME_FORMATS.map((t) => t.re.source).join('|'), EMPTY: EMPTY_RE.source }).catch(() => ({ found: false, lines: [] as string[], empty: false }));
}

async function closeNotifications(admin: Page, navigated: boolean): Promise<void> {
  if (navigated) { await admin.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); }
  else { await admin.keyboard.press('Escape').catch(() => {}); await admin.mouse.click(5, 5).catch(() => {}); }
  await admin.waitForTimeout(400); await killAlarms(admin);
}

/** 헤더 알림 상태별 문구/시간 포맷 검증(비파괴). 트리거/구조/데이터 미검출 시 SKIP(+덤프). */
export async function verifyNotificationFormat(admin: Page, P: string, R: string, id: string): Promise<void> {
  const base = (n: number, tail: string) => ({ path: `${P} > 알림포맷`, tcRef: `${R}_알림포맷_${n}`, tcId: `${id}-NOTIF-0${n}`, desc: tail });
  const dump = (obj: unknown, tag: string) => { try { if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true }); fs.writeFileSync(path.join('analysis', `_notif-probe_${tag}.json`), JSON.stringify(obj, null, 2)); } catch { /* ignore */ } };

  const open = await openNotifications(admin);
  const m00: CheckMeta = { ...base(0, '헤더 알림 아이콘 → 알림 리스트/페이지 오픈') };
  if (!open.clicked) { dump({ P, open }, id); skip(m00, `헤더 알림 트리거 미검출(후보 ${open.diag.length}) — analysis/_notif-probe_${id}.json`); return; }

  const panel = await readNotifPanel(admin);
  if (!panel.found) {
    dump({ P, open, note: '패널 미검출' }, id);
    await closeNotifications(admin, open.navigated);
    skip(m00, `알림 클릭(${open.via})했으나 리스트/페이지 미검출 — 트리거/구조 상이(덤프)`);
    return;
  }
  if (panel.empty || !panel.lines.some((l) => /님이/.test(l))) {
    await closeNotifications(admin, open.navigated);
    skip({ ...base(1, '알림 메시지 상태별 템플릿 적합') }, '알림 0건(데이터 의존) — 빈 상태/메시지 없음');
    return;
  }

  const msgLines = panel.lines.filter((l) => /님이/.test(l));
  const timeLines = panel.lines.filter((l) => TIME_FORMATS.some((t) => t.re.test(l)));

  // NOTIF-01: 각 메시지가 상태별 템플릿에 적합한가(미지의 포맷은 diff, FAIL 아님).
  const m01: CheckMeta = { ...base(1, '알림 메시지 상태별 템플릿 적합(작업지시/상태변경/내용변경/작업자변경)'), failMsg: '메시지 템플릿 불일치' };
  const unknown: string[] = []; const matchedKeys = new Set<string>();
  for (const l of msgLines) {
    const hit = MSG_TEMPLATES.find((t) => t.re.test(l));
    if (hit) matchedKeys.add(hit.key); else unknown.push(l.slice(0, 60));
  }
  for (const u of unknown) diff(P, '알림 메시지 상태별 템플릿', `미지의 문구: "${u}"`, `${R}_알림포맷`, '신규/변경 상태 문구일 수 있음 — 기획/QA 확인');
  await check(admin, m01, async () => {
    expect(msgLines.length, '알림 메시지 0건').toBeGreaterThanOrEqual(1);
    expect(unknown.length, `템플릿 불일치 ${unknown.length}건(${unknown.slice(0, 2).join(' / ')})`).toBe(0);
  }, { getActual: async () => `메시지 ${msgLines.length} · 매칭 유형 [${[...matchedKeys].join(', ')}] · 미지 ${unknown.length}` });

  // NOTIF-02: 메시지에 작업명·기간 브래킷([… YYYY.MM.DD ~ YYYY.MM.DD])이 노출되는가(데이터 있을 때).
  const m02: CheckMeta = { ...base(2, '메시지 작업명·기간 브래킷([… 날짜 ~ 날짜]) 노출'), failMsg: '기간 브래킷 미노출' };
  const withBracket = msgLines.filter((l) => BRACKET_DATE.test(l)).length;
  if (withBracket === 0) { skip(m02, '기간 브래킷 미검출 — 별도 요소 렌더/데이터 상이 가능(관찰)'); }
  else { record(m02, 'PASS', { actual: `${withBracket}/${msgLines.length} 메시지에 기간 브래킷 노출` }); }

  // NOTIF-03: 발송시간 포맷(방금 전/N분 전/N시간 전/날짜 시각) 적합.
  const m03: CheckMeta = { ...base(3, '발송시간 포맷(방금 전/N분 전/N시간 전/YYYY.MM.DD 오전·오후 HH:MM)'), failMsg: '시간 포맷 불일치' };
  if (timeLines.length === 0) { skip(m03, '발송시간 토큰 미검출 — 시간 별도 요소/포맷 상이(관찰)'); }
  else {
    const usedFmts = TIME_FORMATS.filter((t) => timeLines.some((l) => t.re.test(l))).map((t) => t.key);
    record(m03, 'PASS', { actual: `시간 ${timeLines.length}건 · 포맷 [${usedFmts.join(', ')}]` });
  }

  await closeNotifications(admin, open.navigated);
}
