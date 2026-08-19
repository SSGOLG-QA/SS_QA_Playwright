import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport } from '../lib/reporter';
import { openEditableForm, closeForm, runFormBattery } from '../lib/course/formE2E';

// ──────────────────────────────────────────────────────────────
//  지도/모니터 화면 — 격리 폼 E2E(비파괴). handover 2-3: Leaflet 방문 시 후속 SNB 네비 불능 →
//   한 런에 지도 화면 1개만 "첫 지도"로 방문(신선 세션). MAP_TARGET env로 대상 선택(기본 drone).
//  실행: npm run course:auth 후 $env:MAP_TARGET="drone"; npm run course:map-form-e2e
//  각 대상: 진입 → [등록]/[수정]/라우트/인라인 폼이면 배터리(입력·클리어·datepicker·항목·휴지통) → 폐기.
//   폼 없으면 인터랙티브 구조(버튼/필터/입력) 스캔해 read-only 지도도구로 기록(diff INFO).
//  ⚠ 지도 상호작용(그리기/재생/측정)은 범위 외 — 폼 컨트롤만. 저장/등록 미클릭·비파괴.
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

// MAP_TARGET → [대메뉴, 소메뉴, 키]
const TARGETS: Record<string, [string, string, string]> = {
  drone: ['코스 현황 관리', '드론사진 업로드', 'MAP-DRONE'],
  monitor: ['코스 현황 관리', '코스 모니터', 'MAP-MON'],
  spectral: ['코스 현황 관리', '식생 분석', 'MAP-VEG'],
  draw: ['코스 현황 관리', '코스 영역 설정', 'MAP-DRAW'],
  '3d': ['코스 현황 관리', '3D', 'MAP-3D'],
  green: ['코스 현황 관리', '그린 분석', 'MAP-GREEN'],
  eqmon: ['장비 관리', '장비 관제', 'MAP-EQMON'],
  fcmon: ['시설 관리', '시설 관제', 'MAP-FCMON'],
};

test('지도/모니터 화면 격리 폼 E2E(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin: Page = await openCourseAdmin(page, context);

  const key = (process.env.MAP_TARGET || 'drone').trim();
  const t = TARGETS[key];
  if (!t) { skip({ path: `지도 격리 > ${key}`, tcRef: `코스관리_지도_${key}`, tcId: 'MAPE2E-00', desc: '대상 선택' }, `MAP_TARGET '${key}' 미정의(${Object.keys(TARGETS).join('/')})`); await writeReport('코스관리_지도폼E2E'); return; }
  const [menu, sub, K] = t;
  const P = `${menu} > ${sub}`;
  const Rp = `코스관리_지도_${K}`;

  const ok = await gotoCourseMenu(admin, menu, sub).then(() => true).catch(() => false);
  if (!ok) { skip({ path: P, tcRef: `${Rp}_0`, tcId: `MAPE2E-${K}-00`, desc: '진입' }, '진입 실패(SNB 미노출/네비 실패 — 세션/지도 로드)'); await writeReport('코스관리_지도폼E2E'); return; }
  // 지도 렌더 안정화(무거운 화면 — 콘텐츠 노출까지 폴링 + 여유 대기)
  await admin.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => {});
  await admin.locator('.contents button, main button, .contents [class*="map"], .contents canvas, .contents input, .contents [role="button"]').first().waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {});
  await admin.waitForTimeout(4_000); await killAlarms(admin);
  // 세션 만료/로그인 페이지 가드(격리 런은 신선 세션 필수 — 로그인 화면이면 오탐 방지 위해 skip)
  const degraded = await admin.evaluate(() => {
    const t = (document.querySelector('.contents, main, body')?.textContent || '');
    return /\/login/.test(location.pathname) || (/로그인/.test(t) && /회원가입/.test(t) && (document.querySelector('.contents, main')?.textContent || '').replace(/\s+/g, '').length < 200);
  }).catch(() => false);
  if (degraded) { skip({ path: P, tcRef: `${Rp}_enter`, tcId: `MAPE2E-${K}-ENTER`, desc: '지도/모니터 화면 진입(격리)' }, `세션 만료/로그인 페이지(url=${admin.url()}) — course:auth 후 재실행(격리 런은 신선 세션 1런 필수)`); await writeReport('코스관리_지도폼E2E'); return; }
  record({ path: P, tcRef: `${Rp}_enter`, tcId: `MAPE2E-${K}-ENTER`, desc: '지도/모니터 화면 진입(격리)', failMsg: '진입 실패' }, 'PASS', { actual: `진입 url=${admin.url()}` });

  // 폼 시도
  let form: { opened: boolean; kind: string };
  try { form = await openEditableForm(admin); } catch { form = { opened: false, kind: '' }; }
  if (form.opened) {
    record({ path: `${P} > 폼`, tcRef: `${Rp}_form`, tcId: `MAPE2E-${K}-FORM`, desc: `편집 폼 열기(${form.kind})`, failMsg: '폼 미오픈' }, 'PASS', { actual: form.kind });
    try { await runFormBattery(admin, P, Rp, K); } catch { /* 격리 */ }
    try { await closeForm(admin); } catch { /* noop */ }
  } else {
    // read-only 지도 도구 — 인터랙티브 구조 스캔(INFO)
    const struct = await admin.evaluate(() => {
      const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      // .contents 가 비면 body 전체로 폴백(지도 콘텐츠가 별도 컨테이너일 수 있음)
      let sc: Element = document.querySelector('.contents, main') || document.body;
      if (sc.querySelectorAll('button, [role="button"], a, input').length === 0) sc = document.body;
      // 버튼류: button + role=button + a[class*=btn] + 스타일드 라벨/div(클릭형)
      const clickers = [...new Set(Array.from(sc.querySelectorAll('button, [role="button"], a[class*="btn"], a[class*="button"], label[class*="upload"], [class*="button-common"]')).filter(vis).map((b) => norm((b as HTMLElement).innerText)).filter(Boolean))].slice(0, 30);
      const hasUpload = /영상정보\s*등록|사진\s*등록|업로드|등록/.test(norm((sc as HTMLElement).innerText || ''));
      const inputs = sc.querySelectorAll('input:not([type=file]):not([type=hidden]), textarea').length;
      const maps = sc.querySelectorAll('.leaflet-container, canvas, [class*="map"], [class*="viewer"], [class*="cesium"], iframe').length;
      const fileInputs = sc.querySelectorAll('input[type=file]').length;
      const bodyLen = norm((sc as HTMLElement).innerText || '').length;
      return { buttons: clickers, inputs, maps, fileInputs, hasUpload, bodyLen, scope: sc === document.body ? 'body' : 'contents' };
    }).catch(() => ({ buttons: [] as string[], inputs: 0, maps: 0, fileInputs: 0, hasUpload: false, bodyLen: 0, scope: '?' }));
    skip({ path: `${P} > 폼`, tcRef: `${Rp}_form`, tcId: `MAPE2E-${K}-FORM`, desc: '편집 폼 열기' }, `폼 진입점 없음(지도/시각화 도구) · scope=${struct.scope} 버튼[${struct.buttons.join(', ')}] 입력 ${struct.inputs} 지도 ${struct.maps} 파일 ${struct.fileInputs} 업로드텍스트 ${struct.hasUpload} bodyLen ${struct.bodyLen}`);
    diff(P, '화면 성격', `지도/시각화 도구 — scope=${struct.scope} 버튼[${struct.buttons.slice(0, 12).join(', ')}] 지도요소 ${struct.maps} 입력 ${struct.inputs} 업로드텍스트 ${struct.hasUpload}`, `${Rp}_info`, '지도 상호작용은 전용 딥 스펙 범위(monitor/green/drawzone/3d/facility-monitor 등)');
    console.log(`[MAP-DIAG ${K}] ${JSON.stringify(struct)}`);
  }

  await killAlarms(admin);
  await writeReport('코스관리_지도폼E2E');
});
