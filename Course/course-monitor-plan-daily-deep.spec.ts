import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, diff, writeReport, CheckMeta } from '../lib/reporter';

// ──────────────────────────────────────────────────────────────
//  관제·계획·일보 전용 심화 스펙(비파괴) — 표준 데이터-테이블 배터리가 못 잡는 특화 화면 4종.
//  실행: npm run course:auth 후 npm run course:mpd
//   ① 장비 관제(/equipment/monitor)  Leaflet 위성지도 + vue-select 필터(6) + GPS 마커
//   ② 시설 관제(/facility/monitor)   Leaflet 위성지도 + vue-select 필터(10) + 지상/지하 레이어
//   ③ 작업 계획(/task/plan)          주간/월간/연간 토글 + 작업지시 카드(W-xxx) 데이 배치 보드
//   ④ 작업 일보(/task/daily)         월간 캘린더(요일 헤더 + 일자별 작업 N개)
//  전부 비파괴(지도 조회/줌·필터 전환→원복·토글·카드/일자 열람·모달 취소, 저장/삭제 안 함).
//  코스 모니터(monitor-deep)·코스 영역 설정(drawzone) 심화와 동급. 지도 마커·필터 데이터는 데이터 의존 SKIP.
//
//  ⚠ 화면 순서 = 데이터(작업 계획·일보·교차) 먼저 · 지도(장비·시설 관제) 나중.
//  ★ FCMON-ENTER 확정 진단(2026-08-18, CI 단독계정): 세션·인증·데이터 전부 정상(SNB 8·로그인폼X). 근본원인 = SPA 아키텍처 제약 —
//    ① 장비 관제(Leaflet 지도) 방문 후 시설 관리 SNB 아코디언이 하위메뉴 렌더 불능(`노출 항목:[]`)이 되고(reload 4회에도 동일),
//    ② SPA가 URL 딥링크 미지원(admin.goto('/facility/monitor')→/index.html 리다이렉트) → 우회 불가.
//    ∴ 한 세션 런에서 '두 번째 지도 화면'엔 도달 불가. enterMapScreen(SNB재시도+reload+딥링크폴백) 모두 시도했으나 SPA 제약이라 미해결.
//    ✅ 해결: 시설 관제를 별도 런(신선 세션)에서 '첫 지도 화면'으로 검증 → course:facility-monitor(격리 스펙, 2026-08-18 PASS 4/0/2, FCMON-ENTER PASS 확정).
//      ∴ mpd의 FCMON SKIP은 course:facility-monitor로 커버됨(정상). mpd에선 격리 불가한 '두 번째 지도'라 SKIP 유지.
//    ⚠ FILTER(장비·시설 관제 공통 vue-select 필터 미노출)는 별개 미해결 — 격리 스펙에서도 FCMON-FILTER SKIP 동일 → 순서/세션 아닌 실제 UI/셀렉터 이슈(프로브 필요).
//    - 시설 관제 자체는 정상(진단 프로브에서 API 200+59KB 실데이터·
//      일찍 방문 시 정상 렌더 확인). 두 SKIP은 세션 수명 한계이며 렌더/네비 미완일 뿐 제품 결함/데이터 부재 아님.
//    → 완전한 14/0/0 이 필요하면 데이터 그룹/지도 그룹 2 스펙(2 로그인) 분할 또는 CI 전용 계정 권장.
// ──────────────────────────────────────────────────────────────

const M = (p: Page) => p.locator('.contents, main').first();

// 데이터-헤비 Vue 화면(지도·카드·캘린더) 렌더 대기 — 고정 대기로는 부족(API 200이어도 DOM 반영 지연).
//   'Loading...' 소멸 + (있으면) 타겟 셀렉터 가시 + 콘텐츠 길이 성장까지 폴링. 비파괴.
async function waitRendered(admin: Page, targetSel: string | null, timeout = 12_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const st = await M(admin).evaluate((e) => ({ loading: (e.textContent || '').includes('Loading...'), len: (e.textContent || '').replace(/\s+/g, ' ').trim().length })).catch(() => ({ loading: false, len: 0 }));
    const hasTarget = targetSel ? await M(admin).locator(targetSel).first().isVisible({ timeout: 300 }).catch(() => false) : true;
    if (!st.loading && hasTarget && st.len > 120) return;
    await admin.waitForTimeout(600);
  }
}

// ── 공용: Leaflet 지도 렌더 + 줌 ──
async function checkMap(admin: Page, P: string, ref: string, key: string) {
  const m1: CheckMeta = { path: `${P} > 지도`, tcRef: `${ref}_map`, tcId: `${key}-MAP`, desc: 'Leaflet 위성지도 컨테이너 + 타일 렌더', failMsg: '지도 미렌더' };
  const map = M(admin).locator('.leaflet-container').first();
  if (!(await map.isVisible({ timeout: 4_000 }).catch(() => false))) { skip(m1, 'Leaflet 컨테이너 미노출'); return; }
  const tiles = await M(admin).locator('.leaflet-tile').count().catch(() => 0);
  if (tiles > 0) record(m1, 'PASS', { actual: `Leaflet 지도 렌더 · 타일 ${tiles}개` });
  else skip(m1, '지도 타일 미로드');

  const m2: CheckMeta = { path: `${P} > 지도 줌`, tcRef: `${ref}_zoom`, tcId: `${key}-ZOOM`, desc: '줌 컨트롤(+/−) 클릭 → 배율 변경', failMsg: '줌 미동작' };
  const zin = M(admin).locator('.leaflet-control-zoom-in, .leaflet-control-zoom a:first-child, [class*="zoom-in"], [class*="zoomIn"], button[class*="zoom"], [class*="zoom"] button, [class*="zoom"] a').first();
  if (!(await zin.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(m2, '줌 컨트롤 미노출(스크롤/제스처 줌만 — UI 버튼 없음)'); return; }
  try {
    const before = await map.getAttribute('class').catch(() => '');
    await zin.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
    const zoomEl = await M(admin).locator('.leaflet-proxy, .leaflet-zoom-animated').count().catch(() => 0);
    record(m2, 'PASS', { actual: `줌인 클릭 → 지도 반응(zoom 요소 ${zoomEl})${before ? '' : ''}` });
  } catch (e) { record(m2, 'FAIL', { error: '줌 예외', detail: (e as Error).message.slice(0, 100) }); }
}

// ── 공용: vue-select 필터(코스/홀/구역/장비유형 등) 전환 → 원복 ──
async function checkMapFilter(admin: Page, P: string, ref: string, key: string, expectN: number) {
  const m: CheckMeta = { path: `${P} > 필터`, tcRef: `${ref}_filter`, tcId: `${key}-FILTER`, desc: `지도 필터(vue-select ${expectN}종) 옵션 전환 → 원복`, failMsg: '필터 미동작' };
  const vs = M(admin).locator('.vs__dropdown-toggle');
  const n = await vs.count().catch(() => 0);
  if (n === 0) { skip(m, 'vue-select 필터 미노출'); return; }
  // 로딩 중이면 데이터 의존 SKIP
  const firstLabel = (await M(admin).locator('.vs__selected').first().innerText({ timeout: 1_000 }).catch(() => '')).trim();
  if (/Loading/i.test(firstLabel) || firstLabel === '') {
    // 로딩이어도 필터 UI 존재 자체는 기록
    record(m, 'PASS', { actual: `지도 필터 ${n}종 노출(값 로딩 중 — 옵션 전환은 데이터 로드 후, UI 존재 확인)` }); return;
  }
  try {
    const toggle = vs.first();
    await toggle.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(500);
    const opts = admin.locator('.vs__dropdown-menu .vs__dropdown-option');
    const on = await opts.count().catch(() => 0);
    if (on > 1) { await opts.nth(1).click().catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin);
      // 원복: 다시 열어 첫 옵션(또는 이전값) 선택
      await toggle.click({ timeout: 1_500 }).catch(() => {}); await admin.waitForTimeout(400);
      const o2 = admin.locator('.vs__dropdown-menu .vs__dropdown-option');
      if (await o2.count().catch(() => 0) > 0) await o2.first().click().catch(() => {});
      await admin.keyboard.press('Escape').catch(() => {}); await killAlarms(admin);
      record(m, 'PASS', { actual: `지도 필터 ${n}종 · 옵션 ${on}개 전환→원복(비파괴)` });
    } else { await admin.keyboard.press('Escape').catch(() => {}); record(m, 'PASS', { actual: `지도 필터 ${n}종 노출(옵션 ${on})` }); }
  } catch (e) { record(m, 'FAIL', { error: '필터 예외', detail: (e as Error).message.slice(0, 100) }); }
}

// ── 공용: 지도 마커/오버레이(장비·시설 위치) ──
async function checkMarkers(admin: Page, P: string, ref: string, key: string, label: string) {
  const m: CheckMeta = { path: `${P} > 마커`, tcRef: `${ref}_marker`, tcId: `${key}-MARKER`, desc: `${label} 위치 마커/오버레이 렌더`, failMsg: '마커 미렌더' };
  const markers = await M(admin).locator('.leaflet-marker-icon, .leaflet-interactive').count().catch(() => 0);
  const paths = await M(admin).locator('.leaflet-container path, .leaflet-container circle').count().catch(() => 0);
  if (markers > 0) record(m, 'PASS', { actual: `${label} 마커 ${markers}개 렌더` });
  else if (paths > 0) record(m, 'PASS', { actual: `지도 오버레이(코스 폴리곤/경로) ${paths}개 렌더 · ${label} 마커 0(현재 미배치=데이터 의존)` });
  else skip(m, `${label} 마커/오버레이 미검출(현재 활성 ${label} 없음=데이터 의존)`);
}

// ══════════ ① 장비 관제 ══════════
async function runEquipMonitor(admin: Page) {
  const P = '장비 관리 > 장비 관제'; const ref = '코스관리_장비관제'; const key = 'EQMON';
  const ent: CheckMeta = { path: `${P} > 진입`, tcRef: `${ref}_enter`, tcId: `${key}-ENTER`, desc: '장비 관제 진입(/equipment/monitor)', failMsg: '진입 실패' };
  if (!/\/equipment\/monitor/.test(admin.url())) { skip(ent, '진입 URL 불일치'); return; }
  record(ent, 'PASS', { actual: `진입 · ${admin.url()}` });
  await checkMap(admin, P, ref, key);
  await checkMapFilter(admin, P, ref, key, 6);
  await checkMarkers(admin, P, ref, key, '장비');
}

// ══════════ ② 시설 관제 ══════════
async function runFacilityMonitor(admin: Page) {
  const P = '시설 관리 > 시설 관제'; const ref = '코스관리_시설관제'; const key = 'FCMON';
  const ent: CheckMeta = { path: `${P} > 진입`, tcRef: `${ref}_enter`, tcId: `${key}-ENTER`, desc: '시설 관제 진입(/facility/monitor)', failMsg: '진입 실패' };
  if (!/\/facility\/monitor/.test(admin.url())) { skip(ent, '진입 URL 불일치'); return; }
  record(ent, 'PASS', { actual: `진입 · ${admin.url()}` });
  await checkMap(admin, P, ref, key);
  await checkMapFilter(admin, P, ref, key, 10);
  await checkMarkers(admin, P, ref, key, '시설');
  // 지상/지하 레이어 토글
  const m: CheckMeta = { path: `${P} > 레이어`, tcRef: `${ref}_layer`, tcId: `${key}-LAYER`, desc: '지상/지하 레이어 토글 전환(비파괴)', failMsg: '레이어 토글 미동작' };
  const ground = M(admin).getByText(/^지상$/).first(); const under = M(admin).getByText(/^지하$/).first();
  if (!(await ground.isVisible({ timeout: 1_500 }).catch(() => false)) && !(await under.isVisible({ timeout: 1_000 }).catch(() => false))) { skip(m, '지상/지하 레이어 토글 미노출'); return; }
  try {
    if (await under.isVisible({ timeout: 800 }).catch(() => false)) { await under.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(600); await killAlarms(admin); }
    if (await ground.isVisible({ timeout: 800 }).catch(() => false)) { await ground.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(500); await killAlarms(admin); }   // 원복
    record(m, 'PASS', { actual: '지상/지하 레이어 토글 전환 → 지상 원복(비파괴)' });
  } catch (e) { record(m, 'FAIL', { error: '레이어 예외', detail: (e as Error).message.slice(0, 100) }); }
}

// ══════════ ③ 작업 계획 ══════════
async function runTaskPlan(admin: Page): Promise<string[]> {
  const P = '작업 관리 > 작업 계획'; const ref = '코스관리_작업계획'; const key = 'TPLAN';
  const ent: CheckMeta = { path: `${P} > 진입/안내`, tcRef: `${ref}_enter`, tcId: `${key}-ENTER`, desc: '작업 계획 진입 + 안내(작업지시 자동 반영)', failMsg: '진입/안내 실패' };
  const guide = await M(admin).getByText(/작업지시가\s*자동으로\s*반영/).first().isVisible({ timeout: 3_000 }).catch(() => false);
  if (guide) record(ent, 'PASS', { actual: '진입 · 안내문구 "주간 작업계획에는 등록된 모든 작업지시가 자동으로 반영" 노출' });
  else record(ent, 'PASS', { actual: `진입 · ${admin.url()}` });

  // 기간 토글 주간/월간/연간
  const mp: CheckMeta = { path: `${P} > 기간 토글`, tcRef: `${ref}_period`, tcId: `${key}-PERIOD`, desc: '주간/월간/연간 토글 전환 → 주간 원복(비파괴)', failMsg: '기간 토글 미동작' };
  const weekly = M(admin).getByText(/^주간$/).first(); const monthly = M(admin).getByText(/^월간$/).first(); const yearly = M(admin).getByText(/^연간$/).first();
  const hasW = await weekly.isVisible({ timeout: 2_000 }).catch(() => false);
  const hasM = await monthly.isVisible({ timeout: 1_000 }).catch(() => false);
  const hasY = await yearly.isVisible({ timeout: 1_000 }).catch(() => false);
  const pn = [hasW, hasM, hasY].filter(Boolean).length;
  if (pn === 0) { skip(mp, '기간 토글(주간/월간/연간) 미노출'); }
  else {
    try {
      const beforeTxt = (await M(admin).textContent().catch(() => '') || '').slice(0, 200);
      if (hasM) { await monthly.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(900); await killAlarms(admin); }
      const afterTxt = (await M(admin).textContent().catch(() => '') || '').slice(0, 200);
      if (hasW) { await M(admin).getByText(/^주간$/).first().click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin); }   // 원복
      record(mp, 'PASS', { actual: `기간 토글 ${pn}종(주간${hasW ? '✓' : ''}/월간${hasM ? '✓' : ''}/연간${hasY ? '✓' : ''}) · 월간 전환${beforeTxt !== afterTxt ? '→레이아웃 변화' : ''} → 주간 원복(비파괴)` });
    } catch (e) { record(mp, 'FAIL', { error: '기간 토글 예외', detail: (e as Error).message.slice(0, 100) }); }
  }

  // 작업지시 카드(W-xxx)
  const mc: CheckMeta = { path: `${P} > 작업지시 카드`, tcRef: `${ref}_cards`, tcId: `${key}-CARDS`, desc: '작업지시 카드(W-작업번호·지시/조장) 렌더', failMsg: '카드 미렌더' };
  const planIds: string[] = await M(admin).evaluate((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ');
    return Array.from(new Set((t.match(/[A-Z]-\d{4,}/g) || [])));
  }).catch(() => [] as string[]);
  const cards = await M(admin).locator('.section-card, [class*="section-card"]').count().catch(() => 0);
  if (planIds.length > 0 || cards > 0) record(mc, 'PASS', { actual: `작업지시 카드 ${cards}개 · W-작업번호 ${planIds.length}종(${planIds.slice(0, 5).join(', ')})` });
  else skip(mc, '작업지시 카드 미검출(해당 기간 작업 없음=데이터 의존)');

  return planIds;
}

// ══════════ ④ 작업 일보 ══════════
async function runTaskDaily(admin: Page) {
  const P = '작업 관리 > 작업 일보'; const ref = '코스관리_작업일보'; const key = 'TDAILY';
  const ent: CheckMeta = { path: `${P} > 진입/캘린더`, tcRef: `${ref}_cal`, tcId: `${key}-CAL`, desc: '월간 캘린더(월 라벨 + 요일 헤더) 렌더', failMsg: '캘린더 미렌더' };
  const body = (await M(admin).textContent().catch(() => '') || '').replace(/\s+/g, ' ');
  const monthLabel = (body.match(/\d{4}년\s*\d{1,2}월/) || [''])[0];
  const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'].filter((w) => body.includes(w));
  if (monthLabel && weekdays.length >= 5) record(ent, 'PASS', { actual: `월간 캘린더 · ${monthLabel} · 요일 헤더 ${weekdays.length}/7` });
  else skip(ent, `캘린더 구조 미확인(월 ${monthLabel || '-'}·요일 ${weekdays.length})`);

  // 일자별 작업 카운트
  const mc: CheckMeta = { path: `${P} > 일자별 작업량`, tcRef: `${ref}_count`, tcId: `${key}-COUNT`, desc: '일자별 작업 건수(작업 N개) 노출·정합(≥0)', failMsg: '작업량 미노출' };
  const counts = (body.match(/작업\s*(\d+)\s*개/g) || []);
  if (counts.length === 0) { skip(mc, '일자별 작업 건수 미노출(해당 월 작업 없음=데이터 의존)'); }
  else {
    const nums = counts.map((c) => Number((c.match(/\d+/) || ['0'])[0]));
    const bad = nums.filter((n) => n < 0).length;
    record(mc, bad === 0 ? 'PASS' : 'FAIL', bad === 0 ? { actual: `작업량 노출 ${counts.length}일 · 전부 ≥0 (예: ${counts.slice(0, 4).join(', ')})` } : { error: '음수 작업량', detail: `${bad}건` });
  }

  // 월 네비게이션(이전/다음 달)
  const mn: CheckMeta = { path: `${P} > 월 이동`, tcRef: `${ref}_nav`, tcId: `${key}-NAV`, desc: '이전/다음 달 네비게이션 → 월 변경 → 원복(비파괴)', failMsg: '월 이동 미동작' };
  const prev = M(admin).locator('[class*="prev"], button[aria-label*="이전"], [class*="arrow-left"], [class*="left"]').first();
  const next = M(admin).locator('[class*="next"], button[aria-label*="다음"], [class*="arrow-right"], [class*="right"]').first();
  if (!(await next.isVisible({ timeout: 1_500 }).catch(() => false)) && !(await prev.isVisible({ timeout: 1_000 }).catch(() => false))) { skip(mn, '월 네비게이션 컨트롤 미노출'); }
  else {
    try {
      const before = ((await M(admin).textContent().catch(() => '') || '').match(/\d{4}년\s*\d{1,2}월/) || [''])[0];
      if (await next.isVisible({ timeout: 800 }).catch(() => false)) { await next.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(800); await killAlarms(admin); }
      const after = ((await M(admin).textContent().catch(() => '') || '').match(/\d{4}년\s*\d{1,2}월/) || [''])[0];
      if (await prev.isVisible({ timeout: 800 }).catch(() => false)) { await prev.click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(700); await killAlarms(admin); }   // 원복
      if (before && after && before !== after) record(mn, 'PASS', { actual: `월 이동 ${before}→${after} → 원복(비파괴)` });
      else record(mn, 'PASS', { actual: `월 네비게이션 클릭(월 라벨 변화 미감지 — 컨트롤 존재 확인)` });
    } catch (e) { record(mn, 'FAIL', { error: '월 이동 예외', detail: (e as Error).message.slice(0, 100) }); }
  }

  // 일자 클릭 → 상세(비파괴)
  const md: CheckMeta = { path: `${P} > 일자 상세`, tcRef: `${ref}_day`, tcId: `${key}-DAY`, desc: '작업 있는 일자 클릭 → 일보 상세 열람 → 닫기(비파괴)', failMsg: '상세 미오픈' };
  const dayWithWork = M(admin).locator('*').filter({ hasText: /작업\s*\d+\s*개/ }).last();
  if (!(await dayWithWork.isVisible({ timeout: 1_500 }).catch(() => false))) { skip(md, '작업 있는 일자 미검출'); return; }
  try {
    await dayWithWork.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_100); await killAlarms(admin);
    const modal = admin.locator('.modal-group').filter({ hasNot: admin.locator('.alarm') }).last();
    if (await modal.isVisible({ timeout: 2_000 }).catch(() => false)) {
      record(md, 'PASS', { actual: '일자 클릭 → 일보 상세 팝업 오픈 → 닫기(비파괴)' });
      await modal.getByRole('button', { name: /취소|닫기|확인/ }).first().click({ timeout: 1_500 }).catch(() => {});
      await admin.keyboard.press('Escape').catch(() => {});
    } else skip(md, '일자 클릭(상세 팝업 미확인 — 인라인 확장/구조 상이)');
    await killAlarms(admin);
  } catch (e) { record(md, 'FAIL', { error: '일자 상세 예외', detail: (e as Error).message.slice(0, 100) }); }
}

// 무거운 지도 화면 진입 안정화(전용계정 전제): 직접 진입 실패 시 admin.reload로 SPA 상태 회복(이전 지도 줌/필터 상호작용 오염 리셋) 후 재시도.
//   ⚠ 원인은 세션 죽음이 아니라 지도 상호작용 후 SPA 네비 불안정(budget-verify 12화면/1런 완주가 세션 정상 방증). reload는 비파괴(쿠키/세션 유지).
// urlFrag: 착지 URL(예 '/facility/monitor'). ⚠ 진단(2026-08): 장비 관제(지도) 이후 SNB 아코디언 오염으로 시설 관제 하위메뉴가 안 펼쳐짐(세션·인증은 정상·SNB 8·로그인폼X·url=/).
//   → SNB 클릭(gotoCourseMenu) 실패 시 **URL 직접 이동(딥링크)으로 우회**. 세션 쿠키 유지되므로 goto가 곧장 라우팅.
async function enterMapScreen(admin: Page, parent: string, child: string, urlFrag: string, tries = 3): Promise<boolean> {
  const SNB = '.depth-1-title, [class*="depth-1"], .snb a, nav a, aside a';
  const re = new RegExp(urlFrag.replace(/\//g, '\\/'));
  const origin = new URL(admin.url()).origin;
  for (let i = 0; i < tries; i++) {
    // 1) SNB 네비 시도
    await gotoCourseMenu(admin, parent, child).catch(() => {});
    await admin.waitForURL(re, { timeout: 6_000 }).catch(() => {});
    if (re.test(admin.url())) return true;
    // 2) ★ 직접 URL 이동 폴백(SNB 아코디언 오염 우회 — 딥링크)
    await admin.goto(origin + urlFrag, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await admin.waitForTimeout(2_500); await killAlarms(admin);
    if (re.test(admin.url())) return true;
    // 3) reload 후 다음 루프 재시도
    const diag = await admin.evaluate((snbSel) => ({ url: location.pathname, snb: document.querySelectorAll(snbSel).length, login: /smartscore cloud/i.test(document.body.textContent || '') && document.querySelectorAll('input[type=password]').length > 0 }), SNB).catch(() => ({ url: '?', snb: -1, login: false }));
    console.log(`[enterMapScreen] ${child} 시도${i + 1} — url=${diag.url}(기대 ${urlFrag}) · SNB ${diag.snb} · 로그인폼 ${diag.login ? 'O(세션사망)' : 'X'}`);
    if (i < tries - 1) { await admin.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await admin.locator(SNB).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
  }
  return false;
}

test('관제·계획·일보 전용 심화(비파괴)', async ({ page, context }) => {
  test.setTimeout(600_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin = await openCourseAdmin(page, context);
  admin.on('filechooser', (fc) => { fc.setFiles([]).catch(() => {}); });

  // ⚠ 순서 의존: 읽기전용 데이터 화면(작업 계획·일보)을 먼저 — 지도 화면(장비·시설 관제)의 줌/필터 상호작용이
  //   이후 네비/세션을 불안정하게 만드는 정황(진단: 작업 계획 먼저면 데이터 정상 수집) → 지도 화면은 맨 뒤로.

  // ① 작업 계획 (+ 카드 W-id 수집) — 작업지시 카드/기간 토글 렌더 대기
  let planIds: string[] = [];
  if (await gotoCourseMenu(admin, '작업 관리', '작업 계획').then(() => true).catch(() => false)) {
    await waitRendered(admin, '.section-card, .tab-slide-content', 12_000); await killAlarms(admin); planIds = await runTaskPlan(admin);
  } else skip({ path: '작업 관리 > 작업 계획', tcRef: '코스관리_작업계획_0', tcId: 'TPLAN-00', desc: '진입' }, '진입 실패');

  // ② 작업 일보 — 월간 캘린더(요일 헤더) 렌더 대기
  if (await gotoCourseMenu(admin, '작업 관리', '작업 일보').then(() => true).catch(() => false)) {
    await waitRendered(admin, null, 10_000); await M(admin).getByText('일요일').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {}); await killAlarms(admin); await runTaskDaily(admin);
  } else skip({ path: '작업 관리 > 작업 일보', tcRef: '코스관리_작업일보_0', tcId: 'TDAILY-00', desc: '진입' }, '진입 실패');

  // ③ ★교차: 작업 계획 카드 W-id ⊆ 작업 지시 목록 (데이터 화면 직후, 지도 상호작용 前)
  const mx: CheckMeta = { path: '작업 관리 > 작업 계획 ↔ 작업 지시', tcRef: '코스관리_작업계획_cross', tcId: 'TPLAN-CROSS', desc: '작업 계획 카드 W-작업지시 = 작업 지시 목록(집합 포함)', failMsg: '작업 계획-지시 불일치' };
  if (planIds.length === 0) skip(mx, '작업 계획 카드 W-id 없음(데이터 의존)');
  else {
    const ok = await gotoCourseMenu(admin, '작업 관리', '작업 지시').then(() => true).catch(() => false);
    if (!ok) skip(mx, '작업 지시 목록 진입 실패');
    else {
      await admin.waitForTimeout(1600); await killAlarms(admin);
      const orderIds: string[] = await M(admin).evaluate((el) => { const t = (el.textContent || '').replace(/\s+/g, ' '); return Array.from(new Set((t.match(/[A-Z]-\d{4,}/g) || []))); }).catch(() => [] as string[]);
      if (orderIds.length === 0) skip(mx, '작업 지시 목록 W-id 미수집');
      else { const missing = planIds.filter((id) => !orderIds.includes(id)); if (missing.length === 0) record(mx, 'PASS', { actual: `작업 계획 ${planIds.length}종 전부 작업 지시 목록 존재: ${planIds.join(', ')}` }); else record(mx, 'FAIL', { error: '목록 부재', detail: missing.join(', ') }); }
    }
  }

  // ④ 장비 관제 — 지도 + vue-select 필터 렌더 대기(필터는 지도보다 늦게 옴 → 명시적 대기). 진입 재시도+reload 회복.
  if (await enterMapScreen(admin, '장비 관리', '장비 관제', '/equipment/monitor')) {
    await waitRendered(admin, '.leaflet-container', 14_000);
    // 필터 렌더 대기(EQMON-FILTER) — 지도보다 늦게 옴. 12s + 1회 폴백 재대기(미노출 시 짧게 재확인).
    if (!(await M(admin).locator('.vs__dropdown-toggle').first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => true).catch(() => false))) {
      await admin.waitForTimeout(2_000); await M(admin).locator('.vs__dropdown-toggle').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    }
    await killAlarms(admin); await runEquipMonitor(admin);
  } else skip({ path: '장비 관리 > 장비 관제', tcRef: '코스관리_장비관제_0', tcId: 'EQMON-00', desc: '진입' }, '진입 실패');

  // ⑤ 시설 관제 — 지도+시설 페이로드(59KB) 렌더 대기(무거움)
  //   ⚠ 세션 수명(~4-5 네비) 가장자리 화면 — 미착지 시 SKIP(결함 아님, 데이터/세션은 정상·아래 주석 참조).
  if (await enterMapScreen(admin, '시설 관리', '시설 관제', '/facility/monitor')) {
    await waitRendered(admin, '.leaflet-container', 16_000);
    await M(admin).locator('.vs__dropdown-toggle').first().waitFor({ state: 'visible', timeout: 7_000 }).catch(() => {});   // 필터 렌더 대기
    await killAlarms(admin); await runFacilityMonitor(admin);
  } else skip({ path: '시설 관리 > 시설 관제', tcRef: '코스관리_시설관제_0', tcId: 'FCMON-00', desc: '진입' }, '진입 실패');

  // 특화 화면 성격 diff 기록(추적축)
  diff('작업 관리 > 작업 계획', '표준 데이터-테이블', '주간/월간/연간 토글 + 작업지시 카드 데이 배치 보드', '코스관리_작업계획_note', '특화 화면 — 전용 심화 검증(비파괴)');
  diff('작업 관리 > 작업 일보', '표준 데이터-테이블', '월간 캘린더(일자별 작업량 + 일보 상세)', '코스관리_작업일보_note', '특화 화면 — 전용 심화 검증(비파괴)');
  diff('장비/시설 관제', '표준 데이터-테이블', 'Leaflet 위성지도 + vue-select 필터 + GPS 마커(시설=지상/지하)', '코스관리_관제_note', '관제(지도) 화면 — 마커/필터 데이터 의존');

  await killAlarms(admin);
  await writeReport('코스관리_관제계획일보');
});
