import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  정보 관리 > 코스 기본 정보 — 신규 심화 대상 DOM 정밀 프로브(진단 전용, 비파괴).
//  실행: npm run course:auth 후 npm run course:info-basic-probe
//  목적: 기존 커버리지(합계 정합·제네릭 수정진입)에 없는 2플로우의 실제 DOM 확정 —
//    ① 공사 관련 사진 썸네일 → [등록된 사진] 팝업(이미지 + 등록 날짜/시간 + [확인]) 구조
//    ② [수정] 편집화면 전 구성요소(공사 기간 필터·공사 업체 정보·공사 관련 사진 수정/추가·
//       코스 공사 비용·시설 공사 비용) 필드 배치
//  산출: analysis/코스관리_코스기본정보.json (콘솔 요약 포함)
//  ⚠ 비파괴: 팝업은 열람→[확인]/Escape, 수정은 진입→취소(저장 절대 안 함). 파일 다이얼로그 트리거 금지.
// ──────────────────────────────────────────────────────────────

const P = '정보 관리 > 코스 기본 정보';
const M = (p: Page) => p.locator('.contents, main').first();

// 편집화면에서 찾을 구성요소 라벨(사용자 요청 기준)
const EDIT_LABELS = ['공사 기간', '공사 업체', '공사 관련 사진', '코스 공사 비용', '시설 공사 비용'];

interface ProbeOut {
  ts: string;
  entered: boolean;
  alive: boolean;
  // 메인(뷰) 화면
  viewButtons: string[];
  viewLabels: string[];
  photoThumbs: { count: number; sample: unknown[] };
  // 등록된 사진 팝업
  photoPopup: { opened: boolean; title: string; hasImg: boolean; imgSrc: string; timestampText: string; timestampMatched: boolean; buttons: string[]; outerHTMLHead: string } | null;
  // 수정(편집) 화면
  editScreen: { entered: boolean; mode: string; buttons: string[]; inputs: number; textareas: number; selects: number; datepickers: number; fileInputs: number; labelHits: Record<string, unknown> } | null;
  notes: string[];
}

test('정보 관리 > 코스 기본 정보 — 사진팝업/수정화면 DOM 정밀 프로브(진단)', async ({ page, context }) => {
  test.setTimeout(400_000);
  const admin = await openCourseAdmin(page, context);
  const out: ProbeOut = {
    ts: new Date().toISOString().slice(0, 19).replace('T', ' '),
    entered: false, alive: false, viewButtons: [], viewLabels: [], photoThumbs: { count: 0, sample: [] },
    photoPopup: null, editScreen: null, notes: [],
  };

  const finish = async () => {
    if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
    fs.writeFileSync(path.join('analysis', '코스관리_코스기본정보.json'), JSON.stringify(out, null, 2));
    console.log('\n══ 코스 기본 정보 프로브 요약 ══');
    console.log(`진입 ${out.entered} · alive ${out.alive} · 썸네일 ${out.photoThumbs.count} · 팝업 ${out.photoPopup?.opened ?? false}(ts매칭 ${out.photoPopup?.timestampMatched ?? '-'}) · 수정진입 ${out.editScreen?.entered ?? false}`);
    if (out.editScreen) console.log(`  수정화면: 버튼[${out.editScreen.buttons.join(', ')}] · input ${out.editScreen.inputs}·textarea ${out.editScreen.textareas}·select ${out.editScreen.selects}·datepicker ${out.editScreen.datepickers}·file ${out.editScreen.fileInputs}`);
    if (out.editScreen) for (const l of EDIT_LABELS) console.log(`  라벨 "${l}": ${JSON.stringify((out.editScreen.labelHits || {})[l])}`);
    for (const n of out.notes) console.log(`  [note] ${n}`);
    console.log('[out] analysis/코스관리_코스기본정보.json');
  };

  // ── 진입 ──
  if (!(await gotoCourseMenu(admin, '정보 관리', '코스 기본 정보').then(() => true).catch(() => false))) {
    out.notes.push('진입 실패(세션 만료 추정) — npm run course:auth 후 재실행'); await finish(); return;
  }
  out.entered = true;
  await admin.waitForTimeout(1_500); await killAlarms(admin);

  // ── 세션 생존/렌더 확인 ──
  const alive = await M(admin).evaluate((sc) => {
    const txt = (sc as HTMLElement).innerText || '';
    return { hasCourseInfo: /공사|코스|합계/.test(txt), imgs: sc.querySelectorAll('img').length };
  }).catch(() => ({ hasCourseInfo: false, imgs: 0 }));
  out.alive = alive.hasCourseInfo;
  if (!alive.hasCourseInfo) { out.notes.push(`⚠ 세션 만료/빈 렌더 추정(공사/코스/합계 텍스트 없음·img ${alive.imgs}). course:auth 후 재실행.`); await finish(); return; }

  // ── 1) 메인(뷰) 화면 스캔: 버튼·라벨·사진 썸네일 ──
  const view = await M(admin).evaluate((sc) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const btns = [...new Set(Array.from(sc.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 30);
    const labels = [...new Set(Array.from(sc.querySelectorAll('th, .form-label, [class*="label"], dt, td:first-child'))
      .map((e) => norm((e as HTMLElement).innerText)).filter((t) => t && t.length < 30))].slice(0, 40);
    // 사진 썸네일: 클릭 가능한 img(공사 관련 사진 영역). data URL/작은 아이콘 포함 전수
    const imgs = Array.from(sc.querySelectorAll('img'));
    const sample = imgs.slice(0, 12).map((im, i) => {
      const r = im.getBoundingClientRect();
      const cur = getComputedStyle(im).cursor;
      // 인접 텍스트(썸네일 라벨 추정): 조상 3단 내 날짜형 텍스트
      let label = '';
      let el: Element | null = im;
      for (let k = 0; k < 4 && el; k++) { const m = norm(el.textContent).match(/\d{4}-\d{2}-\d{2}[^\n]{0,6}/); if (m) { label = m[0]; break; } el = el.parentElement; }
      return { i, w: Math.round(r.width), h: Math.round(r.height), cursor: cur, clickable: cur === 'pointer' || im.closest('a,button,[class*="cursor"]') != null, label, srcHead: (im.getAttribute('src') || '').slice(0, 40) };
    });
    return { btns, labels, imgCount: imgs.length, sample };
  }).catch(() => ({ btns: [] as string[], labels: [] as string[], imgCount: 0, sample: [] as unknown[] }));
  out.viewButtons = view.btns; out.viewLabels = view.labels;
  out.photoThumbs = { count: view.imgCount, sample: view.sample };

  // ── 2) [등록된 사진] 팝업 오픈 시도: 클릭 가능한 썸네일 순회 ──
  const thumbs = M(admin).locator('img');
  const tN = await thumbs.count().catch(() => 0);
  for (let i = 0; i < Math.min(tN, 10); i++) {
    await thumbs.nth(i).click({ timeout: 2_000, force: true }).catch(() => {});
    await admin.waitForTimeout(800);
    const cap = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => vis(mo) && /등록된\s*사진|등록\s*사진/.test(mo.textContent || ''));
      const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
      if (!md) return null;
      const img = md.querySelector('img') as HTMLImageElement | null;
      const t = norm(md.textContent);
      const tsMatch = t.match(/\(?\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?\)?/);
      const btns = Array.from(md.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean);
      const title = norm((md.querySelector('h1,h2,h3,h4,.title,[class*="title"]') || {} as Element).textContent || '').slice(0, 40);
      return { opened: true, title, hasImg: !!img && vis(img), imgSrc: (img?.getAttribute('src') || '').slice(0, 60), timestampText: tsMatch ? tsMatch[0] : '', timestampMatched: !!tsMatch, buttons: btns, outerHTMLHead: md.outerHTML.replace(/\s+/g, ' ').slice(0, 800) };
    }).catch(() => null);
    if (cap) {
      out.photoPopup = cap;
      // 닫기(비파괴): [확인] → Escape
      await admin.evaluate(() => {
        const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
        const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => vis(mo) && /등록된\s*사진|등록\s*사진/.test(mo.textContent || ''));
        const md = mods[0]; if (!md) return; const ok = Array.from(md.querySelectorAll('button')).find((b) => /^\s*확인\s*$/.test(b.textContent || '')); if (ok) (ok as HTMLElement).click();
      }).catch(() => {});
      await admin.keyboard.press('Escape').catch(() => {});
      await admin.waitForTimeout(400); await killAlarms(admin);
      break;
    }
  }
  if (!out.photoPopup) out.notes.push('등록된 사진 팝업 미검출(썸네일 클릭 무반응/데이터 없음/셀렉터 상이) — sample.clickable 참고');

  // ── 3) [수정] 편집화면 진입 → 구성요소 스캔 → 취소(비파괴) ──
  const editBtn = M(admin).getByRole('button', { name: /^\s*수정\s*$/ }).first();
  if (await editBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const beforeUrl = admin.url();
    await editBtn.click({ timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_200); await killAlarms(admin);
    const es = await admin.evaluate((labels) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const modal = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => vis(mo) && !/alarm/.test((mo as HTMLElement).className)).sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
      const scope = (modal || document.querySelector('.contents, main') || document.body) as HTMLElement;
      const mode = modal ? '모달' : '인페이지';
      const btns = [...new Set(Array.from(scope.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean))].slice(0, 30);
      const inputs = scope.querySelectorAll('input:not([type=file]):not([type=hidden])').length;
      const textareas = scope.querySelectorAll('textarea').length;
      const selects = scope.querySelectorAll('select, .vs__dropdown-toggle').length;
      const datepickers = scope.querySelectorAll('.datepicker-input, [class*="datepicker"]').length;
      const fileInputs = scope.querySelectorAll('input[type=file]').length;
      // 라벨별: 텍스트 존재 + 인접 입력요소 유무
      const labelHits: Record<string, unknown> = {};
      const all = Array.from(scope.querySelectorAll('*'));
      for (const lb of labels) {
        const holder = all.find((e) => norm(e.textContent) && norm(e.textContent).includes(lb) && !Array.from(e.children).some((c) => (c.textContent || '').includes(lb)));
        if (!holder) { labelHits[lb] = { present: false }; continue; }
        // 인접 필드: 라벨의 조상 행/섹션 내 input/textarea/select/datepicker/사진영역
        let row: Element | null = holder; for (let k = 0; k < 4 && row; k++) { if (row.querySelector && (row.querySelector('input, textarea, select, .datepicker-input, .vs__dropdown-toggle, input[type=file], [class*="upload"], img')) ) break; row = row.parentElement; }
        const field = row ? row.querySelector('input, textarea, select, .datepicker-input, .vs__dropdown-toggle') : null;
        const hasPhoto = row ? !!row.querySelector('input[type=file], [class*="upload"], img, [class*="photo"]') : false;
        labelHits[lb] = { present: true, hasField: !!field, fieldTag: field ? (field.tagName.toLowerCase() + (field.getAttribute('type') ? `[${field.getAttribute('type')}]` : '')) : null, hasPhoto, rowText: row ? norm((row as HTMLElement).innerText).slice(0, 60) : '' };
      }
      return { entered: true, mode, buttons: btns, inputs, textareas, selects, datepickers, fileInputs, labelHits, urlChanged: false };
    }, EDIT_LABELS).catch(() => null);
    if (es) { es.urlChanged = admin.url() !== beforeUrl; out.editScreen = es; }
    else out.notes.push('수정화면 스캔 실패(evaluate 예외)');

    // 취소(비파괴): [취소] → Escape (저장 절대 안 함)
    await admin.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const scope = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => vis(mo)).sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined || document.querySelector('.contents, main');
      const c = scope ? Array.from(scope.querySelectorAll('button')).find((b) => /^\s*취소\s*$/.test(b.textContent || '')) : null; if (c) (c as HTMLElement).click();
    }).catch(() => {});
    await admin.keyboard.press('Escape').catch(() => {});
    await admin.waitForTimeout(500); await killAlarms(admin);
  } else {
    out.notes.push('[수정] 버튼 미노출 — viewButtons 참고(수정 진입점 상이/권한)');
  }

  await killAlarms(admin);
  await finish();
});
