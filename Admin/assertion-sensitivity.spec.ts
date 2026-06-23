import { test } from '../lib/fixtures';
import { expect, Page } from '@playwright/test';
import {
  gotoMenu, check, checkText, record, skip,
  getResults, resetResults, resetNoTC, resetDiff, writeReport,
  CheckMeta, TCResult,
} from '../lib/reporter';
import { settle } from '../lib/adminHelpers';

// ──────────────────────────────────────────────────────────────────────────
//  단언 민감도(Assertion Sensitivity) = "E2E용 뮤테이션 테스트" PoC
//
//  목적: 각 검증(check/checkText/…)이 *falsifiable* 한가 —
//        제품 결함을 시뮬레이션(DOM 결함 주입)했을 때 FAIL로 뒤집히는가(=mutant kill).
//        뒤집히지 않으면(=survive) "가짜 PASS(vacuous pass)" 위험 단언으로 플래그.
//
//  왜 이 방식인가: SUT는 원격 SPA(td17)라 제품 소스를 변형(Stryker)할 수 없음.
//        대신 *테스트가 관찰하는 대상(DOM)* 을 변형해, 동일한 reporter 단언이
//        결함을 잡는지 검증한다. (전통 뮤테이션 테스트 적용불가 → 맞춤형 대체)
//
//  비파괴 보장:
//    - 변형은 in-page DOM(page.evaluate)에만 적용. 서버 저장/네트워크 쓰기 없음.
//    - 케이스마다 mutate()가 revert 함수를 반환 → 측정 직후 원복.
//    - ALLOW_DESTRUCTIVE 불필요(서버 상태 불변). 읽기 전용 세션만 사용.
//
//  실행:
//    npx playwright test --project=admin-chromium Admin/assertion-sensitivity.spec.ts --no-deps
//  산출: reports/단언민감도_PoC_report_*.xlsx
// ──────────────────────────────────────────────────────────────────────────

const TOP = '단언민감도 PoC';           // 리포트 대메뉴(탭)명
const norm = (s: string) => (s || '').replace(/\s+/g, '');

// 동일 단언 fn 1회 실행 → 직후 push된 TCResult 1건 반환(상태만 사용).
async function runStatus(fn: () => Promise<void>): Promise<TCResult | undefined> {
  const i = getResults().length;
  await fn();
  return getResults()[i];
}

// 변형(mutate)은 in-page만, revert 함수 반환. 측정 = baseline(원본) vs mutated(결함주입).
type SensCase = {
  id: string;
  screen: string;
  kind: string;                                   // 단언 유형(설명)
  setup: () => Promise<boolean>;                  // 대상 요소 준비. false=대상없음 → SKIP
  assertion: () => Promise<void>;                 // reporter 단언(check/checkText/…)
  mutate: () => Promise<() => Promise<void>>;     // 결함 주입 → revert 반환
};

type Verdict = {
  c: SensCase;
  baseStatus?: string;
  mutStatus?: string;
  result: 'PASS' | 'FAIL' | 'SKIP';
  note: string;
};

test('단언 민감도(E2E 뮤테이션) PoC — 결함 주입 시 검출 여부', async ({ admin }) => {
  test.setTimeout(240_000);
  resetResults(); resetNoTC(); resetDiff();

  // 대상 화면: 안내문구·버튼·테이블이 있는 안정 화면(없으면 진입한 현재 화면에서 self-locate).
  await gotoMenu(admin, '관제 관리', '라이브채팅 공지 조회', {
    path: `${TOP} > 라이브채팅 공지 조회`, tcRef: '-', tcId: '진입',
    desc: '대상 화면 진입(실패 시 현재 화면에서 진행)', failMsg: '메뉴 진입 불가',
  }).catch(() => {});
  await settle(admin);
  const screen = (await currentScreenLabel(admin));

  // 변형 대상 식별용 상태(setup이 채움)
  let infoText = '';

  const cases: SensCase[] = [
    // ── A. 안내문구 전문 일치(checkText) — 민감해야 정상 ──────────────────
    //   결함 주입: 안내문구 텍스트를 변경 → 전문일치라 즉시 FAIL(kill) 기대.
    {
      id: 'SENS-A', screen, kind: 'checkText 안내문구 전문 일치',
      setup: async () => {
        const t = await tagInfoText(admin);
        if (!t) return false;
        infoText = t;
        return true;
      },
      assertion: () => checkText(admin,
        { path: `${TOP} > ${screen} > 안내문구`, tcRef: '-', tcId: 'A-run', desc: '안내문구 전문 일치', expected: infoText, failMsg: 'UI 불일치(안내문구)' },
        admin.locator('[data-sens="infotext"]')),
      mutate: async () => {
        await admin.evaluate(() => {
          const el = document.querySelector('[data-sens="infotext"]') as HTMLElement;
          (el as any).__orig = el.innerText;
          el.innerText = el.innerText + ' (결함주입)';
        });
        return async () => { await admin.evaluate(() => {
          const el = document.querySelector('[data-sens="infotext"]') as HTMLElement;
          if (el && (el as any).__orig != null) el.innerText = (el as any).__orig;
        }); };
      },
    },

    // ── B. 부분 일치 단언(body.includes) — 둔감 위험 입증 ────────────────
    //   17개 화면이 쓰는 '안내문구 부분 일치' 패턴 모사. 결함을 매칭 구간 *밖*에
    //   주입(문장 끝에 오류문구 추가) → 부분일치는 못 잡고 survive → '둔감' 플래그.
    {
      id: 'SENS-B', screen, kind: 'check 부분 일치(body.includes) — 매칭 구간 밖 변경',
      setup: async () => !!infoText && norm(infoText).length >= 12,
      assertion: () => {
        const sub = norm(infoText).slice(0, 12);
        return check(admin,
          { path: `${TOP} > ${screen} > 안내문구(부분일치)`, tcRef: '-', tcId: 'B-run', desc: '안내문구 부분 일치', failMsg: '부분 문구 미검출' },
          async () => {
            const body = norm(await admin.locator('body').innerText());
            expect(body.includes(sub), `부분문구 "${sub}" 포함`).toBeTruthy();
          });
      },
      mutate: async () => {
        await admin.evaluate(() => {
          const el = document.querySelector('[data-sens="infotext"]') as HTMLElement;
          (el as any).__origB = el.innerText;
          el.innerText = el.innerText + ' 잘못된안내문구오류';   // 끝에 추가 = 부분일치 구간 밖
        });
        return async () => { await admin.evaluate(() => {
          const el = document.querySelector('[data-sens="infotext"]') as HTMLElement;
          if (el && (el as any).__origB != null) el.innerText = (el as any).__origB;
        }); };
      },
    },

    // ── C. 느슨한 count ≥ 1(데이터 의존 완화 컨벤션) — 둔감 위험 입증 ──────
    //   결함 주입: 버튼 N개 중 1개만 남기고 숨김 → ≥1은 여전히 참 → survive → 플래그.
    //   '≥1/≥2' 완화 검증이 다수 요소 소실(실제 결함)을 못 잡음을 입증.
    {
      id: 'SENS-C', screen, kind: 'check 느슨한 count ≥ 1',
      setup: async () => (await admin.locator('button:visible').count()) >= 2,
      assertion: () => check(admin,
        { path: `${TOP} > ${screen} > 버튼 노출`, tcRef: '-', tcId: 'C-run', desc: '버튼 1개 이상 노출', failMsg: '버튼 미노출' },
        async () => {
          const c = await admin.locator('button:visible').count();
          expect(c, '버튼 ≥ 1').toBeGreaterThanOrEqual(1);
        }),
      mutate: async () => {
        await admin.evaluate(() => {
          const btns = [...document.querySelectorAll('button')].filter(b => (b as HTMLElement).offsetParent !== null);
          btns.slice(1).forEach(b => { (b as HTMLElement).setAttribute('data-sens-hidden', '1'); (b as HTMLElement).style.display = 'none'; });
        });
        return async () => { await admin.evaluate(() => {
          document.querySelectorAll('[data-sens-hidden="1"]').forEach(b => { (b as HTMLElement).style.removeProperty('display'); b.removeAttribute('data-sens-hidden'); });
        }); };
      },
    },
  ];

  const verdicts: Verdict[] = [];
  for (const c of cases) {
    const present = await c.setup().catch(() => false);
    if (!present) { verdicts.push({ c, result: 'SKIP', note: '대상 요소 없음 — 화면에 해당 단언 대상 부재' }); continue; }

    const base = await runStatus(c.assertion);                 // ① 원본 DOM
    const baseStatus = base?.status;
    const revert = await c.mutate();                           // ② 결함 주입
    const mut = await runStatus(c.assertion);                  // ③ 결함 DOM 재검증
    const mutStatus = mut?.status;
    await revert().catch(() => {});                            // ④ 즉시 원복(비파괴)

    let result: Verdict['result']; let note: string;
    if (baseStatus !== 'PASS') {
      result = 'SKIP';
      note = `기준선 미통과(${baseStatus}) — 화면 드리프트/요소 변경 의심, 민감도 판정 보류`;
    } else if (mutStatus === 'FAIL') {
      result = 'PASS';
      note = '민감 ✓ — 결함 주입 시 FAIL로 검출(mutant killed)';
    } else {
      result = 'FAIL';
      note = '🔴 둔감 — 결함을 주입해도 PASS 유지(가짜 PASS 위험, mutant survived)';
    }
    verdicts.push({ c, baseStatus, mutStatus, result, note });
  }

  // 중간 단언(base/mut) 누적분 정리 후, 케이스별 판정만 기록.
  resetResults();
  for (const v of verdicts) {
    const meta: CheckMeta = {
      path: `${TOP} > ${v.c.screen} > ${v.c.kind}`,
      tcRef: v.c.id, tcId: v.c.id, desc: `[${v.c.kind}] 결함 주입 → 검출 여부`,
      expected: '결함 주입 시 FAIL(검출)',
      failMsg: '둔감(가짜 PASS 위험)',
    };
    record(meta, v.result, {
      actual: `기준선=${v.baseStatus ?? '-'} / 결함주입후=${v.mutStatus ?? '-'}`,
      error: v.result === 'FAIL' ? '둔감(survived)' : v.result === 'SKIP' ? '판정 보류' : undefined,
      detail: v.note,
    });
  }
  console.log(`\n[단언민감도] 민감 ${verdicts.filter(v => v.result === 'PASS').length} / 둔감 ${verdicts.filter(v => v.result === 'FAIL').length} / 보류 ${verdicts.filter(v => v.result === 'SKIP').length}`);

  if (process.env.KEEP_OPEN) await admin.pause();
});

test.afterAll(async () => { await writeReport('단언민감도_PoC'); });

// ── helpers ────────────────────────────────────────────────────────────────

// 현재 화면 라벨(SNB 활성 메뉴 또는 페이지 제목 추정)
async function currentScreenLabel(admin: Page): Promise<string> {
  const active = await admin.locator('.depth-2 a.active, .depth-2 a.is-active, .depth-2 .active a').first().innerText().catch(() => '');
  if (active.trim()) return active.trim();
  const h = await admin.locator('h2, .page-title, .contents-title').first().innerText().catch(() => '');
  return (h || '현재 화면').trim().slice(0, 24);
}

// 안내문구 후보(한글·적당 길이·리프성) 1건을 찾아 data-sens 태깅 → 정규화 텍스트 반환.
async function tagInfoText(admin: Page): Promise<string | null> {
  return await admin.evaluate(() => {
    const N = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const pri = [...document.querySelectorAll('.info-box-text, [class*="info"] , [class*="guide"], [class*="desc"], [class*="notice"]')] as HTMLElement[];
    const all = pri.length ? pri : [...document.querySelectorAll('p, li, span, div')] as HTMLElement[];
    for (const el of all) {
      const t = N(el.innerText || '');
      if (/[가-힣]/.test(t) && t.length >= 15 && t.length <= 200 && el.children.length <= 1) {
        el.setAttribute('data-sens', 'infotext');
        return t;
      }
    }
    return null;
  });
}
