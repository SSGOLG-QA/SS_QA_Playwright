/**
 * Assertion Sensitivity Engine (P3-B 정식 스위트)
 *
 * DOM 결함 주입으로 각 단언 패턴의 "falsifiable 여부"를 측정하는 공통 하네스.
 * - 서버 쓰기 없음 — in-page DOM evaluate만 사용(비파괴, ALLOW_DESTRUCTIVE 불필요)
 * - 케이스: setup → baseline → mutate → re-assert → revert → 판정
 * - 케이스 정의(SensCase[])는 호출자가 화면별로 구성 → 엔진은 실행·집계·기록만 담당
 */

import { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { check, checkText, getResults, record, skip, resetResults, CheckMeta, TCResult } from './reporter';

export { check, checkText };   // re-export so callers don't need separate import

// ── 타입 ─────────────────────────────────────────────────────────
export type SensCase = {
  id: string;
  screen: string;
  kind: string;                                   // 단언 유형 설명
  setup: () => Promise<boolean>;                  // 대상 준비. false=대상 없음 → SKIP
  assertion: () => Promise<void>;                 // reporter 단언(check/checkText/…)
  mutate: () => Promise<() => Promise<void>>;     // 결함 주입 → revert 반환
};

export type Verdict = {
  c: SensCase;
  baseStatus?: string;
  mutStatus?: string;
  result: 'PASS' | 'FAIL' | 'SKIP';
  note: string;
};

// ── 단언 1회 실행 → 직후 push된 TCResult 반환 ─────────────────
export async function runStatus(fn: () => Promise<void>): Promise<TCResult | undefined> {
  const i = getResults().length;
  await fn();
  return getResults()[i];
}

// ── 케이스 루프 실행 → Verdict[] ──────────────────────────────
export async function evaluateSensCases(cases: SensCase[]): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (const c of cases) {
    const present = await c.setup().catch(() => false);
    if (!present) {
      verdicts.push({ c, result: 'SKIP', note: '대상 요소 없음 — 화면에 해당 단언 대상 부재' });
      continue;
    }

    const base = await runStatus(c.assertion);               // ① 원본 DOM
    const baseStatus = base?.status;
    const revert = await c.mutate();                         // ② 결함 주입
    const mut = await runStatus(c.assertion);                // ③ 결함 DOM 재검증
    const mutStatus = mut?.status;
    await revert().catch(() => {});                          // ④ 즉시 원복(비파괴)

    let result: Verdict['result'];
    let note: string;
    if (baseStatus !== 'PASS') {
      result = 'SKIP';
      note = `기준선 미통과(${baseStatus}) — 화면 드리프트/요소 변경 의심, 민감도 판정 보류`;
    } else if (mutStatus === 'FAIL') {
      result = 'PASS';
      note = '민감 ✓ — 결함 주입 시 FAIL로 검출(mutant killed)';
    } else {
      result = 'FAIL';
      note = '둔감 — 결함을 주입해도 PASS 유지(가짜 PASS 위험, mutant survived)';
    }
    verdicts.push({ c, baseStatus, mutStatus, result, note });
  }
  return verdicts;
}

// ── 중간 누적분 정리 후 판정만 기록 ──────────────────────────────
export function recordVerdicts(verdicts: Verdict[], TOP: string): void {
  resetResults();
  for (const v of verdicts) {
    const meta: CheckMeta = {
      path: `${TOP} > ${v.c.screen} > ${v.c.kind}`,
      tcRef: v.c.id, tcId: v.c.id,
      desc: `[${v.c.kind}] 결함 주입 → 검출 여부`,
      expected: '결함 주입 시 FAIL(검출)',
      failMsg: '둔감(가짜 PASS 위험)',
    };
    record(meta, v.result, {
      actual: `기준선=${v.baseStatus ?? '-'} / 결함주입후=${v.mutStatus ?? '-'}`,
      error: v.result === 'FAIL' ? '둔감(survived)' : v.result === 'SKIP' ? '판정 보류' : undefined,
      detail: v.note,
    });
  }
}

// ── DOM 헬퍼 ─────────────────────────────────────────────────────

// 현재 화면 라벨(SNB 활성 메뉴 또는 페이지 제목 추정)
export async function currentScreenLabel(admin: Page): Promise<string> {
  const active = await admin.locator('.depth-2 a.active, .depth-2 a.is-active, .depth-2 .active a').first().innerText().catch(() => '');
  if (active.trim()) return active.trim();
  const h = await admin.locator('h2, .page-title, .contents-title').first().innerText().catch(() => '');
  return (h || '현재 화면').trim().slice(0, 24);
}

// 안내문구 후보 요소를 탐색해 data-sens 속성으로 태깅 → 정규화 텍스트 반환
export async function tagInfoText(admin: Page, attr = 'infotext'): Promise<string | null> {
  return await admin.evaluate((tag: string) => {
    const N = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const pri = [...document.querySelectorAll('.info-box-text, [class*="info"], [class*="guide"], [class*="desc"], [class*="notice"]')] as HTMLElement[];
    const all = pri.length ? pri : [...document.querySelectorAll('p, li, span, div')] as HTMLElement[];
    for (const el of all) {
      const t = N(el.innerText || '');
      if (/[가-힣]/.test(t) && t.length >= 15 && t.length <= 200 && el.children.length <= 1) {
        el.setAttribute('data-sens', tag);
        return t;
      }
    }
    return null;
  }, attr);
}

// 가시 컬럼 헤더 1개를 찾아 data-sens-col 태깅 → 텍스트 반환
export async function tagColumnHeader(admin: Page): Promise<string | null> {
  return await admin.evaluate(() => {
    const hdrs = [...document.querySelectorAll('[role="columnheader"], thead th')] as HTMLElement[];
    const visible = hdrs.filter(h => h.offsetParent !== null && (h.innerText || '').trim().length >= 2);
    if (!visible.length) return null;
    const el = visible[Math.floor(visible.length / 2)];   // 중간 컬럼 — 첫/마지막 보다 안정적
    el.setAttribute('data-sens-col', '1');
    return (el.innerText || '').replace(/[▼▲↑↓\s]/g, '').trim() || null;
  });
}

// ── 케이스 팩토리 (화면별 재사용) ────────────────────────────────

/** A: checkText 안내문구 전문 일치 — 변조 시 즉시 FAIL(민감 기대) */
export function caseA(admin: Page, screen: string, TOP: string, ctx: { infoText: string }): SensCase {
  return {
    id: 'SENS-A', screen, kind: 'checkText 안내문구 전문 일치',
    setup: async () => {
      const t = await tagInfoText(admin, 'infotext-a');
      if (!t) return false;
      ctx.infoText = t;
      return true;
    },
    assertion: () => checkText(admin,
      { path: `${TOP} > ${screen} > 안내문구`, tcRef: 'SENS-A', tcId: 'A-run', desc: '안내문구 전문 일치', expected: ctx.infoText, failMsg: 'UI 불일치(안내문구)' },
      admin.locator('[data-sens="infotext-a"]')),
    mutate: async () => {
      await admin.evaluate(() => {
        const el = document.querySelector('[data-sens="infotext-a"]') as HTMLElement;
        (el as any).__origA = el.innerText;
        el.innerText = el.innerText + ' (결함주입)';
      });
      return async () => { await admin.evaluate(() => {
        const el = document.querySelector('[data-sens="infotext-a"]') as HTMLElement;
        if (el && (el as any).__origA != null) el.innerText = (el as any).__origA;
      }); };
    },
  };
}

/** B: 부분 일치 body.includes — 매칭 구간 밖 변조 → survive(둔감 입증) */
export function caseB(admin: Page, screen: string, TOP: string, ctx: { infoText: string }): SensCase {
  const norm = (s: string) => (s || '').replace(/\s+/g, '');
  return {
    id: 'SENS-B', screen, kind: 'check 부분 일치(body.includes) — 매칭 구간 밖 변경',
    setup: async () => !!ctx.infoText && norm(ctx.infoText).length >= 12,
    assertion: () => {
      const sub = norm(ctx.infoText).slice(0, 12);
      return check(admin,
        { path: `${TOP} > ${screen} > 안내문구(부분일치)`, tcRef: 'SENS-B', tcId: 'B-run', desc: '안내문구 부분 일치', failMsg: '부분 문구 미검출' },
        async () => {
          const body = norm(await admin.locator('body').innerText());
          expect(body.includes(sub), `부분문구 "${sub}" 포함`).toBeTruthy();
        });
    },
    mutate: async () => {
      await admin.evaluate(() => {
        const el = document.querySelector('[data-sens="infotext-a"]') as HTMLElement;
        (el as any).__origB = el.innerText;
        el.innerText = el.innerText + ' 잘못된안내문구오류';
      });
      return async () => { await admin.evaluate(() => {
        const el = document.querySelector('[data-sens="infotext-a"]') as HTMLElement;
        if (el && (el as any).__origB != null) el.innerText = (el as any).__origB;
      }); };
    },
  };
}

/** C: 느슨한 count ≥ 1 — 다수 버튼 숨겨도 survive(둔감 입증) */
export function caseC(admin: Page, screen: string, TOP: string): SensCase {
  return {
    id: 'SENS-C', screen, kind: 'check 느슨한 count ≥ 1',
    setup: async () => (await admin.locator('button:visible').count()) >= 2,
    assertion: () => check(admin,
      { path: `${TOP} > ${screen} > 버튼 노출`, tcRef: 'SENS-C', tcId: 'C-run', desc: '버튼 1개 이상 노출', failMsg: '버튼 미노출' },
      async () => { expect(await admin.locator('button:visible').count(), '버튼 ≥ 1').toBeGreaterThanOrEqual(1); }),
    mutate: async () => {
      await admin.evaluate(() => {
        const btns = [...document.querySelectorAll('button')].filter(b => (b as HTMLElement).offsetParent !== null);
        btns.slice(1).forEach(b => { (b as HTMLElement).setAttribute('data-sens-hidden', '1'); (b as HTMLElement).style.display = 'none'; });
      });
      return async () => { await admin.evaluate(() => {
        document.querySelectorAll('[data-sens-hidden="1"]').forEach(b => { (b as HTMLElement).style.removeProperty('display'); b.removeAttribute('data-sens-hidden'); });
      }); };
    },
  };
}

/** D: toBeVisible 존재 단언 — 요소 완전 숨김 시 FAIL(민감 기대) */
export function caseD(admin: Page, screen: string, TOP: string): SensCase {
  return {
    id: 'SENS-D', screen, kind: 'toBeVisible 존재 단언 — 요소 숨김 시 검출',
    setup: async () => (await admin.locator('button:visible').count()) >= 1,
    assertion: () => check(admin,
      { path: `${TOP} > ${screen} > 버튼 존재`, tcRef: 'SENS-D', tcId: 'D-run', desc: '첫 버튼 toBeVisible', failMsg: '버튼 미노출' },
      async () => { await expect(admin.locator('button').first()).toBeVisible(); }),
    mutate: async () => {
      await admin.evaluate(() => {
        const btn = document.querySelector('button') as HTMLElement;
        if (btn) { (btn as any).__origD = btn.style.display; btn.style.display = 'none'; btn.setAttribute('data-sens-d', '1'); }
      });
      return async () => { await admin.evaluate(() => {
        const btn = document.querySelector('[data-sens-d="1"]') as HTMLElement;
        if (btn) { btn.style.display = (btn as any).__origD || ''; btn.removeAttribute('data-sens-d'); }
      }); };
    },
  };
}

/** E: 컬럼 헤더 정확 일치 — 헤더 텍스트 변조 시 FAIL(민감 기대) */
export function caseE(admin: Page, screen: string, TOP: string, ctx: { colHeader: string }): SensCase {
  return {
    id: 'SENS-E', screen, kind: 'getByRole(columnheader) 정확 일치 — 컬럼명 변조 시 검출',
    setup: async () => {
      const t = await tagColumnHeader(admin);
      if (!t) return false;
      ctx.colHeader = t;
      return true;
    },
    assertion: () => check(admin,
      { path: `${TOP} > ${screen} > 컬럼 헤더`, tcRef: 'SENS-E', tcId: 'E-run', desc: `컬럼 헤더 '${ctx.colHeader}' 정확 일치`, failMsg: '컬럼 헤더 미노출/변조' },
      async () => { await expect(admin.getByRole('columnheader', { name: ctx.colHeader, exact: true }).first()).toBeVisible(); }),
    mutate: async () => {
      await admin.evaluate(() => {
        const el = document.querySelector('[data-sens-col="1"]') as HTMLElement;
        if (el) { (el as any).__origE = el.innerText; el.innerText = '##변조된헤더##'; }
      });
      return async () => { await admin.evaluate(() => {
        const el = document.querySelector('[data-sens-col="1"]') as HTMLElement;
        if (el && (el as any).__origE != null) el.innerText = (el as any).__origE;
      }); };
    },
  };
}
