import { test } from '../lib/fixtures';
import { navigateMenu, settle, extractDom } from '../lib/adminHelpers';
import * as fs from 'fs';

// ──────────────────────────────────────────────────────────────
//  라운드 관리 > 마커 인증 조회 — 신규 화면 학습(DOM 정밀 캡처, 비파괴).
//  근거: JIRA QA-15254(미번역·구조)·QA-15177(초기화 버튼)·QA-15108(검색제약). 조회(읽기) 화면.
//  실행: npm run auth 후 npx playwright test --project=admin-chromium Admin/_probe-marker-auth.spec.ts --no-deps
//  산출: analysis/라운드관리_마커_인증_조회.json (extractDom + 검색폼/테이블 스캔)
// ──────────────────────────────────────────────────────────────

test('마커 인증 조회 — 신규 화면 DOM 학습(비파괴)', async ({ admin }) => {
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
  for (const label of ['마커 인증 조회', '마커인증 조회', '마커 인증조회', '마커인증조회', '마커 인증']) {
    entered = await navigateMenu(admin, '라운드 관리', label).catch(() => false) as boolean;
    if (entered) { usedLabel = label; break; }
  }
  out['_진입'] = { entered, usedLabel };
  await settle(admin, 2500);

  if (!entered) {
    out['_ERROR'] = '진입 실패 — SNB 라벨 확인 필요(_SNB_라운드관리 참고). 세션 만료면 npm run auth.';
    fs.writeFileSync('analysis/라운드관리_마커_인증_조회.json', JSON.stringify(out, null, 2));
    console.log('[진입 실패] SNB 후보:', JSON.stringify(out['_SNB_라운드관리']));
    return;
  }

  // ── 3) 표준 DOM 추출 ──
  out['extractDom'] = await extractDom(admin).catch(() => null);

  // ── 4) 조회 화면 정밀 스캔(검색폼 / 테이블 헤더 / 안내문구 / 버튼) ──
  out['screen'] = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const clsOf = (el: Element) => (typeof el.className === 'string' ? el.className : '');
    const scope = document.querySelector('.contents, main') || document.body;

    // 섹션(제목 있는 박스)
    const sections = Array.from(scope.querySelectorAll('.contents-box, .sub-title-box, [class*="section"]'))
      .filter(vis)
      .map((b) => ({ title: norm((b.querySelector('h2,h3,h4,.title,[class*="title"]') || {} as Element).textContent || '').slice(0, 60), cls: clsOf(b).slice(0, 80) }))
      .filter((s) => s.title).slice(0, 25);

    // 검색폼 필드(datepicker / text input / placeholder)
    const fields = Array.from(scope.querySelectorAll('input, select, .datepicker-input, .vs__selected'))
      .filter(vis)
      .map((e) => ({ tag: e.tagName, type: e.getAttribute('type'), name: e.getAttribute('name') || null, ph: e.getAttribute('placeholder') || null, maxlength: e.getAttribute('maxlength') || null, value: (e as HTMLInputElement).value || null, cls: clsOf(e).slice(0, 50) }))
      .slice(0, 30);

    // 테이블 헤더(컬럼명) + 테이블 제목
    const tableTitle = norm((scope.querySelector('.list-table-group .sub-title-box, .table-overflow-item .title, [class*="table"] [class*="title"]') || {} as Element).textContent || '').slice(0, 40);
    const headers = [...new Set(Array.from(scope.querySelectorAll('table th, [role="columnheader"]'))
      .filter(vis).map((e) => norm((e as HTMLElement).innerText)).filter(Boolean))].slice(0, 30);
    const rowCount = scope.querySelectorAll('table tbody tr').length;
    const firstRow = norm((scope.querySelector('table tbody tr') as HTMLElement | null)?.innerText || '').slice(0, 200);

    // 버튼(조회/초기화/내보내기 등)
    const buttons = [...new Set(Array.from(scope.querySelectorAll('button, a[class*="btn"], [role=button]'))
      .filter(vis).map((e) => norm((e as HTMLElement).innerText)).filter(Boolean))].slice(0, 30);

    // 안내문구
    const info = [...new Set(Array.from(scope.querySelectorAll('.info-box-text, [class*="info"], [class*="notice"], [class*="guide"], p'))
      .filter(vis).map((e) => norm((e as HTMLElement).innerText)).filter((t) => t && t.length > 8 && t.length < 300))].slice(0, 12);

    // 빈 상태 안내
    const emptyState = norm((scope.querySelector('.empty, [class*="empty"], [class*="no-data"]') as HTMLElement | null)?.innerText || '').slice(0, 100);

    return { url: location.pathname, sections, fields, tableTitle, headers, rowCount, firstRow, buttons, info, emptyState };
  }).catch((e) => ({ ERROR: String(e).slice(0, 200) }));

  fs.writeFileSync('analysis/라운드관리_마커_인증_조회.json', JSON.stringify(out, null, 2));
  const s = out['screen'] as { url?: string; tableTitle?: string; headers?: string[]; buttons?: string[]; fields?: unknown[]; rowCount?: number } | null;
  console.log(`[진입 OK] label="${usedLabel}" url=${s?.url} · 테이블="${s?.tableTitle}" 컬럼[${(s?.headers || []).join(', ')}] · 행 ${s?.rowCount ?? 0} · 버튼[${(s?.buttons || []).join(', ')}]`);
  console.log('[out] analysis/라운드관리_마커_인증_조회.json');
});
