import { Page } from '@playwright/test';
import { killAlarms } from './courseHelpers';

// ─────────────────────────────────────────────────────────────────────────────
// 코스관리 자산(장비 관리 > 장비 총괄 / 자재 관리 > 자재 총괄) 등록 공용 헬퍼.
//   확정(2026-08): 커스텀 vue-select(`.vs__dropdown-menu li`), 관계형 거래처 필터, 자동계산값.
//   함정:
//    ① 장비 분류 = taggable(입력+Enter로 신규 생성). 자재 분류 = 기존값만(taggable 아님, 농약/비료/모래/코스소모품/장비소모품/시설소모품/기타).
//    ② 거래처 dropdown은 주요거래항목으로 필터됨 — 장비 등록엔 '장비' 포함 거래처만, 자재 등록엔 '자재' 포함 거래처만.
//    ③ 자재명 입력칸이 2개(양쪽 채워야 반영). 단위당 매입가 = 매입가/수량. 장비 시간당비용 = 매입가/(내용연수×운용시간).
//    ④ 옵션 목록은 `.vs__dropdown-menu li`. 등록 성공 판정은 등록모달 잔존(modalStill) 여부.
// ─────────────────────────────────────────────────────────────────────────────

export interface VSChoice { text?: string; create?: string; index?: number; searchText?: string; }
export interface VSResult { picked: string; opts: string[]; }

/** 커스텀 vue-select(placeholder 입력) 열고 선택/생성. index/text/create/searchText 지원. */
export async function chooseVSDropdown(admin: Page, placeholder: string, choice: VSChoice): Promise<VSResult> {
  const inp = admin.getByPlaceholder(placeholder).first();
  if (!(await inp.isVisible({ timeout: 1_500 }).catch(() => false))) return { picked: '', opts: [] };
  await inp.click({ timeout: 2_000 }).catch(() => {});
  await admin.waitForTimeout(500);
  const search = choice.searchText ?? choice.create ?? choice.text;
  if (search) { await inp.fill(search).catch(() => {}); await admin.waitForTimeout(600); }
  const menu = admin.locator('.vs__dropdown-menu li');
  const opts = await menu.allInnerTexts().catch(() => [] as string[]);
  let picked = '';
  if (choice.index != null) {
    const idx = opts.length ? (choice.index % opts.length) : 0; const n = menu.nth(idx);
    if (await n.isVisible({ timeout: 700 }).catch(() => false)) { picked = (await n.innerText().catch(() => '')).trim(); await n.click({ timeout: 1_500 }).catch(() => {}); } else await admin.keyboard.press('Escape').catch(() => {});
  } else {
    const target = (choice.create || choice.text || '').trim();
    const esc = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exact = menu.filter({ hasText: new RegExp(`^\\s*${esc}\\s*$`) }).first();
    const contains = menu.filter({ hasText: target }).first();
    if (await exact.isVisible({ timeout: 700 }).catch(() => false)) { picked = (await exact.innerText().catch(() => '')).trim(); await exact.click({ timeout: 1_500 }).catch(() => {}); }
    else if (await contains.isVisible({ timeout: 700 }).catch(() => false)) { picked = (await contains.innerText().catch(() => '')).trim(); await contains.click({ timeout: 1_500 }).catch(() => {}); }
    else if (choice.create) { await inp.press('Enter').catch(() => {}); picked = `${choice.create}(Enter생성)`; }
    else await admin.keyboard.press('Escape').catch(() => {});
  }
  await admin.waitForTimeout(400); await killAlarms(admin);
  return { picked, opts: opts.slice(0, 12) };
}

async function scrollModalTo(admin: Page, kw: string) {
  await admin.evaluate((k) => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && new RegExp(k).test((e as HTMLElement).innerText || '')); (el as HTMLElement)?.scrollIntoView({ block: 'center' }); }, kw).catch(() => {});
}
async function submitCreateModal(admin: Page, modalTitleRe: RegExp): Promise<boolean> {
  const reg = admin.getByRole('button', { name: /^등록$/ }).last();
  if (await reg.isVisible({ timeout: 1_000 }).catch(() => false)) { await reg.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
  for (const lbl of ['확인', '예', '등록']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 700 }).catch(() => false)) { await b.click({ timeout: 1_500 }).catch(() => {}); break; } }
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  const modalStill = await admin.locator('.modal-group, [class*="modal"]').filter({ hasText: modalTitleRe }).first().isVisible({ timeout: 800 }).catch(() => false);
  if (modalStill) { for (const lbl of ['취소', '닫기']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); break; } } }
  return !modalStill;   // registered
}

// ── 장비 등록 ────────────────────────────────────────────────────────────────
export interface EquipmentSpec {
  name: string;                       // 장비명
  category: string;                   // 분류(없으면 Enter로 생성 — taggable)
  categoryExisting?: boolean;         // true면 기존 옵션만 선택(생성 안 함)
  brand?: string;                     // 브랜드명
  vendor?: string;                    // 거래처(주요거래항목에 '장비' 포함 거래처만 노출)
  price: number;                      // 매입가(원가)
  life: number;                       // 내용연수
  hours: number;                      // 연간 운용시간
  fuel?: string;                      // 사용연료(휘발유/경유/기타/없음 …)
  mileage?: number;                   // 표준연비(연료 있을 때)
}
/** 장비 등록 모달을 열고 스펙대로 채운 뒤 등록. (호출 전 장비 총괄 화면이어야 함) 반환 {registered, detail}. */
export async function createEquipment(admin: Page, spec: EquipmentSpec): Promise<{ registered: boolean; detail: any }> {
  await admin.getByRole('button', { name: /장비등록|장비 등록|신규 등록/ }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_200); await killAlarms(admin);
  const singleTab = admin.getByRole('button', { name: '단건 등록' }).first();
  if (await singleTab.isVisible({ timeout: 800 }).catch(() => false)) await singleTab.click().catch(() => {});
  await admin.waitForTimeout(300);

  await admin.getByPlaceholder(/장비명 입력/).first().fill(spec.name).catch(() => {});
  const catRes = await chooseVSDropdown(admin, '분류 선택', spec.categoryExisting ? { text: spec.category } : { create: spec.category });
  const gubunRes = await chooseVSDropdown(admin, '장비선택', { index: 0 });   // 장비구분(분류 후 활성)
  if (spec.brand) await admin.getByPlaceholder(/브랜드명 입력/).first().fill(spec.brand).catch(() => {});
  let venRes: VSResult = { picked: '', opts: [] };
  if (spec.vendor) { await scrollModalTo(admin, '거래처'); venRes = await chooseVSDropdown(admin, '거래처 선택', { text: spec.vendor }); }
  const hourly = Math.round(spec.price / (spec.life * spec.hours) / 10) * 10;
  await admin.getByPlaceholder(/매입가 입력/).first().fill(String(spec.price)).catch(() => {});
  await admin.getByPlaceholder(/내용연수 입력/).first().fill(String(spec.life)).catch(() => {});
  await admin.getByPlaceholder(/운용 시간 입력/).first().fill(String(spec.hours)).catch(() => {});
  await admin.getByPlaceholder(/시간당 예상 비용 입력/).first().fill(String(hourly)).catch(() => {});
  if (spec.fuel) { await scrollModalTo(admin, '사용연료'); await admin.getByText(spec.fuel, { exact: true }).first().click({ timeout: 1_500 }).catch(() => {}); if (spec.fuel !== '없음' && spec.mileage != null) await admin.getByPlaceholder(/표준연비 입력/).first().fill(String(spec.mileage)).catch(() => {}); }
  await admin.waitForTimeout(300); await killAlarms(admin);

  const registered = await submitCreateModal(admin, /장비등록|장비 등록/);
  return { registered, detail: { name: spec.name, category: catRes.picked, gubun: gubunRes.picked, vendor: venRes.picked, price: spec.price, life: spec.life, hours: spec.hours, hourly, fuel: spec.fuel } };
}

// ── 거래처 등록 ──────────────────────────────────────────────────────────────
export interface VendorSpec {
  name: string;                       // 상호명
  ceo?: string;                       // 대표자명
  bizNo?: string;                     // 사업자등록번호
  bizType?: string;                   // 업종
  bizItem?: string;                   // 업태
  dealItems?: string[];               // 주요 거래 항목(텍스트, 복수 가능) — ⚠ 장비/자재 등록의 거래처 필터를 좌우('장비'/'자재' 포함 필요)
  dealIndex?: number;                 // 주요 거래 항목을 인덱스로(단일). dealItems 우선.
}
/** 거래처 등록 모달을 열고 스펙대로 채운 뒤 등록. (호출 전 정보 관리 > 거래처 정보 화면이어야 함) 반환 {registered, detail}. */
export async function createVendor(admin: Page, spec: VendorSpec): Promise<{ registered: boolean; detail: any }> {
  await admin.getByRole('button', { name: /거래처 등록/ }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_200); await killAlarms(admin);
  const singleTab = admin.getByRole('button', { name: '단건 등록' }).first();
  if (await singleTab.isVisible({ timeout: 1_000 }).catch(() => false)) await singleTab.click({ timeout: 1_000 }).catch(() => {});
  await admin.waitForTimeout(400);

  await admin.getByPlaceholder('상호명 입력').first().fill(spec.name).catch(() => {});
  if (spec.ceo) await admin.getByPlaceholder('대표자명 입력').first().fill(spec.ceo).catch(() => {});
  if (spec.bizNo) await admin.getByPlaceholder('사업자등록번호 입력').first().fill(spec.bizNo).catch(() => {});
  if (spec.bizType) await admin.getByPlaceholder('업종 입력').first().fill(spec.bizType).catch(() => {});
  if (spec.bizItem) await admin.getByPlaceholder('업태 입력').first().fill(spec.bizItem).catch(() => {});

  // 주요 거래 항목(모달 내 첫 v-select). dealItems(텍스트) 각각 선택, 또는 dealIndex(단일).
  const vs = admin.locator('.modal-group .v-select, [class*="modal"] .v-select').first();
  const picked: string[] = [];
  const openVs = async () => { await vs.locator('.vs__dropdown-toggle').click({ timeout: 2_000 }).catch(() => {}); await admin.waitForTimeout(500); };
  let dealOpts: string[] = [];
  if (spec.dealItems?.length) {
    for (const item of spec.dealItems) {
      await openVs();
      if (!dealOpts.length) dealOpts = await admin.locator('.vs__dropdown-menu li').allInnerTexts().catch(() => []);
      const esc = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const li = admin.locator('.vs__dropdown-menu li').filter({ hasText: new RegExp(`^\\s*${esc}\\s*$`) }).first();
      if (await li.isVisible({ timeout: 700 }).catch(() => false)) { picked.push((await li.innerText().catch(() => '')).trim()); await li.click({ timeout: 1_500 }).catch(() => {}); }
      else await admin.keyboard.press('Escape').catch(() => {});
      await admin.waitForTimeout(300);
    }
  } else if (spec.dealIndex != null) {
    await openVs();
    dealOpts = await admin.locator('.vs__dropdown-menu li').allInnerTexts().catch(() => []);
    const n = admin.locator('.vs__dropdown-menu li').nth(spec.dealIndex);
    if (await n.isVisible({ timeout: 800 }).catch(() => false)) { picked.push((await n.innerText().catch(() => '')).trim()); await n.click({ timeout: 1_500 }).catch(() => {}); }
    else await admin.keyboard.press('Escape').catch(() => {});
  }
  await admin.waitForTimeout(400); await killAlarms(admin);

  const registered = await submitCreateModal(admin, /거래처 등록/);
  return { registered, detail: { name: spec.name, dealItems: picked, dealOpts } };
}

// ── 시설 등록 ────────────────────────────────────────────────────────────────
export interface FacilitySpec {
  name: string;                       // 시설명(최대 50자)
  course?: string;                    // 코스(East/South/West) — 미지정 시 첫 옵션
  hole?: string;                      // 홀
  zone?: string;                      // 구역
  icon?: string;                      // 아이콘(1분류 성격)
  ground?: '지상' | '지하';           // 지상/지하 토글
  category2?: string;                 // 2분류
  category3?: string;                 // 3분류
  product?: string;                   // 제품명(최대 50자)
  spec?: string;                      // 제품 규격(최대 50자)
  manager?: string;                   // 관리 담당자
  installDate?: string;               // 최초 설치일(YYYY-MM-DD)
  vendor?: string;                    // 공사 업체(거래처)
  installCost?: number;               // 설치 비용
  memo?: string;                      // 메모(최대 50자)
}
/** 시설 총괄에서 [시설 등록](→ /facility/reg 페이지폼) 열고 스펙대로 채운 뒤 등록. 반환 {registered, detail}. */
export async function createFacility(admin: Page, spec: FacilitySpec): Promise<{ registered: boolean; detail: any }> {
  await admin.getByRole('button', { name: /^\s*시설\s*등록\s*$/ }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_800); await killAlarms(admin);
  // 값 지정 시 text, 아니면 첫 옵션(index 0)
  const pick = async (ph: string, text?: string) => (await chooseVSDropdown(admin, ph, text ? { text } : { index: 0 })).picked;
  const detail: any = { name: spec.name };
  if (spec.ground) await admin.getByText(spec.ground, { exact: true }).first().click({ timeout: 1_500 }).catch(() => {});
  // 위치: 코스/홀/구역으로 항공지도 이동 → 지도에 핀 클릭('위치를 지정해주세요' 해소)
  detail.course = await pick('코스 전체', spec.course);
  detail.hole = await pick('홀 전체', spec.hole);
  detail.zone = await pick('구역 전체', spec.zone);
  detail.icon = await pick('아이콘 선택', spec.icon);
  await admin.waitForTimeout(800);
  // 지도 요소(좌측 대형 이미지/캔버스) 중앙 클릭으로 핀 배치
  const mapBox = await admin.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 3 && r.height > 3; };
    const cands = [...document.querySelectorAll('.contents img, .contents canvas, .contents [style*="background-image"], .contents [class*="map"], .contents [class*="drone"], .contents div')]
      .filter(vis).map((e) => { const r = (e as HTMLElement).getBoundingClientRect(); return { r }; })
      .filter((x) => x.r.width > 380 && x.r.height > 280 && x.r.left < window.innerWidth * 0.62)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    const m = cands[0]; if (!m) return null;
    return { x: m.r.left + m.r.width / 2, y: m.r.top + m.r.height * 0.6 };   // 상단 드롭다운 오버레이 피해 하단쪽
  }).catch(() => null);
  if (mapBox) { await admin.mouse.click(mapBox.x, mapBox.y); await admin.waitForTimeout(700); await killAlarms(admin); detail.pinClicked = true; }
  else detail.pinClicked = false;

  await admin.getByPlaceholder(/시설명 입력/).first().fill(spec.name).catch(() => {});
  detail.category2 = await pick('2분류 선택', spec.category2);
  detail.category3 = await pick('3분류 선택', spec.category3);
  if (spec.product) await admin.getByPlaceholder(/제품명 입력/).first().fill(spec.product).catch(() => {});
  if (spec.spec) await admin.getByPlaceholder(/제품 규격 입력/).first().fill(spec.spec).catch(() => {});
  detail.manager = await pick('담당자 선택', spec.manager);
  if (spec.installDate) await admin.getByPlaceholder('YYYY-MM-DD').first().fill(spec.installDate).catch(() => {});
  detail.vendor = spec.vendor
    ? (await chooseVSDropdown(admin, '거래처 선택', { text: spec.vendor, searchText: spec.vendor.replace(/^\[.*?\]/, '') })).picked
    : (await chooseVSDropdown(admin, '거래처 선택', { index: 0 })).picked;
  if (spec.installCost != null) await admin.getByPlaceholder(/설치비 입력/).first().fill(String(spec.installCost)).catch(() => {});
  if (spec.memo) await admin.getByPlaceholder(/내용 입력/).first().fill(spec.memo).catch(() => {});
  await admin.waitForTimeout(300); await killAlarms(admin);

  // 등록(페이지폼) → 성공 시 목록(/facility/summary)으로 복귀
  const reg = admin.getByRole('button', { name: /^등록$/ }).last();
  if (await reg.isVisible({ timeout: 1_000 }).catch(() => false)) { await reg.click({ timeout: 2_500 }).catch(() => {}); await admin.waitForTimeout(1_500); await killAlarms(admin); }
  for (const lbl of ['확인', '예', '등록']) { const b = admin.getByRole('button', { name: new RegExp(`^${lbl}$`) }).last(); if (await b.isVisible({ timeout: 700 }).catch(() => false)) { await b.click({ timeout: 1_500 }).catch(() => {}); break; } }
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  const registered = !/\/facility\/reg/.test(admin.url());   // reg 페이지 이탈 = 등록 성공 추정
  if (!registered) { const cancel = admin.getByRole('button', { name: /^취소$/ }).last(); if (await cancel.isVisible({ timeout: 500 }).catch(() => false)) await cancel.click().catch(() => {}); await admin.goBack().catch(() => {}); }
  return { registered, detail };
}

// ── 자재 등록 ────────────────────────────────────────────────────────────────
export interface MaterialSpec {
  name: string;                       // 자재명(입력칸 2개 모두 채움)
  category?: string;                  // 분류(기존값만: 농약/비료/모래/코스소모품/장비소모품/시설소모품/기타)
  categoryIndex?: number;             // 분류를 인덱스로(0=농약 …)
  unit?: string;                      // 단위(텍스트)
  unitIndex?: number;                 // 단위를 인덱스로
  vendor: string;                     // 거래처(주요거래항목에 '자재' 포함 거래처만 노출)
  vendorSearch?: string;              // 거래처 검색어(기본 vendor에서 추출)
  price: number;                      // 매입가
  qty: number;                        // 수량
}
/** 자재 등록 모달을 열고 스펙대로 채운 뒤 등록. (호출 전 자재 총괄 화면이어야 함) 반환 {registered, detail}. */
export async function createMaterial(admin: Page, spec: MaterialSpec): Promise<{ registered: boolean; detail: any }> {
  await admin.getByRole('button', { name: /자재 등록/ }).first().click({ timeout: 3_000 }).catch(() => {});
  await admin.waitForTimeout(1_200); await killAlarms(admin);
  const singleTab = admin.getByRole('button', { name: '신규 등록' }).first();
  if (await singleTab.isVisible({ timeout: 800 }).catch(() => false)) await singleTab.click().catch(() => {});
  await admin.waitForTimeout(300);

  // 자재명 입력칸 2개 모두 채움
  const names = admin.getByPlaceholder(/자재명 입력/); const nc = await names.count().catch(() => 0);
  for (let k = 0; k < nc; k++) await names.nth(k).fill(spec.name).catch(() => {});
  const catRes = await chooseVSDropdown(admin, '분류 선택', spec.categoryIndex != null ? { index: spec.categoryIndex } : { text: spec.category });
  const unitRes = await chooseVSDropdown(admin, '단위 선택', spec.unitIndex != null ? { index: spec.unitIndex } : { text: spec.unit });
  await scrollModalTo(admin, '거래처');
  const venRes = await chooseVSDropdown(admin, '거래처 선택', { text: spec.vendor, searchText: spec.vendorSearch ?? spec.vendor.replace(/^\[.*?\]/, '') });
  await scrollModalTo(admin, '매입가');
  const unitPrice = Math.round(spec.price / spec.qty);
  await admin.getByPlaceholder(/가격 입력/).first().fill(String(spec.price)).catch(() => {});
  await admin.getByPlaceholder(/수량 입력/).first().fill(String(spec.qty)).catch(() => {});
  await admin.getByPlaceholder(/단위당 매입가 입력/).first().fill(String(unitPrice)).catch(() => {});
  await admin.waitForTimeout(300); await killAlarms(admin);

  const registered = await submitCreateModal(admin, /자재 등록/);
  return { registered, detail: { name: spec.name, category: catRes.picked, unit: unitRes.picked, vendor: venRes.picked, price: spec.price, qty: spec.qty, unitPrice } };
}
