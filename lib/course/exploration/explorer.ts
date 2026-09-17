// 탐색 오케스트레이터 — Phase 5: 시드 진입 → 관측 → **열기형 트리거로 상세/등록폼 서브상태 진입** → 전이 기록 → 상태그래프 확장.
//   비파괴: 열기(상세/등록/설정)만 클릭하고 커밋(저장/삭제/제출/적용)은 미실행. 모달=취소/닫기, 페이지=뒤로, 새탭=close 로 복귀.
//   ⚠ Risk 스코어·시퀀스·netfault·재현·후보는 Phase 7~10.
import * as path from 'path';
import type { Page, BrowserContext } from '@playwright/test';
import { gotoCourseMenu, killAlarms, isCourseLoggedOut, settle, COURSE_URL } from '../courseHelpers';
import { record, review, skip, type CheckMeta } from '../../reporter';
import { snapshotState, stateKey } from './observe';
import { StateGraph } from './graph';
import { collectOpenTriggers, openTrigger, closeTarget, forceDismiss, isBlockingModalOpen, probeTopModal, selectFirstRow, VIEW_TRIGGER } from './transitions';
import { RuntimeObservers, fmtSignals, detailSignals, hasErrorSignal } from './observers';
import { loadPastDefects, scoreTrigger } from './risk';
import { FindingSink, evalTransition, findingModalDeadlock, findingRepeatNonIdempotent, findingNetfault, findingCommit } from './anomaly';
import { reproduceFinding, type ReproDeps } from './reproduce';
import { writeCandidates } from './candidate';
import { observeFaultReaction, netfaultEnabled, netfaultStatus } from './netfault';
import { runCommitSequence } from './commit';
import type { Budget, ExplorerState } from './types';

export interface Seed { feature: string; sub: string; }
export interface ExploreOpts { budget: Budget; seeds: Seed[]; context: BrowserContext; }

const TCREF = '코스관리탐색';
const RESULTS = path.join(process.cwd(), 'Course', 'exploration', 'results', 'state-graph.json');
const FINDINGS = path.join(process.cwd(), 'Course', 'exploration', 'results', 'findings.json');
const CANDIDATES = path.join(process.cwd(), 'Course', 'exploration', 'candidates');
const meta = (screen: string, note: string): CheckMeta => ({ path: `탐색 > ${screen}`, tcRef: TCREF, tcId: 'EXPLORE', desc: note });
const pathOf = (u: string): string => { try { return new URL(u).pathname; } catch { return u.replace(/^https?:\/\/[^/]+/, ''); } };

// 클린 베이스 보장 — 잔존 모달(취소 확인 포함) 강제 해제 + 시드 재진입. 다음 트리거를 오염 없는 상태에서 실행.
//   반환 false = 모달을 못 닫음(교착) → caller는 정직 기록 후 중단(캐스케이드 방지).
interface CleanResult { clean: boolean; usedHardNav: boolean; }
async function ensureCleanBase(admin: Page, seed: Seed): Promise<CleanResult> {
  await killAlarms(admin);
  let usedHardNav = false;
  if (await isBlockingModalOpen(admin)) {
    await forceDismiss(admin);
    // 표준 닫기(취소/X/Escape/확인)로 안 닫히면 **하드 내비(page.goto)로 강제 폐기** — 이 자체가 이상 신호(R3).
    //   beforeunload 다이얼로그는 RuntimeObservers 상주 핸들러가 자동 accept(중복 핸들러 금지).
    if (await isBlockingModalOpen(admin)) {
      usedHardNav = true;
      await admin.goto(COURSE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await settle(admin, 700); await killAlarms(admin);
    }
  }
  await gotoCourseMenu(admin, seed.feature, seed.sub).catch(() => {});
  await killAlarms(admin);
  return { clean: !(await isBlockingModalOpen(admin)), usedHardNav };
}

export async function runExplorer(admin: Page, opts: ExploreOpts): Promise<void> {
  const graph = new StateGraph();
  const obs = new RuntimeObservers();
  obs.attach(admin, opts.context);   // 세션 상주 런타임 훅(console·pageerror·network·dialog)
  const pd = loadPastDefects();      // 과거결함 KB(QA-15289 PC) — Risk 부스트
  const sink = new FindingSink();    // 이상 Finding 수집(비파괴)
  const t0 = Date.now();
  let actions = 0;
  let commitsDone = 0;   // 파괴 커밋 실행 수(세션 상한)
  const commitMax = Number(process.env.EXPLORE_COMMIT_MAX) > 0 ? Number(process.env.EXPLORE_COMMIT_MAX) : 3;
  const overBudget = (): boolean => actions >= opts.budget.maxActionsPerSession || (Date.now() - t0) / 60_000 >= opts.budget.maxExecutionMinutes;

  for (const seed of opts.seeds) {
    if (overBudget()) break;
    const scr = `${seed.feature} > ${seed.sub}`;
    obs.clear();   // 이 화면 진입 구간의 런타임 신호 관측 시작
    if (!(await gotoCourseMenu(admin, seed.feature, seed.sub))) { skip(meta(scr, '진입'), '메뉴 진입 실패'); continue; }
    if (isCourseLoggedOut(admin)) { skip(meta(scr, '세션'), '세션 만료 — 재인증 필요(1런/로그인)'); graph.persist(RESULTS); return; }

    let seedState: ExplorerState;
    try { seedState = await snapshotState(admin, seed.feature, seed.sub); }
    catch (e) { skip(meta(scr, '관측'), 'snapshot 실패: ' + String(e)); continue; }
    const seedSig = obs.drain();   // 진입 구간 런타임 신호
    const seedKey = graph.addState(seedState);

    const nDes = seedState.actions.filter((a) => a.destructive).length;
    const nView = seedState.actions.filter((a) => !a.destructive).length;
    review({ lang: '-', screen: scr, kind: '상태 관측', zone: 'observe',
      item: `businessState=${seedState.businessState} · 액션후보 ${seedState.actions.length}(view ${nView}/파괴 ${nDes}) · 런타임 ${fmtSignals(seedSig)}`,
      value: `[${seedState.actions.map((a) => a.label).slice(0, 16).join(', ')}]` });
    record(meta(scr, '상태 관측'), seedState.actions.length > 0 ? 'PASS' : 'SKIP',
      { actual: `액션후보 ${seedState.actions.length}·businessState ${seedState.businessState}`, detail: `진입 런타임: ${fmtSignals(seedSig)}` });
    if (hasErrorSignal(seedSig)) review({ lang: '-', screen: scr, kind: '런타임 이상', zone: 'runtime', item: `진입 중 에러 신호 — ${fmtSignals(seedSig)}`, value: detailSignals(seedSig) });

    // ── 서브상태 확장: 열기형 트리거 → **Risk 순 정렬**(과거결함·미방문·API) → 상위부터 진입 → 관측 → 전이 기록 → 비파괴 복귀.
    const rawTriggers = await collectOpenTriggers(admin, Math.min(opts.budget.maxScenarios, 12));
    const scored = rawTriggers.map((t) => ({
      t,
      rs: scoreTrigger(seed.feature, seed.sub, t, { unvisited: graph.countTransition(seedKey, t) === 0, visits: graph.countTransition(seedKey, t), destructive: false, apiLikely: /조회|검색|불러오기|다운로드/.test(t) }, pd),
    })).sort((a, b) => b.rs.score - a.rs.score);
    review({ lang: '-', screen: scr, kind: 'Risk 순위', zone: 'risk',
      item: `트리거 ${scored.length} (Risk 내림차순)`, value: scored.map((x) => `${x.t}=${x.rs.score}${x.rs.jiraKeys.length ? `[${x.rs.jiraKeys.join(',')}]` : ''}`).join(' · ') });
    const triggers = scored.map((x) => x.t);
    const riskOf = new Map(scored.map((x) => [x.t, x.rs]));
    const screenJira = [...new Set(scored.flatMap((x) => x.rs.jiraKeys))].slice(0, 5);   // 화면 hotspot 연관 Jira(netfault 귀속)
    let expanded = 0;
    let lastTrigger = '';   // 직전 트리거(하드내비 필요 시 그 모달의 소유자)
    for (const trg of triggers) {
      const rs = riskOf.get(trg)!;
      if (overBudget() || expanded >= opts.budget.maxScenarios) break;
      if (isCourseLoggedOut(admin)) { skip(meta(scr, '세션'), '세션 만료 — 중단'); graph.persist(RESULTS); return; }
      // ⚠ 트리거 전 클린 베이스 보장. 교착=중단(프로브+Finding), 하드내비 사용=직전 모달이 표준닫기 실패(R3 Finding).
      const clean = await ensureCleanBase(admin, seed);
      if (!clean.clean) {
        const p = await probeTopModal(admin);
        const probeStr = `제목="${p.head}" 버튼[${p.buttons.join(',')}] 닫기후보[${p.closers.join('|')}]`;
        sink.add(findingModalDeadlock(seed.feature, seed.sub, lastTrigger || trg, probeStr, rs.jiraKeys));
        review({ lang: '-', screen: scr, kind: '이상: NEEDS_REVIEW', zone: 'anomaly', item: `[${lastTrigger || trg}] 모달 하드내비 후에도 교착`, value: probeStr });
        break;
      }
      if (clean.usedHardNav && lastTrigger) {
        // 직전 트리거의 모달이 표준 닫기로 안 닫혀 하드내비로만 복구됨 → R3 Finding(잠재 UX 결함).
        const f = findingModalDeadlock(seed.feature, seed.sub, lastTrigger, '표준 닫기(취소/X/Escape/확인) 실패 → page.goto 하드내비로만 복구', riskOf.get(lastTrigger)?.jiraKeys || []);
        sink.add(f);
        review({ lang: '-', screen: scr, kind: '이상: NEEDS_REVIEW', zone: 'anomaly', item: `[${lastTrigger}] ${f.reason}`, value: f.evidence });
      }
      // B1: 뷰형 트리거는 행 선택 선행조건 충족(무선택 무동작/미처리 예외 판별).
      let preRow = '';
      if (VIEW_TRIGGER.test(trg)) { const s = await selectFirstRow(admin); preRow = ` · 선행 행선택=${s.selected ? s.how : 'X(' + s.how + ')'}`; }
      obs.clear();   // 이 트리거 구간의 런타임 신호 관측 시작
      const res = await openTrigger(admin, opts.context, trg);
      actions++;
      if (res.kind === 'noop') {
        const sig = obs.drain();
        review({ lang: '-', screen: scr, kind: '무동작 관찰', zone: 'transition', item: `[${trg}] 클릭 후 전환 없음(게이트/선행조건 의심)${preRow}`, value: `런타임 ${fmtSignals(sig)}` });
        if (hasErrorSignal(sig)) review({ lang: '-', screen: scr, kind: '런타임 이상', zone: 'runtime', item: `[${trg}] 무동작이나 에러 신호 — ${fmtSignals(sig)}`, value: detailSignals(sig) });
        continue;
      }
      const targetPage: Page = res.page || admin;
      const targetSub = res.kind === 'newtab' ? `${seed.sub}(새탭)` : seed.sub;
      // ⚠ 모달 전이는 **모달 스코프** 관측(리스트 버튼 오염 방지). 페이지전환/새탭은 whole-doc.
      const snapOpts = res.kind === 'modal' ? { rootSel: '.modal-group' } : {};
      let target: ExplorerState;
      try { target = await snapshotState(targetPage, seed.feature, targetSub, snapOpts); }
      catch (e) { skip(meta(`${seed.sub}·${trg}`, '관측'), 'snapshot 실패: ' + String(e)); await closeTarget(admin, res); continue; }
      const sig = obs.drain();   // 이 전이 구간 런타임 신호
      const targetKey = graph.addState(target);
      graph.addTransition(seedKey, `${trg}[${res.kind}]`, targetKey);
      const jira = rs.jiraKeys.length ? ` · 연관 ${rs.jiraKeys.join(',')}` : '';
      record(meta(`${seed.sub}·${trg}`, '전이'), 'PASS',
        { actual: `${res.kind}: ${seedState.businessState}→${target.businessState} · 대상 액션 ${target.actions.length} · Risk ${rs.score}${jira}`, detail: `전이 런타임: ${fmtSignals(sig)} | Risk 근거: ${rs.reasons.join('; ')}` });
      review({ lang: '-', screen: `${scr} · ${trg}(${res.kind})`, kind: '서브상태 관측', zone: 'transition',
        item: `Risk ${rs.score}${jira} · businessState=${target.businessState} · 액션 ${target.actions.length} · 런타임 ${fmtSignals(sig)}${preRow}`,
        value: `[${target.actions.map((a) => a.label).slice(0, 16).join(', ')}]` });
      // ── Anomaly 평가(비파괴 규칙): 런타임 이상·예상외 nav → Finding.
      const fnds = evalTransition({ screen: scr, feature: seed.feature, sub: seed.sub, trigger: trg, kind: res.kind, fromBs: seedState.businessState, toBs: target.businessState,
        fromPath: pathOf(seedState.url), toPath: pathOf(target.url), signals: sig, jiraKeys: rs.jiraKeys });
      for (const fnd of fnds) {
        sink.add(fnd);
        review({ lang: '-', screen: `${scr} · ${trg}`, kind: `이상: ${fnd.status}`, zone: 'anomaly',
          item: `[${fnd.rule}] ${fnd.reason}${fnd.jiraKeys.length ? ` · 연관 ${fnd.jiraKeys.join(',')}` : ''}`, value: fnd.evidence });
      }
      expanded++;
      lastTrigger = trg;   // 이 트리거의 모달 닫힘 여부는 다음 ensureCleanBase 가 판정(하드내비 필요=R3)
      await closeTarget(admin, res);

      // ── 비파괴 시퀀스: 최상위 Risk 트리거 **2회 열기(반복 비멱등)** 검사 — 반복 클릭에 결과 달라지는지.
      if (expanded === 1 && !overBudget() && res.kind === 'modal' && (await ensureCleanBase(admin, seed)).clean) {
        lastTrigger = '';   // 반복 검사에서 재열기 → 다음 루프의 하드내비 판정이 반복분에 오귀속되지 않게 리셋
        obs.clear();
        const res2 = await openTrigger(admin, opts.context, trg);
        actions++;
        if (res2.kind !== 'noop') {
          try {
            const t2 = await snapshotState(res2.page || admin, seed.feature, seed.sub, res2.kind === 'modal' ? { rootSel: '.modal-group' } : {});
            const sig2 = obs.drain();
            const rep = findingRepeatNonIdempotent(seed.feature, seed.sub, trg, target.domSig, t2.domSig, sig2, rs.jiraKeys);
            if (rep) { sink.add(rep); review({ lang: '-', screen: `${scr} · ${trg}`, kind: `이상: ${rep.status}`, zone: 'anomaly', item: `[${rep.rule}] ${rep.reason}`, value: rep.evidence }); }
            else review({ lang: '-', screen: `${scr} · ${trg}`, kind: '반복 멱등', zone: 'anomaly', item: `[${trg}] 2회 열기 동일(멱등)`, value: `domSig ${t2.domSig}` });
          } catch { /* 무시 */ }
          await closeTarget(admin, res2);
        } else { obs.drain(); }
      }
      // 다음 트리거의 ensureCleanBase 가 잔존 모달(취소 확인)까지 정리 → 여기선 별도 recover 불필요.
    }
    review({ lang: '-', screen: scr, kind: '전이 요약', zone: 'transition', item: `열기형 트리거 ${triggers.length} · 전이 확장 ${expanded}`, value: `[${triggers.join(', ')}]` });

    // ── netfault 패스(비파괴 · opt-in EXPLORE_NETFAULT=1): API 장애(4xx/5xx) 주입 → refetch → 복원력 관찰.
    if (netfaultEnabled() && !overBudget() && !isCourseLoggedOut(admin)) {
      await ensureCleanBase(admin, seed);
      const status = netfaultStatus();
      const reaction = await observeFaultReaction(admin, obs, status);
      actions++;
      if (reaction.anomaly) {
        const f = findingNetfault(seed.feature, seed.sub, reaction.rule, status, reaction.note, screenJira);
        sink.add(f);
        review({ lang: '-', screen: scr, kind: `이상: ${f.status}`, zone: 'netfault', item: `[${reaction.rule}] ${f.reason}${screenJira.length ? ` · 연관 ${screenJira.join(',')}` : ''}`, value: reaction.note });
      } else {
        review({ lang: '-', screen: scr, kind: '네트워크 장애 관찰', zone: 'netfault', item: `[${reaction.rule}]`, value: reaction.note });
      }
    }

    // ── 파괴 커밋 패스(opt-in ALLOW_DESTRUCTIVE=1 + 3중 가드): 등록 모달 마커 커밋 → 목록 검증 → teardown(잔여0).
    const regTrg = triggers.find((t) => /신규|등록/.test(t) && !/조회|다운로드|불러오기/.test(t));
    if (process.env.ALLOW_DESTRUCTIVE === '1' && regTrg && commitsDone < commitMax && !overBudget() && !isCourseLoggedOut(admin)) {
      if ((await ensureCleanBase(admin, seed)).clean) {
        const cr = await runCommitSequence(admin, opts.context, obs, regTrg);
        actions++;
        if (cr.status !== 'SKIP') commitsDone++;
        const jkeys = riskOf.get(regTrg)?.jiraKeys || [];
        if (cr.status === 'ANOMALY' || cr.status === 'NEEDS_REVIEW') {
          sink.add(findingCommit(seed.feature, seed.sub, regTrg, cr.status, cr.rule, cr.note, jkeys));
          review({ lang: '-', screen: scr, kind: `이상: ${cr.status}`, zone: 'commit', item: `[${cr.rule}] ${cr.note}${jkeys.length ? ` · 연관 ${jkeys.join(',')}` : ''}`, value: `[${regTrg}] 파괴 커밋` });
        } else {
          record(meta(`${seed.sub}·${regTrg}`, '파괴 커밋'), cr.status === 'PASS' ? 'PASS' : 'SKIP', { actual: `${cr.rule}: ${cr.note}` });
          review({ lang: '-', screen: scr, kind: '파괴 커밋', zone: 'commit', item: `[${regTrg}] ${cr.status} — ${cr.rule}`, value: cr.note });
        }
      }
    }
  }

  graph.persist(RESULTS);   // 그래프는 재현 전에 먼저 영속(재현이 상태를 흔들어도 탐색 결과 보존)

  // ── Phase 9: 재현(Reproducer) — 이상 Finding을 **세션 내 2회 재실행**해 재현성 분류(재로그인 금지).
  //   FAIL(결정론)은 제외. ANOMALY/NEEDS_REVIEW만 재현 대상. 재현 2회가 예산을 크게 먹으므로 상한(REPRO_MAX)·overBudget 가드.
  const reproTargets = sink.findings.filter((f) => f.status !== 'FAIL' && f.replay);
  if (reproTargets.length > 0 && !isCourseLoggedOut(admin)) {
    const reproMax = Number(process.env.EXPLORE_REPRO_MAX) > 0 ? Number(process.env.EXPLORE_REPRO_MAX) : 6;
    const deps: ReproDeps = {
      admin, context: opts.context, obs,
      reset: async (feature, sub) => ({ clean: (await ensureCleanBase(admin, { feature, sub })).clean }),
    };
    let done = 0;
    for (const f of reproTargets) {
      if (overBudget() || done >= reproMax || isCourseLoggedOut(admin)) { f.repro = 'not-checked'; f.reproDetail = '예산 초과 — 재현 미실행'; continue; }
      obs.clear();
      const shotPath = path.join(CANDIDATES, `${f.id}.png`);
      const rr = await reproduceFinding(f, deps, shotPath);
      actions += 2;   // 재생 2회(대략)
      f.repro = rr.verdict; f.reproDetail = rr.detail; if (rr.shot) f.shotPath = rr.shot;
      done++;
      review({ lang: '-', screen: f.screen, kind: `재현: ${rr.verdict}`, zone: 'reproduce',
        item: `[${f.rule}] ${f.reason}${f.jiraKeys.length ? ` · 연관 ${f.jiraKeys.join(',')}` : ''}`, value: rr.detail });
    }
    review({ lang: '-', screen: '탐색 요약', kind: '재현 요약', zone: 'reproduce',
      item: `재현 대상 ${reproTargets.length} · 실행 ${done} — REPRODUCIBLE ${reproTargets.filter((f) => f.repro === 'REPRODUCIBLE_ANOMALY').length} · FLAKY ${reproTargets.filter((f) => f.repro === 'FLAKY_OR_ENVIRONMENTAL').length}`,
      value: '세션 내 2회 재실행(재로그인 없이 seed 리셋)' });
  } else {
    review({ lang: '-', screen: '탐색 요약', kind: '재현 요약', zone: 'reproduce',
      item: `재현 대상 0건 — 재현할 이상 Finding 없음(FAIL 제외 후)`, value: isCourseLoggedOut(admin) ? '세션 만료로 재현 생략' : '이번 런은 이상 0(정직)' });
  }

  sink.persist(FINDINGS);   // 재현 결과(repro/reproDetail) 반영 후 영속

  // ── Phase 10: Candidate — REPRODUCIBLE_ANOMALY Finding만 candidates/<slug>.{md,json} 산출(자동 merge 금지).
  const cand = writeCandidates(sink.findings, CANDIDATES);
  review({ lang: '-', screen: '탐색 요약', kind: '결함 후보', zone: 'candidate',
    item: `REPRODUCIBLE 후보 ${cand.count}건 산출(자동 merge 금지·사람 검토 후 승격)`,
    value: cand.written.map((w) => path.relative(process.cwd(), w).replace(/\\/g, '/')).join(' · ') || 'Course/exploration/candidates (후보 0)' });

  const bs = sink.byStatus();
  review({ lang: '-', screen: '탐색 요약', kind: '이상 요약', zone: 'anomaly',
    item: `Finding ${sink.count()}건 — ${Object.entries(bs).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`, value: 'Course/exploration/results/findings.json' });
  review({ lang: '-', screen: '탐색 요약', kind: '상태그래프', zone: 'graph',
    item: `노드 ${graph.nodes.size} · 엣지 ${graph.edges.length} · 실행 액션 ${actions}`, value: 'Course/exploration/results/state-graph.json' });
}
