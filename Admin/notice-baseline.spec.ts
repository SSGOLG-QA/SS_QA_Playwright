import { test } from '../lib/fixtures';
import { navigateMenu, settle, SUBDOMAIN } from '../lib/adminHelpers';
import { resetResults, resetNoTC, resetDiff, record, skip, diff, writeReport } from '../lib/reporter';
import { MENU_LIST } from '../lib/langCheck';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  안내문구 전문(full-text) baseline 대조 — L2 전문일치 체계화 [P3]
//  실행: npm run auth 후
//    최초/갱신: NOTICE_BASELINE=capture npx playwright test --project=admin-chromium Admin/notice-baseline.spec.ts --no-deps
//    대조(검출): npx playwright test --project=admin-chromium Admin/notice-baseline.spec.ts --no-deps
//  배경: 2026-06 배치 17종이 안내문구 '부분일치'(부분 문자열)로 검증됨 → 표준 L2는 '전문일치'.
//    화면별 수동 원문 편집 대신, 전 화면 `.info-box-text` 전문을 committed baseline으로 캡처하고
//    라이브 전문 대조 → **1자만 바뀌어도 회귀 감지**(구조 드리프트 L11의 문구 판).
//  판정: 일치=PASS · 변경=FAIL(문구 회귀) · 신규 화면=diff(baseline 편입 필요) · 소실(있던 문구 사라짐)=FAIL.
//  ⚠ 비파괴(조회/스캔만). 단일 test 1회 로그인 전 화면 순회.
// ──────────────────────────────────────────────────────────────

const BASELINE = path.join('baselines', `notice-text.${SUBDOMAIN}.json`);
const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();

test('안내문구 전문 baseline 대조 (L2)', async ({ admin }) => {
  test.setTimeout(20 * 60_000);
  resetResults(); resetNoTC(); resetDiff();

  const capture = /^capture$/i.test(process.env.NOTICE_BASELINE || '');
  const prior: Record<string, string> = (!capture && fs.existsSync(BASELINE))
    ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  const baselineExists = fs.existsSync(BASELINE);
  const live: Record<string, string> = {};

  for (const { menu, subs } of MENU_LIST) {
    for (const sub of subs) {
      const P = `안내문구 baseline > ${menu} > ${sub}`;
      const key = `${menu} > ${sub}`;
      const ok = await navigateMenu(admin, menu, sub).catch(() => false) as boolean;
      if (!ok) { skip({ path: P, tcRef: 'NOTICE', tcId: key, desc: '진입' }, '진입 실패(미구현/SNB 부재/네비 실패)'); continue; }
      await settle(admin, 1000);
      // 안내문구 전문(여러 .info-box-text 결합)
      const text = await admin.evaluate(() => {
        const els = Array.from(document.querySelectorAll('.info-box-text'));
        return els.map((e) => (e as HTMLElement).innerText || '').join(' ⏎ ');
      }).catch(() => '');
      const t = norm(text);
      if (!t) { skip({ path: P, tcRef: 'NOTICE', tcId: key, desc: '안내문구' }, '안내문구(.info-box-text) 없음(해당 화면 미보유)'); continue; }
      live[key] = t;

      if (capture || !baselineExists) continue;   // 캡처 모드는 대조 생략

      const base = prior[key];
      if (base == null) {
        diff(P, '안내문구 신규(baseline 미등록)', `LIVE "${t.slice(0, 80)}${t.length > 80 ? '…' : ''}"`, `NOTICE_${key}`, 'baseline 편입 필요 — NOTICE_BASELINE=capture 재실행');
        skip({ path: P, tcRef: 'NOTICE', tcId: key, desc: '안내문구 전문 대조' }, 'baseline 미등록(신규 화면)');
      } else if (base === t) {
        record({ path: P, tcRef: 'NOTICE', tcId: key, desc: '안내문구 전문 일치', expected: base.slice(0, 60), failMsg: '문구 변경' }, 'PASS', { actual: '전문 일치' });
      } else {
        // 최초 상이 지점 표기
        let i = 0; while (i < base.length && i < t.length && base[i] === t[i]) i++;
        record({ path: P, tcRef: 'NOTICE', tcId: key, desc: '안내문구 전문 일치', expected: base.slice(0, 80), failMsg: '문구 변경(전문 불일치)' }, 'FAIL',
          { error: '안내문구 전문 변경', detail: `@${i}자: base"…${base.slice(Math.max(0, i - 10), i + 20)}…" ≠ live"…${t.slice(Math.max(0, i - 10), i + 20)}…"` });
      }
    }
  }

  // 소실 감지(baseline엔 있으나 live에 없어진 문구) — 대조 모드만
  if (!capture && baselineExists) {
    for (const key of Object.keys(prior)) {
      if (!(key in live)) {
        record({ path: `안내문구 baseline > ${key}`, tcRef: 'NOTICE', tcId: `${key}#lost`, desc: '안내문구 소실 감지', expected: prior[key].slice(0, 60), failMsg: '안내문구 소실' }, 'FAIL',
          { error: '안내문구 소실(진입 실패 아님이면 회귀)', detail: `baseline "${prior[key].slice(0, 60)}…" — live 미검출` });
      }
    }
  }

  if (capture || !baselineExists) {
    if (!fs.existsSync('baselines')) fs.mkdirSync('baselines', { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(live, null, 2));
    console.log(`[notice baseline] ${capture ? '갱신' : '최초 생성'}: ${BASELINE} — ${Object.keys(live).length}화면 캡처`);
  } else {
    console.log(`[notice baseline] 대조 완료 — ${Object.keys(live).length}화면 (baseline ${Object.keys(prior).length}화면)`);
  }

  await writeReport('notice-baseline');
});
