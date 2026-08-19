import { test } from '../lib/fixtures';
import { navigateMenu, settle, extractDom } from '../lib/adminHelpers';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  라운드 관리 > 스코어 출력 설정 — 신규 화면 학습(DOM 정밀 캡처, 비파괴).
//  실행: npm run auth 후 npx playwright test --project=admin-chromium Admin/_probe-score-output.spec.ts --no-deps
//  산출: analysis/라운드관리_스코어_출력_설정.json (extractDom + 설정 폼 스캔)
//  설정 화면 특성(여백/가로세로/번호입력 숨김 등) → 라디오·체크박스·라벨·섹션·미리보기 집중 캡처.
// ──────────────────────────────────────────────────────────────

test('스코어 출력 설정 — 신규 화면 DOM 학습(비파괴)', async ({ admin }) => {
  test.setTimeout(300_000);
  const out: Record<string, unknown> = {};

  // ── 1) 라운드 관리 SNB 하위메뉴 전수(정확 라벨 확인) ──
  out['_SNB_라운드관리'] = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const items = Array.from(document.querySelectorAll('.depth-2-title, .depth-1-title, .snb a, .snb span, [class*="depth"], nav a, aside a'))
      .map((e) => norm((e as HTMLElement).innerText)).filter(Boolean);
    return [...new Set(items)];
  }).catch(() => []);

  // ── 2) 진입(라벨 변형 시도) ──
  let entered = false; let usedLabel = '';
  for (const label of ['스코어 출력 설정', '스코어출력 설정', '스코어 출력설정', '스코어출력설정', '출력 설정', '스코어 출력']) {
    entered = await navigateMenu(admin, '라운드 관리', label).catch(() => false) as boolean;
    if (entered) { usedLabel = label; break; }
  }
  out['_진입'] = { entered, usedLabel };
  await settle(admin, 2500);

  if (!entered) {
    out['_ERROR'] = '진입 실패 — SNB 라벨 확인 필요(_SNB_라운드관리 참고). 세션 만료면 npm run auth.';
    fs.writeFileSync('analysis/라운드관리_스코어_출력_설정.json', JSON.stringify(out, null, 2));
    console.log('[진입 실패] SNB 후보:', JSON.stringify(out['_SNB_라운드관리']));
    return;
  }

  // ── 3) 표준 DOM 추출 ──
  out['extractDom'] = await extractDom(admin).catch(() => null);

  // ── 4) 설정 폼 정밀 스캔(라디오/체크박스/라벨/섹션/미리보기) ──
  out['settings'] = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (el: Element) => (typeof el.className === 'string' ? el.className : '');
    const scope = document.querySelector('.contents, main') || document.body;

    // 섹션(제목 있는 박스) + 내부 구조 힌트
    const sections = Array.from(scope.querySelectorAll('.contents-box, [class*="section"], [class*="card"], [class*="panel"]'))
      .filter(vis)
      .map((b) => ({ title: norm((b.querySelector('h2,h3,h4,.title,[class*="title"]') || {} as Element).textContent || '').slice(0, 60), cls: clsOf(b).slice(0, 80) }))
      .filter((s) => s.title).slice(0, 25);

    // 라디오/체크박스 + 라벨(name 그룹핑)
    const controls = Array.from(scope.querySelectorAll('input[type=radio], input[type=checkbox]'))
      .map((inp) => {
        const id = (inp as HTMLInputElement).id;
        const lab = id ? document.querySelector(`label[for="${id}"]`) : inp.closest('label');
        return { type: inp.getAttribute('type'), name: inp.getAttribute('name') || null, checked: (inp as HTMLInputElement).checked, disabled: (inp as HTMLInputElement).disabled, label: norm(lab ? lab.textContent : '').slice(0, 50), id: id || null };
      }).slice(0, 50);

    // select(옵션 포함) + number/text input
    const fields = Array.from(scope.querySelectorAll('select, input[type=number], input[type=text], input:not([type])'))
      .filter(vis)
      .map((e) => ({ tag: e.tagName, type: e.getAttribute('type'), name: e.getAttribute('name') || null, ph: e.getAttribute('placeholder') || null, value: (e as HTMLInputElement).value || null, opts: e.tagName === 'SELECT' ? Array.from((e as HTMLSelectElement).options).map((o) => o.text).slice(0, 12) : null }))
      .slice(0, 30);

    // 토글 스위치(커스텀)
    const toggles = Array.from(scope.querySelectorAll('[class*="toggle"], [class*="switch"], [id^="tgv-"]'))
      .filter(vis).map((e) => ({ cls: clsOf(e).slice(0, 60), txt: norm((e as HTMLElement).innerText).slice(0, 40) })).slice(0, 20);

    // 폼 라벨 전반
    const labels = [...new Set(Array.from(scope.querySelectorAll('label, .form-label, [class*="label"], dt, th'))
      .filter(vis).map((e) => norm((e as HTMLElement).innerText)).filter((t) => t && t.length < 40))].slice(0, 50);

    // 안내문구
    const info = [...new Set(Array.from(scope.querySelectorAll('[class*="info"], [class*="notice"], [class*="guide"], [class*="desc"], p'))
      .filter(vis).map((e) => norm((e as HTMLElement).innerText)).filter((t) => t && t.length > 12 && t.length < 300))].slice(0, 12);

    // 미리보기/출력 영역(스코어카드 프리뷰 추정)
    const preview = Array.from(scope.querySelectorAll('[class*="preview"], [class*="print"], [class*="scorecard"], [class*="paper"], iframe, canvas'))
      .filter(vis).map((e) => ({ tag: e.tagName, cls: clsOf(e).slice(0, 60) })).slice(0, 10);

    // 버튼(저장/미리보기/인쇄/초기화 등)
    const buttons = [...new Set(Array.from(scope.querySelectorAll('button, a[class*="btn"], [role=button]'))
      .filter(vis).map((e) => norm((e as HTMLElement).innerText)).filter(Boolean))].slice(0, 30);

    return { url: location.pathname, sections, controls, fields, toggles, labels, info, preview, buttons };
  }).catch((e) => ({ ERROR: String(e).slice(0, 200) }));

  fs.writeFileSync('analysis/라운드관리_스코어_출력_설정.json', JSON.stringify(out, null, 2));
  const s = out['settings'] as { url?: string; sections?: unknown[]; controls?: unknown[]; buttons?: string[] } | null;
  console.log(`[진입 OK] label="${usedLabel}" url=${s?.url} · 섹션 ${s?.sections?.length ?? 0} · 컨트롤 ${s?.controls?.length ?? 0} · 버튼 [${(s?.buttons || []).join(', ')}]`);
  console.log('[out] analysis/라운드관리_스코어_출력_설정.json');
});
