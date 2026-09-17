// Reproducer (Phase 9) — 이상 Finding을 **세션 내(재로그인 금지) 2회 재실행**해 재현성 분류.
//   2회 모두 이상 재관측 → REPRODUCIBLE_ANOMALY, 아니면 FLAKY_OR_ENVIRONMENTAL.
//   ⚠ 세션 1런/로그인: 재로그인 아님 — seed 리셋(ensureCleanBase 하드내비 재사용)으로 상태만 초기화.
//   비파괴: 재생도 열기형 트리거만(openTrigger). 커밋(저장/삭제/제출)은 안 함. FAIL(결정론)은 재현 대상 아님.
import type { Page, BrowserContext } from '@playwright/test';
import { settle } from '../courseHelpers';
import { openTrigger, closeTarget, forceDismiss, isBlockingModalOpen, selectFirstRow, VIEW_TRIGGER } from './transitions';
import { snapshotState } from './observe';
import { RuntimeObservers, detailSignals, fmtSignals } from './observers';
import { observeFaultReaction } from './netfault';
import type { Finding, ReplayInfo } from './anomaly';

const pathOf = (u: string): string => { try { return new URL(u).pathname; } catch { return u.replace(/^https?:\/\/[^/]+/, ''); } };

export interface ReproDeps {
  admin: Page;
  context: BrowserContext;
  obs: RuntimeObservers;
  // seed 리셋(잔존 모달 강제 해제 + 시드 재진입). explorer의 ensureCleanBase 재사용(하드내비 복구 포함).
  reset: (feature: string, sub: string) => Promise<{ clean: boolean }>;
}

interface OnceResult { anomaly: boolean; note: string; shot?: string }

// 이상 상태 스크린샷 캡처(증거) — 실패해도 무해.
async function captureShot(page: Page, shotPath: string): Promise<string | undefined> {
  try { await page.screenshot({ path: shotPath }); return shotPath; } catch { return undefined; }
}

// 규칙 1건을 1회 재생 → 이상 재관측 여부. 재생 후 반드시 비파괴 복귀.
//   shotPath 지정 시(주로 2회차) 이상 확정 순간 스크린샷 캡처(복귀 전).
async function replayOnce(r: ReplayInfo, d: ReproDeps, shotPath?: string): Promise<OnceResult> {
  const cb = await d.reset(r.feature, r.sub);
  if (!cb.clean) return { anomaly: false, note: '리셋 실패(모달 교착) — 재관측 불가' };
  // netfault 규칙 — 트리거 클릭이 아니라 API 장애 재주입으로 재현. 관측 후 클린 원복돼 스크린샷은 생략(증거=note).
  if (r.rule.startsWith('netfault')) {
    const reaction = await observeFaultReaction(d.admin, d.obs, r.status || 500);
    return { anomaly: reaction.anomaly && reaction.rule === r.rule, note: reaction.note };
  }
  // B1: 뷰형 트리거는 재현 시에도 행 선택 선행조건을 동일 적용(재현 충실도).
  if (VIEW_TRIGGER.test(r.trigger)) await selectFirstRow(d.admin);
  d.obs.clear();
  const res = await openTrigger(d.admin, d.context, r.trigger);
  if (res.kind === 'noop') { const s = d.obs.drain(); return { anomaly: false, note: `무동작(런타임 ${fmtSignals(s)})` }; }
  const sig = d.obs.drain();
  let anomaly = false; let note = ''; let shot: string | undefined;
  try {
    switch (r.rule) {
      case 'runtime-error':
        anomaly = sig.pageErrors.length > 0 || sig.http5xx.length > 0;
        note = `런타임 ${fmtSignals(sig)}${anomaly ? ' · ' + detailSignals(sig) : ''}`; break;
      case 'http-4xx':
        anomaly = sig.http4xx.length > 0;
        note = `런타임 ${fmtSignals(sig)}${anomaly ? ' · ' + detailSignals(sig) : ''}`; break;
      case 'unexpected-nav': {
        const p = pathOf(res.url || d.admin.url());
        anomaly = res.kind === 'pagenav' && (p === '/' || p === '');
        note = `kind=${res.kind} path=${p}`; break;
      }
      case 'modal-not-closeable': {
        // 열림 → 표준 닫기 시도 → 여전히 열려 있으면 이상 재현.
        if (res.kind === 'modal') { await forceDismiss(d.admin); await settle(d.admin, 300); anomaly = await isBlockingModalOpen(d.admin); }
        else anomaly = false;
        note = `kind=${res.kind} · 표준닫기후 모달잔존=${anomaly}`; break;
      }
      case 'repeat-non-idempotent': {
        // 1회 관측 → 닫고 재열기 → domSig 비교.
        const first = await snapshotState(res.page || d.admin, r.feature, r.sub, res.kind === 'modal' ? { rootSel: '.modal-group' } : {});
        await closeTarget(d.admin, res);
        const cb2 = await d.reset(r.feature, r.sub);
        let second = first.domSig;
        if (cb2.clean) {
          d.obs.clear();
          const res2 = await openTrigger(d.admin, d.context, r.trigger);
          if (res2.kind !== 'noop') {
            second = (await snapshotState(res2.page || d.admin, r.feature, r.sub, res2.kind === 'modal' ? { rootSel: '.modal-group' } : {})).domSig;
            const s2 = d.obs.drain();
            anomaly = first.domSig !== second || s2.pageErrors.length > 0 || s2.http5xx.length > 0 || s2.http4xx.length > 0;
            if (anomaly && shotPath) shot = await captureShot(res2.page || d.admin, shotPath);
            await closeTarget(d.admin, res2);
          } else { d.obs.drain(); }
        }
        note = `1회 domSig=${first.domSig} vs 2회=${second}`;
        return { anomaly, note, shot };   // 이미 닫음
      }
      default: note = `미지원 규칙(${r.rule})`; break;
    }
    if (anomaly && shotPath) shot = await captureShot(res.page || d.admin, shotPath);
  } finally {
    await closeTarget(d.admin, res).catch(() => {});
  }
  return { anomaly, note, shot };
}

export interface ReproResult { verdict: NonNullable<Finding['repro']>; detail: string; shot?: string }

// Finding 1건을 2회 재생 → 재현성 분류. shotPath(2회차 증거 스크린샷 저장 경로) 옵션.
export async function reproduceFinding(f: Finding, d: ReproDeps, shotPath?: string): Promise<ReproResult> {
  if (f.status === 'FAIL' || !f.replay) return { verdict: 'not-applicable', detail: f.replay ? 'FAIL=결정론(재현 불필요)' : 'replay 메타 없음' };
  const r1 = await replayOnce(f.replay, d);
  const r2 = await replayOnce(f.replay, d, shotPath);   // 2회차에 증거 스크린샷
  const verdict = (r1.anomaly && r2.anomaly) ? 'REPRODUCIBLE_ANOMALY' : 'FLAKY_OR_ENVIRONMENTAL';
  return { verdict, detail: `1회: ${r1.anomaly ? '재현' : '미재현'}(${r1.note}) · 2회: ${r2.anomaly ? '재현' : '미재현'}(${r2.note})`, shot: r2.shot };
}
