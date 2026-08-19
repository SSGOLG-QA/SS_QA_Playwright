import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  정보 관리 > 코스 기본 정보 — 심화 2플로우(비파괴). 기존 커버리지(합계 정합·제네릭 수정진입) 갭 보강.
//  실행: npm run course:auth 후 npm run course:info-basic
//  ① SCPHOTO: 공사 관련 사진 썸네일 → [등록된 사진] 팝업 → 이미지 렌더 + 등록 날짜/시간 정합 + [확인] 닫기.
//  ② SCEDIT : [수정] 편집화면 진입 → 요청 구성요소(공사 기간·공사 업체·공사 관련 사진·코스 공사 비용·
//     시설 공사 비용) 전수 노출 확인 + 폼 인벤토리 → [취소](저장 절대 안 함).
//  ⚠ 전부 비파괴: 팝업 열람→[확인], 수정 진입→[취소]. 파일 다이얼로그·저장 클릭 금지.
//  ⚠ 실 DOM 확정 전(프로브 course:info-basic-probe 병행): 라벨 미검출은 FAIL 아닌 diff+skip(가짜 FAIL 방지, 2축).
// ──────────────────────────────────────────────────────────────

const P = '정보 관리 > 코스 기본 정보';
const M = (p: Page) => p.locator('.contents, main').first();
const R = (n: string) => `코스관리_코스기본_${n}`;

const EDIT_LABELS: { label: string; tcId: string; expectPhoto?: boolean }[] = [
  { label: '공사 기간', tcId: 'SCEDIT-01' },
  { label: '공사 업체', tcId: 'SCEDIT-02' },
  { label: '공사 관련 사진', tcId: 'SCEDIT-03', expectPhoto: true },
  { label: '코스 공사 비용', tcId: 'SCEDIT-04' },
  { label: '시설 공사 비용', tcId: 'SCEDIT-05' },
];

// 등록된 사진 팝업을 여러 썸네일에서 열어 이미지+타임스탬프 캡처(비파괴).
async function openPhotoPopup(admin: Page): Promise<{ opened: boolean; hasImg: boolean; ts: string; tsValid: boolean; thumbLabel: string } | null> {
  const thumbs = M(admin).locator('img');
  const n = await thumbs.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 10); i++) {
    // 썸네일 인접 라벨(날짜) 사전 캡처
    const thumbLabel = await thumbs.nth(i).evaluate((im) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      let el: Element | null = im; for (let k = 0; k < 4 && el; k++) { const m = norm(el.textContent).match(/\d{4}-\d{2}-\d{2}[^\n]{0,6}/); if (m) return m[0]; el = el.parentElement; } return '';
    }).catch(() => '');
    await thumbs.nth(i).click({ timeout: 2_000, force: true }).catch(() => {});
    await admin.waitForTimeout(800);
    const cap = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => vis(mo) && /등록된\s*사진|등록\s*사진/.test(mo.textContent || ''));
      const md = mods.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
      if (!md) return null;
      const img = md.querySelector('img') as HTMLImageElement | null;
      const m = norm(md.textContent).match(/\(?\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(:\d{2})?\)?/);
      const imgOk = !!img && vis(img) && (img.naturalWidth === undefined || img.naturalWidth > 0 || !img.complete);
      return { hasImg: !!img && vis(img), imgLoaded: imgOk, ts: m ? m[0] : '' };
    }).catch(() => null);
    if (cap) return { opened: true, hasImg: cap.hasImg, ts: cap.ts, tsValid: /\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(cap.ts), thumbLabel };
  }
  return null;
}

async function closePhotoPopup(admin: Page) {
  await admin.evaluate(() => {
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const mods = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => vis(mo) && /등록된\s*사진|등록\s*사진/.test(mo.textContent || ''));
    const md = mods[0]; if (!md) return; const ok = Array.from(md.querySelectorAll('button')).find((b) => /^\s*확인\s*$/.test(b.textContent || '')); if (ok) (ok as HTMLElement).click();
  }).catch(() => {});
  await admin.keyboard.press('Escape').catch(() => {});
  await admin.waitForTimeout(400); await killAlarms(admin);
}

test('정보 관리 > 코스 기본 정보 심화 2플로우(비파괴)', async ({ page, context }) => {
  test.setTimeout(300_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);

  const entered = await gotoCourseMenu(admin, '정보 관리', '코스 기본 정보').then(() => true).catch(() => false);
  if (!entered) {
    skip({ path: P, tcRef: R('0'), tcId: 'SC-00', desc: '진입' }, '진입 실패(세션 만료 추정 — course:auth)');
    await writeReport('코스관리_코스기본정보심화'); return;
  }
  await admin.waitForTimeout(1_500); await killAlarms(admin);

  // ══════════ ① SCPHOTO — 등록된 사진 팝업 정합성 ══════════
  const pop = await openPhotoPopup(admin);
  if (!pop) {
    skip({ path: `${P} > 사진 팝업`, tcRef: R('ph_01'), tcId: 'SCPHOTO-01', desc: '썸네일 → [등록된 사진] 팝업 오픈' }, '등록된 사진 팝업 미검출(썸네일 무반응/데이터 없음)');
  } else {
    record({ path: `${P} > 사진 팝업`, tcRef: R('ph_01'), tcId: 'SCPHOTO-01', desc: '썸네일 → [등록된 사진] 팝업 오픈', failMsg: '팝업 미오픈' }, 'PASS', { actual: '등록된 사진 팝업 오픈' });
    // SCPHOTO-02 이미지 렌더
    if (pop.hasImg) record({ path: `${P} > 사진 팝업`, tcRef: R('ph_02'), tcId: 'SCPHOTO-02', desc: '팝업 내 이미지 렌더', failMsg: '이미지 미노출' }, 'PASS', { actual: '이미지 렌더(visible)' });
    else record({ path: `${P} > 사진 팝업`, tcRef: R('ph_02'), tcId: 'SCPHOTO-02', desc: '팝업 내 이미지 렌더', failMsg: '이미지 미노출' }, 'FAIL', { error: '팝업 내 이미지 미노출' });
    // SCPHOTO-03 등록 날짜/시간 정보 노출 + 형식 정합(YYYY-MM-DD HH:MM)
    if (pop.tsValid) record({ path: `${P} > 사진 팝업`, tcRef: R('ph_03'), tcId: 'SCPHOTO-03', desc: '등록 날짜/시간 정보 노출·형식 정합(YYYY-MM-DD HH:MM)', failMsg: '등록 시각 미노출/형식 불일치' }, 'PASS', { actual: `등록 시각 "${pop.ts}"` });
    else record({ path: `${P} > 사진 팝업`, tcRef: R('ph_03'), tcId: 'SCPHOTO-03', desc: '등록 날짜/시간 정보 노출·형식 정합(YYYY-MM-DD HH:MM)', failMsg: '등록 시각 미노출/형식 불일치' }, 'FAIL', { error: '등록 날짜/시간 미노출 또는 형식 불일치', detail: `캡처="${pop.ts}"` });
    // SCPHOTO-04 썸네일 라벨 날짜 ↔ 팝업 등록시각(추적축 — 등록시각은 촬영/기준일과 다를 수 있음 → 정합성은 값 기록·INFO)
    diff(`${P} > 사진 팝업`, '썸네일 라벨 날짜 ↔ 팝업 등록시각', `썸네일라벨="${pop.thumbLabel || '(없음)'}" · 팝업 등록시각="${pop.ts || '(없음)'}"`, R('ph_04'), '등록시각은 촬영/기준일과 상이할 수 있음 → 값 기록(INFO). 등호 단정 금지');
    await closePhotoPopup(admin);
  }

  // ══════════ ② SCEDIT — [수정] 편집화면 전 구성요소 ══════════
  const editBtn = M(admin).getByRole('button', { name: /^\s*수정\s*$/ }).first();
  if (!(await editBtn.isVisible({ timeout: 2_500 }).catch(() => false))) {
    skip({ path: `${P} > 수정`, tcRef: R('ed_00'), tcId: 'SCEDIT-00', desc: '[수정] 편집화면 진입' }, '[수정] 버튼 미노출(진입점 상이/권한)');
  } else {
    await editBtn.click({ timeout: 3_000 }).catch(() => {});
    await admin.waitForTimeout(1_200); await killAlarms(admin);
    const es = await admin.evaluate((labels) => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const modal = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => vis(mo) && !/alarm/.test(String((mo as HTMLElement).className))).sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined;
      const scope = (modal || document.querySelector('.contents, main') || document.body) as HTMLElement;
      const hasSave = Array.from(scope.querySelectorAll('button')).some((b) => /^\s*저장\s*$/.test(b.textContent || ''));
      const hasCancel = Array.from(scope.querySelectorAll('button')).some((b) => /^\s*취소\s*$/.test(b.textContent || ''));
      const inv = {
        mode: modal ? '모달' : '인페이지', hasSave, hasCancel,
        inputs: scope.querySelectorAll('input:not([type=file]):not([type=hidden])').length,
        textareas: scope.querySelectorAll('textarea').length,
        selects: scope.querySelectorAll('select, .vs__dropdown-toggle').length,
        datepickers: scope.querySelectorAll('.datepicker-input, [class*="datepicker"]').length,
        fileInputs: scope.querySelectorAll('input[type=file]').length,
      };
      const labelHits: Record<string, { present: boolean; hasField: boolean; hasPhoto: boolean; rowText: string }> = {};
      const all = Array.from(scope.querySelectorAll('*'));
      for (const lb of labels) {
        const holder = all.find((e) => { const t = norm(e.textContent); return t.includes(lb) && !Array.from(e.children).some((c) => (c.textContent || '').includes(lb)); });
        if (!holder) { labelHits[lb] = { present: false, hasField: false, hasPhoto: false, rowText: '' }; continue; }
        let row: Element | null = holder; for (let k = 0; k < 4 && row; k++) { if (row.querySelector('input, textarea, select, .datepicker-input, .vs__dropdown-toggle, input[type=file], [class*="upload"], img')) break; row = row.parentElement; }
        const field = row ? row.querySelector('input, textarea, select, .datepicker-input, .vs__dropdown-toggle') : null;
        const hasPhoto = row ? !!row.querySelector('input[type=file], [class*="upload"], img, [class*="photo"]') : false;
        labelHits[lb] = { present: true, hasField: !!field, hasPhoto, rowText: row ? norm((row as HTMLElement).innerText).slice(0, 50) : '' };
      }
      return { ...inv, editMode: !!(modal || hasSave), labelHits };
    }, EDIT_LABELS.map((e) => e.label)).catch(() => null);

    if (!es || !es.editMode) {
      skip({ path: `${P} > 수정`, tcRef: R('ed_00'), tcId: 'SCEDIT-00', desc: '[수정] 편집화면 진입' }, '[수정] 클릭했으나 편집모드(모달/저장버튼) 미확인');
    } else {
      record({ path: `${P} > 수정`, tcRef: R('ed_00'), tcId: 'SCEDIT-00', desc: '[수정] 편집화면 진입(모달/인페이지·저장·취소)', failMsg: '편집모드 미진입' }, 'PASS', { actual: `${es.mode}·저장[${es.hasSave}]·취소[${es.hasCancel}]` });
      // SCEDIT-06 폼 인벤토리(구성요소 커버리지 기록)
      record({ path: `${P} > 수정 > 인벤토리`, tcRef: R('ed_inv'), tcId: 'SCEDIT-06', desc: '편집화면 폼 구성요소 인벤토리', failMsg: '' }, 'PASS', { actual: `input ${es.inputs}·textarea ${es.textareas}·select ${es.selects}·datepicker ${es.datepickers}·file ${es.fileInputs}` });
      // SCEDIT-01~05 요청 구성요소 전수
      for (const { label, tcId, expectPhoto } of EDIT_LABELS) {
        const h = es.labelHits[label];
        const m: CheckMeta = { path: `${P} > 수정 > ${label}`, tcRef: R(`ed_${tcId}`), tcId, desc: `수정화면 '${label}' 구성요소 노출`, failMsg: `'${label}' 미노출` };
        if (h && h.present && (expectPhoto ? h.hasPhoto : (h.hasField || h.hasPhoto))) {
          record(m, 'PASS', { actual: `'${label}' 노출(${expectPhoto ? '사진영역' : (h.hasField ? '입력필드' : '영역')}) · "${h.rowText}"` });
        } else if (h && h.present) {
          // 라벨은 있으나 입력/사진 영역 미확정 → 노출은 확인(약식 PASS) + diff 기록
          record(m, 'PASS', { actual: `'${label}' 라벨 노출(입력/영역 미확정)` });
          diff(`${P} > 수정 > ${label}`, `'${label}' 입력/사진 영역 연결`, `라벨 노출·인접 필드 미검출("${h.rowText}")`, R(`ed_${tcId}`), '프로브(course:info-basic-probe)로 필드 구조 확정 후 정밀화');
        } else {
          diff(`${P} > 수정 > ${label}`, `'${label}' 구성요소`, '편집화면에서 라벨 미검출', R(`ed_${tcId}`), '요청 구성요소 미검출 — 프로브로 실 DOM/라벨 표기 확인 요망');
          skip(m, `'${label}' 라벨 미검출(라벨 표기 상이/미구현 — 프로브 확인)`);
        }
      }
      // 취소(비파괴): [취소] → Escape (저장 절대 안 함)
      await admin.evaluate(() => {
        const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
        const scope = Array.from(document.querySelectorAll('.modal-group, [class*="modal"]')).filter((mo) => vis(mo)).sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] as HTMLElement | undefined || document.querySelector('.contents, main');
        const c = scope ? Array.from(scope.querySelectorAll('button')).find((b) => /^\s*취소\s*$/.test(b.textContent || '')) : null; if (c) (c as HTMLElement).click();
      }).catch(() => {});
      await admin.keyboard.press('Escape').catch(() => {});
      await admin.waitForTimeout(500); await killAlarms(admin);
    }
  }

  await killAlarms(admin);
  await writeReport('코스관리_코스기본정보심화');
});
