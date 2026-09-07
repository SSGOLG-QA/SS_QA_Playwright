import { test, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { openCourseAdmin, gotoCourseMenu, killAlarms, COURSE_IA, COURSE_SUBDOMAIN } from '../lib/course/courseHelpers';

// ──────────────────────────────────────────────────────────────
//  컴포넌트 인벤토리 추출 — "포함(inclusive) 방식" + 위젯 단위 + 미포착 감사.
//  - allow-list(알려진 클래스만) → deny-list(본문 전수 훑고 데이터/chrome만 제외)로 전환 = 완전성 우선.
//  - 위젯(박스)은 1개로: 테이블(+컬럼)·달력·차트·이미지·카드섹션. 데이터 인스턴스(행·카드·셀·값) 제외.
//  - 컨트롤: 버튼/nav/입력/드롭/토글/탭/datepicker(태그·role·cursor:pointer로 포착).
//  - 텍스트: 제목/안내문구/상태/라벨(본문 텍스트 leaf 전수, 데이터값·컨트롤 제외).
//  - ★ 미포착 감사: 캡처 후 본문에서 안 잡힌 텍스트/인터랙티브 후보를 별도 리포트(완전성 검증).
//  - 탭별 콘텐츠: 탭 클릭 후 base 대비 델타만 귀속(공통요소 중복 방지).
//  - QA 의견 공통규칙: 전역 '알림'·헤더 제외 / 아이콘 버튼 라벨 해석 / datepicker 중복 placeholder 제외 / 3D·드론·지도 canvas는 차트 아님.
//  - 산출: baselines/course-components.<sub>.json + baselines/course-components-audit.<sub>.json
//  - 실행: npm run course:auth 후 npm run course:inventory
// ──────────────────────────────────────────────────────────────

interface Comp { kind: string; label: string; tab?: string }
interface Uncap { text: string; tag: string; cls: string; tab?: string }
interface StateOut { comps: Comp[]; uncaptured: Uncap[] }

async function extractState(page: Page, tabLabel: string): Promise<StateOut> {
  return page.evaluate((tab) => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const seen = new Set<string>();
    const out: { kind: string; label: string; tab: string }[] = [];
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : (e.getAttribute && e.getAttribute('class')) || '');
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return false;
      try { const st = getComputedStyle(e as HTMLElement); if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false; } catch { /* noop */ }
      return (e as HTMLElement).offsetParent !== null || getComputedStyle(e as HTMLElement).position === 'fixed';
    };
    const isChrome = (e: Element) => !!e.closest('.side-navbar-container, .header, .gnb, [class*="header-"], [class*="gnb"], [class*="top-bar"], [class*="alarm"], [class*="notification"], [class*="noti-"]');
    const DATA_ZONE = 'tbody, .list-table-group tbody, .vs__dropdown-menu, .modal-group, .leaflet-container, [class*="leaflet"], thead';
    const isData = (e: Element) => !!e.closest(DATA_ZONE);
    // 반복 리스트(데이터 카드/행): 부모의 동일 클래스 형제 ≥3 → 데이터 집합.
    const inRepeatedList = (e: Element) => {
      let p: Element | null = e;
      for (let i = 0; i < 4 && p; i++) { p = p.parentElement; if (!p) break; const kids = Array.from(p.children); if (kids.length >= 3) { const c0 = clsOf(kids[0]); if (c0 && kids.filter((k) => clsOf(k) === c0).length >= 3) return true; } }
      return false;
    };
    const directText = (e: Element) => { let t = ''; e.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent || ''; }); return norm(t); };
    const isDataText = (t: string) => /^\d+$/.test(t) || /^[월화수목금토일]$/.test(t) || /^\d{4}[-.]\d/.test(t) || /^[\d,]+\s*(원|건|명|%|개|점|일)?$/.test(t) || /^W-\d+$/.test(t)
      || /^[A-F][+-]?$/.test(t) || /^\d{4}년/.test(t) || /^\d+(년|월|일)$/.test(t) || /기준$/.test(t) || /^목표\s*[:：]/.test(t)   // 등급·날짜·기준일·목표값 등 데이터
      || /^총\s*[\d,]+\s*(건|명|개|점|일|회|원|건수)?$/.test(t) || /^총\s*건수\s*[\d,]*$/.test(t)   // '총 4건'·'총 9 명'·'총 건수 0' 등 집계 카운트(동적 데이터, 2026-09-07)
      || (/^[\d.,%\/\s↑↓]+$/.test(t) && /\d/.test(t));   // 차트 범례 순수수치('/ 63.1% / 1,174,246'·'↓3% ↑55%' 등, 문자/한글 없음 = 데이터
    // 테스터/사용자 생성 데이터 라벨(인스턴스) 판별 — 화면 chrome 아님(2026-09-07, 재추출 시 대량 유입 차단).
    //   ⚠ 안내문구(긴 text)엔 '[예산관리]' 등이 포함될 수 있어 길이 가드(<80) — 정본 가이드(>100자) 보호.
    const isDataLabel = (label: string) => (label.length < 80 && /\[[가-힣A-Za-z]{1,3}\]/.test(label))   // 테스터 태그 [박]/[YS]/[석] 작업지시·이슈·장비·사진명
      || /^\d+차$/.test(label)                                    // 'N차'(회차 데이터)
      || /I-\d{4,}/.test(label)                                   // 이슈 ID I-00001
      || /\.(pdf|xlsx?|pptx?|docx?|hwp|png|jpe?g|gif|zip)$/i.test(label)   // 첨부 파일명
      || /(월|화|수|목|금|토|일)요일/.test(label);                // 요일/날짜 컬럼('월요일 09.07' 등)
    const push = (kind: string, label: string) => {
      label = norm(label).slice(0, (kind === 'text' || kind === 'title') ? 200 : 44);   // 안내문구/제목은 길게(잘림 방지)
      if (!label) return;
      if (kind === 'button' && /^알림$/.test(label)) return;
      if ((kind === 'button' || kind === 'nav') && /^\d{1,3}$/.test(label)) return;
      if (isDataLabel(label)) return;   // 테스터/사용자 데이터 인스턴스 전역 차단(전 kind)
      const key = kind + '|' + label + '|' + tab;
      if (seen.has(key)) return; seen.add(key); capLabels.add(label);
      out.push({ kind, label, tab });
    };
    const capLabels = new Set<string>();   // 이미 캡처된 라벨(텍스트 워크 중복 방지용)
    const ICON: [RegExp, string][] = [
      [/trash|delete|remove|del\b/i, '삭제'], [/modify|edit|pen|note|ico-write/i, '수정'], [/copy|duplicate/i, '복사'],
      [/add|plus|ico-new/i, '추가'], [/download|excel|export/i, '다운로드'], [/upload/i, '업로드'], [/search|magnif/i, '검색'],
      [/monitor/i, '코스모니터'], [/3d/i, '3D'], [/zoom-?in/i, '확대'], [/zoom-?out/i, '축소'], [/print/i, '인쇄'], [/setting|config|gear/i, '설정'],
    ];
    const iconLabel = (e: Element) => { const inner = e.querySelector('[class*="ico"], i, svg, use'); const ic = clsOf(e) + ' ' + (inner ? clsOf(inner) : '') + ' ' + ((inner && inner.getAttribute && (inner.getAttribute('xlink:href') || inner.getAttribute('href'))) || ''); for (const [re, lab] of ICON) if (re.test(ic)) return lab; return ''; };
    const labelOf = (e: Element) => { const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t) return t; const el = e as HTMLElement; return el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || iconLabel(e) || ''; };
    const nearestTitle = (e: Element) => { let p: Element | null = e; for (let i = 0; i < 4 && p; i++) { p = p.parentElement; if (!p) break; const tt = p.querySelector(':scope > .tit, :scope > .title, :scope > [class*="title"], :scope > [class*="tit"], :scope > h2, :scope > h3, :scope > h4'); if (tt) { const s = norm((tt as HTMLElement).innerText || tt.textContent || ''); if (s && s.length <= 30) return s; } } return ''; };
    const contentRoot = document.querySelector('.contents, main') || document.body;

    // ── 위젯(박스) 단위 = 각 1개 (데이터 인스턴스 제외) ──
    contentRoot.querySelectorAll('table, .list-table-group').forEach((t) => { if (!vis(t) || isChrome(t)) return; push('table', nearestTitle(t) ? ('테이블: ' + nearestTitle(t)) : '테이블'); t.querySelectorAll('thead th, thead td').forEach((th) => { const c = norm((th as HTMLElement).innerText || th.textContent || ''); if (c && c.length <= 20) push('column', c); }); });
    contentRoot.querySelectorAll('[class*="scheduler"], [class*="calendar"], .fc, [class*="week-plan"]').forEach((c) => { if (!vis(c) || isChrome(c) || c.closest('.datepicker-container, .datepicker-layer')) return; push('calendar', nearestTitle(c) ? ('달력: ' + nearestTitle(c)) : '달력'); });
    contentRoot.querySelectorAll('canvas, .highcharts-container, [class*="chart"], svg[class*="chart"], [class*="graph"]').forEach((e) => { if (!vis(e) || isChrome(e)) return; if (e.closest('[class*="3d"], [class*="drone"], .leaflet-container, [class*="leaflet"], [class*="viewer"], [class*="cesium"], [class*="three"], [class*="map-"]')) return; push('chart', nearestTitle(e) || '차트/그래프'); });
    contentRoot.querySelectorAll('img').forEach((im) => { if (!vis(im) || isChrome(im) || isData(im)) return; const alt = (im as HTMLImageElement).getAttribute('alt') || ''; push('image', alt ? ('이미지: ' + alt) : '이미지'); });
    contentRoot.querySelectorAll('[class*="section-card"], [class*="card-list"], [class*="widget"]').forEach((sc) => { if (!vis(sc) || isChrome(sc)) return; const tt = sc.querySelector('[class*="title"], .tit, h2, h3, h4'); const s = tt ? norm((tt as HTMLElement).innerText || tt.textContent || '') : ''; if (s && s.length <= 30) push('section', s); });

    // ── 컨트롤 ──
    document.querySelectorAll('.sub-navigation-bar li, [role="tab"], .tab-menu > *, .tabs > *, .tab-group > *, [class*="tab-item"], [class*="tab-btn"]').forEach((e) => { if (!vis(e) || isChrome(e) || /table/i.test(clsOf(e))) return; const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 20) push('tab', t); });
    document.querySelectorAll('.v-select').forEach((e) => { if (vis(e) && !isChrome(e)) { const sel = e.querySelector('.vs__selected'); push('dropdown', (sel && norm(sel.textContent || '')) || labelOf(e)); } });
    document.querySelectorAll('[class*="toggle"] input, input[type="checkbox"], [class*="switch"]').forEach((e) => { if (!isChrome(e)) { const lab = e.closest('label') || e.parentElement; push('toggle', (lab && labelOf(lab)) || '토글'); } });
    document.querySelectorAll('.datepicker-input, input[type="date"], .datepicker-range').forEach((e) => { if (vis(e) && !isChrome(e)) push('datepicker', labelOf(e) || '날짜'); });
    document.querySelectorAll('.leaflet-control-zoom a, [class*="zoom"] button, [class*="zoom"] a, .zoom-in, .zoom-out, [class*="zoom-"]').forEach((e) => { if (vis(e) && !isChrome(e)) push('zoom', labelOf(e) || '줌'); });
    document.querySelectorAll('input:not([type="checkbox"]):not([type="date"]):not(.vs__search):not(.datepicker-input)').forEach((e) => { if (!vis(e) || isChrome(e)) return; const ph = (e as HTMLElement).getAttribute('placeholder') || ''; if (/^\s*YYYY-MM-DD\s*$/.test(ph)) return; push('input', ph || '입력'); });
    document.querySelectorAll('button, [role="button"], a.button-common, a.btn').forEach((e) => { if (vis(e) && !isChrome(e) && !e.closest('.v-select') && !e.closest('.leaflet-control-zoom')) push('button', labelOf(e)); });
    // 비-시맨틱 클릭 컨트롤(cursor:pointer) — 뷰토글·화살표·커스텀 pill.
    contentRoot.querySelectorAll('div, span, li, p, i, a').forEach((e) => {
      if (!vis(e) || isChrome(e)) return;
      if (e.closest('tbody, .list-table-group, .modal-group, .vs__dropdown-menu, .v-select, .leaflet-container, [class*="leaflet"]')) return;
      if (e.querySelector('button, a, input, select')) return;
      if (e.children.length > 2 || inRepeatedList(e)) return;
      let cur = ''; try { cur = getComputedStyle(e as HTMLElement).cursor; } catch { /* noop */ }
      if (cur !== 'pointer') return;
      const cls = clsOf(e); const t = norm((e as HTMLElement).innerText || e.textContent || '');
      if (/arrow|prev|next|chevron|left|right/i.test(cls)) { push('nav', t || (/(prev|left)/i.test(cls) ? '이전' : '다음')); return; }
      if (isDataText(t)) return;
      if (t && t.length <= 15) push('button', t);
      else if (!t) { const il = iconLabel(e); if (il) push('button', il); }
    });

    // ── 텍스트(제목/안내문구/상태/라벨) — 본문 텍스트 leaf 전수(데이터/컨트롤 제외) ──
    // ⚠ 시맨틱 컨트롤(tag/role)만 텍스트에서 제외. cursor:pointer는 제외하지 않음 —
    //   클릭가능 카드의 상속 cursor로 stat 라벨(월 예산 등)이 컨트롤 오분류되던 문제 → 대신 이미 캡처된 라벨은 capLabels로 중복 방지.
    const isCtl = (e: Element) => { const tg = e.tagName.toLowerCase(); if (/^(button|a|input|select|textarea|option)$/.test(tg)) return true; const r = e.getAttribute('role') || ''; return /button|tab|checkbox|radio/.test(r); };
    contentRoot.querySelectorAll('*').forEach((e) => {
      if (!vis(e) || isChrome(e) || isData(e) || inRepeatedList(e) || isCtl(e)) return;
      // ⚠ 컨테이너 통째 스킵 금지 — directText(직계 텍스트노드)만 취함 → 인라인 링크 있는 안내문구도 본문 텍스트 포착. 긴 안내문구 위해 250자까지.
      const dt = directText(e); if (!dt || dt.length < 2 || dt.length > 250 || isDataText(dt) || capLabels.has(dt)) return;
      const tg = e.tagName.toLowerCase(); const cls = clsOf(e);
      push(/^h[1-6]$/.test(tg) || /title|tit|head/i.test(cls) ? 'title' : 'text', dt);
    });
    // (보강) 안내문구/설명 문단 — <p> 및 info/guide/desc/notice 클래스. 긴 문구 허용(최대 400) → 긴 안내문 흡수.
    contentRoot.querySelectorAll('p, [class*="info"], [class*="guide"], [class*="desc"], [class*="comment"], [class*="notice"]').forEach((e) => {
      if (!vis(e) || isChrome(e) || isData(e) || inRepeatedList(e)) return;
      if (e.querySelector('input, button, select, textarea')) return;   // 폼 컨테이너 제외
      const dt = norm((e as HTMLElement).innerText || e.textContent || '');
      if (dt && dt.length >= 6 && dt.length <= 400 && !isDataText(dt) && !capLabels.has(dt)) push('text', dt);
    });

    // ── 미포착 감사: 본문 텍스트/인터랙티브인데 안 잡힌 후보(완전성 검증) ──
    const cap = new Set(out.map((c) => c.label));
    const capNoPre = new Set(out.map((c) => c.label.replace(/^(테이블|달력|이미지): /, '')));
    const uncaptured: { text: string; tag: string; cls: string; tab: string }[] = [];
    const ucSeen = new Set<string>();
    contentRoot.querySelectorAll('*').forEach((e) => {
      if (!vis(e) || isChrome(e) || isData(e) || inRepeatedList(e)) return;
      const dt = directText(e); if (!dt || dt.length < 2 || dt.length > 400 || isDataText(dt)) return;
      const dtKey = dt.slice(0, 200);   // 캡처는 200자로 잘려 저장됨 → 동일 기준으로 비교(truncation 불일치 방지)
      if (cap.has(dt) || cap.has(dtKey) || capNoPre.has(dt) || ucSeen.has(dtKey)) return;
      ucSeen.add(dtKey);
      uncaptured.push({ text: dt, tag: e.tagName.toLowerCase(), cls: clsOf(e).slice(0, 30), tab });
    });

    return { comps: out, uncaptured };
  }, tabLabel);
}

async function extractScreen(page: Page): Promise<StateOut> {
  const comps: Comp[] = []; const uncaptured: Uncap[] = [];
  const cSeen = new Set<string>(); const uSeen = new Set<string>();
  const addC = (arr: Comp[]) => arr.forEach((c) => { const k = `${c.kind}|${c.label}|${c.tab || ''}`; if (!cSeen.has(k)) { cSeen.add(k); comps.push(c); } });
  const addU = (arr: Uncap[]) => arr.forEach((u) => { if (!uSeen.has(u.text)) { uSeen.add(u.text); uncaptured.push(u); } });

  const base = await extractState(page, '').catch(() => ({ comps: [], uncaptured: [] } as StateOut));
  addC(base.comps); addU(base.uncaptured);
  const baseKeys = new Set(base.comps.map((c) => `${c.kind}|${c.label}`));

  const tabLabels: string[] = await page.evaluate(() => {
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const set = new Set<string>();
    document.querySelectorAll('.tab-group > *, [role="tab"], .tab-menu > *, .tabs > *').forEach((e) => { if (!vis(e) || e.closest('.side-navbar-container')) return; const cls = (typeof e.className === 'string' ? e.className : ''); if (/table/i.test(cls)) return; const t = norm((e as HTMLElement).innerText || e.textContent || ''); if (t && t.length <= 20) set.add(t); });
    return Array.from(set);
  }).catch(() => [] as string[]);

  if (tabLabels.length >= 2) {
    for (const tl of tabLabels) {
      const clicked = await page.evaluate((label) => { const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim(); const vis = (e: Element) => (e as HTMLElement).offsetParent !== null; const cand = Array.from(document.querySelectorAll('.tab-group > *, [role="tab"], .tab-menu > *, .tabs > *')).find((e) => vis(e) && !e.closest('.side-navbar-container') && norm((e as HTMLElement).innerText || e.textContent || '') === label); if (cand) { (cand as HTMLElement).click(); return true; } return false; }, tl).catch(() => false);
      if (!clicked) continue;
      await page.waitForTimeout(1_100); await killAlarms(page);
      const st = await extractState(page, tl).catch(() => ({ comps: [], uncaptured: [] } as StateOut));
      addC(st.comps.filter((c) => !baseKeys.has(`${c.kind}|${c.label}`)));
      addU(st.uncaptured);
    }
    await page.evaluate((label) => { const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim(); const el = Array.from(document.querySelectorAll('.tab-group > *, [role="tab"], .tab-menu > *, .tabs > *')).find((e) => norm((e as HTMLElement).innerText || e.textContent || '') === label); (el as HTMLElement | undefined)?.click(); }, tabLabels[0]).catch(() => {});
    await page.waitForTimeout(400); await killAlarms(page);
  }
  return { comps, uncaptured };
}

test('코스관리 컴포넌트 인벤토리 추출 (inclusive + 위젯 + 감사)', async ({ page, context }) => {
  test.setTimeout(600_000);
  const admin = await openCourseAdmin(page, context);
  const inv: Record<string, Comp[]> = {};
  const audit: Record<string, Uncap[]> = {};

  for (const { menu, subs } of COURSE_IA) {
    for (const { name: sub } of subs) {
      const key = menu === 'Home' ? 'Home' : `${menu} > ${sub}`;
      try {
        if (menu !== 'Home') { const ok = await gotoCourseMenu(admin, menu, sub); if (!ok) { inv[key] = []; audit[key] = []; console.log(`  ${key} 진입 실패`); continue; } }
        await killAlarms(admin); await admin.waitForTimeout(1400);
        const st = await extractScreen(admin).catch(() => ({ comps: [], uncaptured: [] } as StateOut));
        inv[key] = st.comps; audit[key] = st.uncaptured;
        const tabs = new Set(st.comps.map((c) => c.tab).filter(Boolean));
        console.log(`  ${key.padEnd(28)} 컴포넌트 ${st.comps.length}${tabs.size ? ` (탭 ${tabs.size})` : ''} · 미포착후보 ${st.uncaptured.length}`);
      } catch (e) { inv[key] = []; audit[key] = []; console.log(`  ${key} 추출 실패: ${(e as Error).message.slice(0, 60)}`); }
    }
  }

  const dir = path.join(process.cwd(), 'baselines');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `course-components.${COURSE_SUBDOMAIN}.json`), JSON.stringify(inv, null, 2));
  fs.writeFileSync(path.join(dir, `course-components-audit.${COURSE_SUBDOMAIN}.json`), JSON.stringify(audit, null, 2));
  const total = Object.values(inv).reduce((a, c) => a + c.length, 0);
  const totalUc = Object.values(audit).reduce((a, c) => a + c.length, 0);
  console.log(`\n[인벤토리] 화면 ${Object.keys(inv).length} · 컴포넌트 ${total} · 미포착후보 ${totalUc} → baselines/course-components.${COURSE_SUBDOMAIN}.json (+audit)`);
});
