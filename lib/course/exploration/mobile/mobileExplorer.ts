// 코스관리 모바일 탐색 Agent — P4 MVP(비파괴).
//   시드=작업 지시. Tier A(비파괴 열기 스윕: 정렬·조건설정·상세·등록폼 열기) + Tier B(S1 연결검색 딥) →
//   RuntimeObservers로 R1(런타임)·R2(예기치 않은 랜딩 이탈)·R10(연결 검색 초기화) 평가 → 그래프/findings.
//   재사용: types·observers·graph·risk(PC) + courseMobileDeep/Helpers(진입·스택 back). 설계: docs/mobile-exploratory-design.md
//   ⚠ 비파괴: 커밋(저장/등록하기/삭제/완료확정) 미실행. 폼은 [예]/취소로 폐기. 세션 1런/thick-client/페이지스택.
import type { Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { settle } from '../../../adminHelpers';
import { gotoMobileArea, returnToLanding, killMobileAlarms } from '../../courseMobileHelpers';
import { isCourseLoggedOut } from '../../courseHelpers';
import { clickFrontLayerBack, headerTitles } from '../../courseMobileDeep';
import { record, review, skip, type CheckMeta } from '../../../reporter';
import { RuntimeObservers, fmtSignals, hasErrorSignal, detailSignals } from '../observers';
import { StateGraph } from '../graph';
import { loadBudget } from '../types';
import { scoreTrigger } from '../risk';
import { snapshotMobileState, mobileScreenInfo, MOBILE_CARD_SEL } from './mobileObserve';

const SEED = '작업 지시';

interface MobilePastDefects { defects: { key: string; feature: string; summary: string; primaryPattern: string; patterns: string[] }[]; }
function loadMobilePastDefects(): MobilePastDefects {
  try {
    const p = path.join(process.cwd(), 'Course', 'exploration', 'knowledge', 'past-defects.mobile.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { defects: Array.isArray(j.defects) ? j.defects : [] };
  } catch { return { defects: [] }; }
}

const norm = (s: string): string => (s || '').replace(/\s+/g, '');
// 공백 무시 버튼 클릭(라벨의 내부 공백 가변 대응). 카드 텍스트 오매칭 방지 위해 button 한정.
async function clickMobileByText(page: Page, label: string): Promise<boolean> {
  const want = norm(label);
  const loc = page.locator('button, [role="button"], .button-common').filter({ visible: true });
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const t = norm(await loc.nth(i).innerText().catch(() => ''));
    if (t === want || (want.length >= 3 && t.includes(want))) {
      if (await loc.nth(i).click({ timeout: 2_500 }).then(() => true).catch(() => false)) return true;
      await loc.nth(i).click({ force: true, timeout: 2_000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

// 랜딩(나의 작업 보기/LOG) 이탈 여부 — R2 unexpected-nav 판정.
async function isOnLanding(page: Page): Promise<boolean> {
  const info = await mobileScreenInfo(page);
  const hasLanding = info.btns.some((b) => /나의 작업 보기/.test(b));
  const hasArea = info.headers.some((h) => /작업|이슈|일상|장비|자재|시설|코스/.test(h));
  return hasLanding && !hasArea;
}

// 비파괴 복귀 — 잔존 폼/모달 강제 폐기 후 시드 재진입(스택 붕괴). observers가 beforeunload accept.
async function recover(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (!(await clickFrontLayerBack(page).catch(() => false))) break;
    await settle(page, 500);
    // 취소확인 팝업이 뜨면 [예]로 폐기(비파괴 — 입력값 없거나 폐기 대상).
    const yes = page.getByText(/^\s*(예|확인)\s*$/).filter({ visible: true }).first();
    if (await yes.count().catch(() => 0)) { await yes.click({ timeout: 1_500 }).catch(() => {}); await settle(page, 400); }
    if (await isOnLanding(page)) break;
  }
  await returnToLanding(page).catch(() => {});
  await settle(page, 400);
  await gotoMobileArea(page, SEED).catch(() => {});
  await settle(page, 700); await killMobileAlarms(page);
}

export async function runMobileExplore(page: Page, context: BrowserContext): Promise<void> {
  const obs = new RuntimeObservers(); obs.attach(page, context);
  const graph = new StateGraph();
  const pd = loadMobilePastDefects();
  const budget = loadBudget();
  const findings: { rule: string; label: string; status: string; detail: string; jira: string[] }[] = [];
  let actions = 0;

  const meta = (n: number, sub: string, desc: string, failMsg = ''): CheckMeta =>
    ({ path: `코스관리(모바일) > ${SEED} > ${sub}`, tcRef: `코스관리모바일_탐색_${n}`, tcId: `MEXP-${String(n).padStart(2, '0')}`, desc, failMsg });
  const rv = (kind: string, item: string, value: string): void =>
    review({ lang: '탐색', screen: `코스관리(모바일) > ${SEED}`, kind, zone: 'explore', item, value, screenshot: '' });
  let n = 1;

  // ── 진입 ──
  obs.clear();
  if (!(await gotoMobileArea(page, SEED))) { skip(meta(n, '진입', '작업 지시 진입', '진입 실패'), '시드 진입 실패(세션/네비 레이스)'); return; }
  await settle(page, 900); await killMobileAlarms(page);
  const entrySig = obs.drain();
  if (hasErrorSignal(entrySig)) rv('진입 런타임 이상(R1)', fmtSignals(entrySig), detailSignals(entrySig));
  let cur = await snapshotMobileState(page, SEED, '리스트').catch((e) => { if (String(e).includes('SESSION_EXPIRED')) throw e; return null; });
  if (!cur) { skip(meta(n, '진입', '작업 지시 관측', '관측 실패'), '리스트 상태 관측 실패'); return; }
  const listKey = graph.addState(cur);
  record(meta(n++, '진입', '작업 지시 리스트 진입 + 관측', ''), 'PASS', { actual: `${cur.businessState}·액션후보 ${cur.actions.length}` });

  // ── Risk 정렬 ──
  const scored = cur.actions.map((a) => {
    const visits = graph.countTransition(listKey, a.label);
    const r = scoreTrigger(SEED, '리스트', a.label, { unvisited: visits === 0, visits, destructive: a.destructive, apiLikely: a.apiLikely }, pd);
    return { a, r };
  }).sort((x, y) => y.r.score - x.r.score);
  rv('Risk 순위(상위 8)', scored.slice(0, 8).map((s) => `${s.a.label}=${s.r.score}`).join(' · '),
    scored.slice(0, 3).map((s) => `[${s.a.label}] ${s.r.reasons.join('; ')}`).join(' || '));

  // ── Tier A: 비파괴 열기 스윕(view/openModal/sort/filter/search — 커밋 제외) ──
  const openable = scored.filter((s) => !s.a.destructive && ['view', 'openModal', 'sort', 'filter', 'search'].includes(s.a.kind)).slice(0, budget.maxScenarios);
  for (const { a, r } of openable) {
    if (actions >= budget.maxActionsPerSession) break;
    if (isCourseLoggedOut(page)) { rv('세션 만료', 'Tier A 조기 종료', ''); break; }
    actions++;
    obs.clear();
    const clicked = await clickMobileByText(page, a.label);
    await settle(page, 1_100); await killMobileAlarms(page);
    if (!clicked) { skip(meta(n++, 'TierA', `[${a.label}] 트리거`, '미발견'), `버튼 미발견(Risk ${r.score})`); await recover(page); continue; }
    const sig = obs.drain();
    const sub = await snapshotMobileState(page, SEED, a.label).catch(() => null);
    if (sub) { const toKey = graph.addState(sub); graph.addTransition(listKey, `${a.label}[${a.kind}]`, toKey); }
    // R1 runtime-error
    if (hasErrorSignal(sig)) {
      const st = (sig.pageErrors.length || sig.http5xx.length) ? 'ANOMALY' : 'NEEDS_REVIEW';
      findings.push({ rule: 'runtime-error', label: a.label, status: st, detail: detailSignals(sig), jira: r.jiraKeys });
      rv(`이상: ${st} (R1 runtime)`, `[${a.label}] ${fmtSignals(sig)}`, detailSignals(sig));
    }
    // R2 unexpected-nav(뷰류인데 랜딩 이탈)
    if ((a.kind === 'view' || a.kind === 'sort' || a.kind === 'filter') && await isOnLanding(page)) {
      findings.push({ rule: 'unexpected-nav', label: a.label, status: 'ANOMALY', detail: '뷰형 트리거 후 랜딩(나의 작업 보기) 이탈', jira: r.jiraKeys });
      rv('이상: ANOMALY (R2 unexpected-nav)', `[${a.label}] 뷰형인데 랜딩 이탈`, '');
    }
    record(meta(n++, 'TierA', `[${a.label}] 열기 → ${sub ? sub.businessState : '?'} (Risk ${r.score})`, ''), 'PASS',
      { actual: `${a.kind} · ${fmtSignals(sig)}${r.jiraKeys.length ? ` · 연관 ${r.jiraKeys.join(',')}` : ''}` });
    await recover(page);
  }

  // ── Tier B: S1 연결검색 딥(best-effort, 비파괴) ──
  await scanConnectSearch(page, obs, graph, listKey, pd, findings, rv, meta, () => n++);

  // ── 영속 + 요약 ──
  graph.persist(path.join(process.cwd(), 'Course', 'exploration', 'results', 'mobile-state-graph.json'));
  const findDir = path.join(process.cwd(), 'Course', 'exploration', 'results');
  fs.mkdirSync(findDir, { recursive: true });
  fs.writeFileSync(path.join(findDir, 'findings.mobile.json'), JSON.stringify({ generatedAt: new Date().toISOString(), seed: SEED, findings }, null, 2), 'utf8');
  rv('탐색 요약', `노드 ${graph.nodes.size}·엣지 ${graph.edges.length}·액션 ${actions}·이상 ${findings.length}`,
    findings.map((f) => `${f.rule}[${f.status}] ${f.label}`).join(' | ') || '이상 0(클린)');
}

// S1 — 등록폼 진입 → 연결(불러오기) 트리거 → 서브화면 검색·조건설정 후 검색어 보존(R10)·빈상태 안내 검증. 비파괴.
async function scanConnectSearch(
  page: Page, obs: RuntimeObservers, graph: StateGraph, fromKey: string,
  pd: MobilePastDefects, findings: { rule: string; label: string; status: string; detail: string; jira: string[] }[],
  rv: (k: string, i: string, v: string) => void, meta: (n: number, s: string, d: string, f?: string) => CheckMeta, nextN: () => number,
): Promise<void> {
  const sub = 'S1 연결검색';
  // 1) 등록폼 진입(하단 primary 버튼).
  const reg = page.locator('button.button-common.type-p').filter({ hasText: /작업\s*지시\s*등록|작업\s*등록|등록/ }).filter({ visible: true }).last();
  const base = await headerTitles(page);
  if (!(await reg.count().catch(() => 0)) || !(await reg.click({ timeout: 3_000 }).then(() => true).catch(() => false))) {
    skip(meta(nextN(), sub, '등록폼 진입', '미진입'), '작업 지시 등록 버튼 미발견/클릭 실패'); return;
  }
  await settle(page, 1_300); await killMobileAlarms(page);
  const opened = (await headerTitles(page)).some((t) => !base.includes(t));
  if (!opened) { skip(meta(nextN(), sub, '등록폼 진입', '헤더 미변화'), '등록 클릭 후 새 폼 헤더 미등장'); await recover2(page); return; }

  // 2) 연결 트리거 탐색.
  const connectRe = /종료된 작업 불러오기|발병 ?정보 ?연결|일상 ?점검 ?연결|이슈 ?연결|연결/;
  obs.clear();
  const formBase = await headerTitles(page);
  const connected = await clickFirstByText(page, connectRe);
  await settle(page, 1_200); await killMobileAlarms(page);
  if (!connected) {
    await dumpMobile(page, rv, 'S1 등록폼 — 연결 트리거 미발견 구조');
    skip(meta(nextN(), sub, '연결 트리거', '미발견'), '연결/불러오기 트리거 미발견(폼 구조 상이 — 프로브 참조)');
    await recover2(page); return;
  }
  const cSig = obs.drain();
  if (hasErrorSignal(cSig)) {
    const st = (cSig.pageErrors.length || cSig.http5xx.length) ? 'ANOMALY' : 'NEEDS_REVIEW';
    findings.push({ rule: 'runtime-error', label: '연결', status: st, detail: detailSignals(cSig), jira: ['QA-15652', 'QA-15579'] });
    rv(`이상: ${st} (R1 연결)`, `연결 진입 ${fmtSignals(cSig)}`, detailSignals(cSig));
  }
  const connState = await snapshotMobileState(page, SEED, sub).catch(() => null);
  if (connState) { const k = graph.addState(connState); graph.addTransition(fromKey, '연결[openModal]', k); }

  // 3) 검색어 입력 → 조건설정 열고닫기 → 검색어 보존(R10).
  const searchInp = page.locator('input[placeholder*="검색"], input.search-header, input[type="search"]').filter({ visible: true }).first();
  if (await searchInp.count().catch(() => 0)) {
    const term = '탐색검증';
    await searchInp.click({ timeout: 2_000 }).catch(() => {});
    await searchInp.pressSequentially(term, { delay: 30 }).catch(() => {});
    await settle(page, 800);
    const before = (await searchInp.inputValue().catch(() => '')) || '';
    // 조건설정 열고 닫기.
    if (await clickFirstByText(page, /조건설정|필터/)) {
      await settle(page, 900);
      await clickFirstByText(page, /^\s*(취소|닫기|초기화|적용)\s*$/).catch(() => {});
      await settle(page, 800);
    }
    const after = (await searchInp.inputValue().catch(() => '')) || '';
    if (before && !after) {
      findings.push({ rule: 'search-reset-on-nav', label: '연결 검색', status: 'ANOMALY', detail: `조건설정 후 검색어 소실(${before}→'')`, jira: ['QA-15573', 'QA-15585'] });
      rv('이상: ANOMALY (R10 search-reset)', '조건설정 후 검색어 소실', `${before} → (빈값)`);
    } else {
      record(meta(nextN(), sub, '검색어 입력 → 조건설정 후 검색어 보존(R10)', ''), before && after ? 'PASS' : 'FAIL',
        { actual: `보존: ${before} → ${after}` });
    }
    // 4) 빈상태 안내(0건 검색).
    await searchInp.click({ timeout: 1_500 }).catch(() => {});
    await searchInp.fill('').catch(() => {});
    await searchInp.pressSequentially('ZZQX존재하지않는검색어', { delay: 20 }).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await settle(page, 1_100);
    const info = await mobileScreenInfo(page);
    if (info.cards === 0) {
      record(meta(nextN(), sub, '0건 검색 → "결과가 없습니다" 안내 노출', '안내 문구 미노출'), info.hasEmpty ? 'PASS' : 'FAIL',
        { actual: info.hasEmpty ? '빈상태 안내 노출' : '카드 0건이나 안내 문구 미노출(QA-15659)' });
      if (!info.hasEmpty) findings.push({ rule: 'missing-empty-state', label: '연결 검색 0건', status: 'NEEDS_REVIEW', detail: '0건인데 안내 문구 없음', jira: ['QA-15659'] });
    } else {
      skip(meta(nextN(), sub, '0건 검색 안내', '0건 미달성'), `검색 결과 ${info.cards}건(0건 케이스 미형성)`);
    }
  } else {
    await dumpMobile(page, rv, 'S1 연결 서브화면 — 검색 input 미발견 구조');
    skip(meta(nextN(), sub, '검색 input', '미발견'), '연결 서브화면 검색 input 미발견(프로브 참조)');
  }
  await recover2(page);
}

// 텍스트(정규식) 첫 매칭 버튼/요소 클릭(공백 완화). 카드 오매칭 방지 위해 클릭 요소 한정.
async function clickFirstByText(page: Page, re: RegExp): Promise<boolean> {
  const loc = page.locator('button, [role="button"], .button-common, li, a').filter({ visible: true }).filter({ hasText: re });
  if (!(await loc.count().catch(() => 0))) return false;
  if (await loc.first().click({ timeout: 2_500 }).then(() => true).catch(() => false)) return true;
  await loc.first().click({ force: true, timeout: 2_000 }).catch(() => {});
  return true;
}

async function dumpMobile(page: Page, rv: (k: string, i: string, v: string) => void, note: string): Promise<void> {
  const dump = await page.evaluate(() => Array.from(document.querySelectorAll('button, [class*="header-title"], input, [class*="option"], li'))
    .filter((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 6 && r.height > 6; })
    .map((e) => { const t = ((e as HTMLElement).innerText || (e as HTMLInputElement).placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 22); return `${e.tagName.toLowerCase()}${t ? `="${t}"` : ''}`; })
    .filter((s, i, a) => a.indexOf(s) === i).slice(0, 40)).catch(() => [] as string[]);
  rv('DOM 구조 프로브', note, dump.join(' | '));
}

// 폼/서브화면 비파괴 종료 후 시드 복귀(로컬 — recover와 동일 취지).
async function recover2(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (!(await clickFrontLayerBack(page).catch(() => false))) break;
    await settle(page, 500);
    const yes = page.getByText(/^\s*(예|확인)\s*$/).filter({ visible: true }).first();
    if (await yes.count().catch(() => 0)) { await yes.click({ timeout: 1_500 }).catch(() => {}); await settle(page, 400); }
  }
  await returnToLanding(page).catch(() => {});
  await settle(page, 400);
  await gotoMobileArea(page, SEED).catch(() => {});
  await settle(page, 700); await killMobileAlarms(page);
}
