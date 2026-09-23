import { Page, expect } from '@playwright/test';
import { settle } from '../adminHelpers';
import { skip, review, record, CheckMeta } from '../reporter';
import { killMobileAlarms, enterCourseMgmt, returnToLanding, MobileArea } from './courseMobileHelpers';
import { SortItem, specForLabel, checkMonotonic } from './sortInvariant';

// 공백 무시 타일 진입(2026-09-17): 타일 텍스트가 area명과 공백 다름(자재관리↔"자재 관리") → gotoMobileArea 정확매칭 실패 보완.
async function enterAreaFlex(page: Page, area: string): Promise<boolean> {
  if (!(await enterCourseMgmt(page))) return false;
  await killMobileAlarms(page);
  const norm = (s: string) => (s || '').replace(/\s+/g, '');
  const boxes = page.locator('.content-box');
  const n = await boxes.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const t = await boxes.nth(i).innerText().catch(() => '');
    if (!norm(t).includes(norm(area))) continue;
    await boxes.nth(i).click({ timeout: 4_000 }).catch(() => {});
    await expect.poll(async () => /\/mobile\/course\//i.test(page.url()), { timeout: 6_000, intervals: [400, 800] }).toBeTruthy().catch(() => {});
    if (/\/mobile\/course\//i.test(page.url())) { await settle(page, 800); await killMobileAlarms(page); return true; }
  }
  return false;
}

// ──────────────────────────────────────────────────────────────
//  코스관리 **모바일 웹** 정렬 불변식 검증 — E2E 기능 오라클(다국어와 별개, 2026-09-17)
//   동기: 사용자 지적 — 이슈/예측 "향후 발생 임박순" 선택인데 카드 순서가 임박순과 불일치(코스_이슈001 2027-08-18이 3번째).
//   원리: **선택한 정렬 라벨 ↔ 실제 카드 순서**를 대조. 카드에서 발생일/등록일/중요도/제목을 파싱해
//     정렬 키로 단조성(monotonic)을 assert. 위반 시 FAIL(첫 역전 지점 + 실제 시퀀스 근거).
//   비파괴: 정렬 옵션 선택(조회 성격)만 — 저장/삭제/등록 없음. 한국어 세션(다국어 전환 안 함).
//   선결: course:auth-mobile. 실행: npm run course:mobile-sort
// ──────────────────────────────────────────────────────────────

// 리스트 카드 전수 파싱(위→아래 화면 순서 유지). 데이터 카드 = 등록일/기간을 담은 테두리 카드. (SortItem = sortInvariant 공용 타입)
async function readCards(page: Page): Promise<SortItem[]> {
  return page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 40 && r.height > 40; };
    const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
    const cards = Array.from(document.querySelectorAll('[class*="bdr-12"], [class*="bd-dde3ec"]'))
      .filter((c) => vis(c) && /등록일|기간/.test((c as HTMLElement).innerText || ''));
    // 최상위 카드만(중첩 카드 제거).
    const top = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c)));
    const pick = (txt: string, re: RegExp): string => { const m = txt.match(re); return m ? m[1].trim() : ''; };
    return top.map((c) => {
      const t = (c as HTMLElement).innerText || '';
      // 제목 = 카드 내 최대 폰트 leaf(사용자 입력 제목).
      let title = ''; let bestPx = 0;
      for (const el of Array.from(c.querySelectorAll('*'))) {
        const h = el as HTMLElement; if (h.children.length) continue;
        const tx = norm(h.innerText || ''); if (!tx || tx.length > 40) continue;
        const px = parseFloat(getComputedStyle(h).fontSize) || 0; if (px > bestPx) { bestPx = px; title = tx; }
      }
      // 기간: '기간' 라벨 뒤 값 우선, 없으면 raw 에서 날짜범위(매년/YYYY-MM-DD ~ ...) 직접 스캔(폴백).
      let period = pick(t, /기간\s*([^\n]+)/);
      if (!/\d{2}[-.]\d{2}/.test(period)) {
        const dr = norm(t).match(/(매년|매월|매주)?\s*\d{2,4}[-.]\d{1,2}(?:[-.]\d{1,2})?\s*~\s*\d{2,4}[-.]\d{1,2}(?:[-.]\d{1,2})?/);
        if (dr) period = dr[0].trim();
      }
      return {
        title, raw: norm(t).slice(0, 120),
        period,
        regDate: pick(t, /등록일\s*(\d{4}-\d{2}-\d{2})/) || (norm(t).match(/\d{4}-\d{2}-\d{2}/g) || []).slice(-1)[0] || '',
        importance: pick(t, /중요도\s*(상|중|하)/),
      };
    });
  }).catch(() => [] as SortItem[]);
}

// (nextOccurDays·regDays·impRank·specForLabel·checkMonotonic 는 ./sortInvariant 공용 엔진에서 import)

// 정렬 컨트롤(현재 정렬 라벨 노출 트리거) 찾기 → 옵션 목록 열기. 반환: 옵션 라벨들 + 선택 함수.
const SORT_LABEL_RE = /(임박순|최신순|이름순|등록순|오래된순|중요도순|가나다순|발생.*순)/;

// 한 화면의 정렬 불변식 검증.
async function verifySortScreen(page: Page, area: MobileArea, tcRef: string): Promise<void> {
  const tab = `모바일정렬-${area}`;
  const meta = (note: string): CheckMeta => ({ path: `${tab}`, tcRef, tcId: `MSORT`, desc: `${area} 정렬 — ${note}` });
  // 정렬 트리거 탐색.
  const trigger = page.getByText(SORT_LABEL_RE).filter({ visible: true }).first();
  if (!(await trigger.count().catch(() => 0))) { skip(meta('정렬 컨트롤'), '정렬 라벨 트리거 미발견(이 화면 정렬 없음/데이터 의존)'); return; }
  const curLabel = ((await trigger.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  // 옵션 열기.
  await trigger.click({ timeout: 3_000 }).catch(() => {}); await settle(page, 700);
  const optLabels: string[] = await page.evaluate(() => {
    const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const sel = '.vs__dropdown-menu li, [class*="option"], [class*="select-list"] li, [role="option"], [class*="dropdown"] li, [class*="sheet"] li';
    return Array.from(new Set(Array.from(document.querySelectorAll(sel)).filter(vis).map((e) => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => /순$|순\b|가나다|임박|최신|이름|등록|중요도/.test(t)))).slice(0, 8);
  }).catch(() => [] as string[]);
  // 옵션 목록을 못 얻으면 현재 라벨 1건만 검증(닫고).
  const targets = optLabels.length ? optLabels : (curLabel ? [curLabel] : []);
  if (!optLabels.length) { await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300); }
  if (!targets.length) { skip(meta('정렬 옵션'), `옵션 목록 미포착(현재='${curLabel}')`); return; }

  const diag: string[] = [];
  for (const opt of targets) {
    const spec = specForLabel(opt);
    // 옵션 선택(옵션이 열려있으면 클릭, 아니면 트리거 재오픈 후 클릭).
    if (optLabels.length) {
      const o = page.getByText(new RegExp(`^\\s*${opt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)).filter({ visible: true }).first();
      if (await o.count().catch(() => 0)) { await o.click({ timeout: 2_500 }).catch(() => {}); }
      await settle(page, 900); await killMobileAlarms(page);
    }
    if (!spec) { diag.push(`${opt}=미지원키`); skip(meta(`'${opt}'`), '정렬 키 해석 미지원(사양 확인 필요)');
      // 다음 옵션 위해 트리거 재오픈.
      if (optLabels.length) { await page.getByText(SORT_LABEL_RE).filter({ visible: true }).first().click({ timeout: 2_000 }).catch(() => {}); await settle(page, 500); }
      continue; }
    const cards = await readCards(page);
    if (cards.length < 2) { diag.push(`${opt}=카드${cards.length}`); skip(meta(`'${opt}'`), `카드 ${cards.length}건(정렬 검증 불충분/데이터 의존)`);
      if (optLabels.length) { await page.getByText(SORT_LABEL_RE).filter({ visible: true }).first().click({ timeout: 2_000 }).catch(() => {}); await settle(page, 500); }
      continue; }
    const vals = cards.map((c) => spec.key(c));
    const res = checkMonotonic(vals, spec.dir);
    const seqStr = cards.map((c, i) => `${i + 1}.${c.title.slice(0, 12)}(${spec.key(c)})`).join(' → ');
    const m = meta(`'${opt}' → ${spec.label}`);
    if (res.status === 'inconclusive') {
      // ⚠ 키 파싱 <2건 = 판정 불가 → SKIP(가짜 PASS 금지). raw 샘플로 파싱 실패 원인 진단.
      skip(m, `정렬 키 파싱 불충분(${res.note}) — 카드 파싱 확인 필요`);
      diag.push(`${opt}=파싱불가·raw="${(cards[0]?.raw || '').slice(0, 50)}"·기간="${cards[0]?.period || ''}"·등록일="${cards[0]?.regDate || ''}"`);
    } else if (res.status === 'pass') {
      record(m, 'PASS', { actual: `정렬 일치(${cards.length}건): ${seqStr}` });
      diag.push(`${opt}=OK(${cards.length})`);
    } else {
      record({ ...m, expected: `${spec.label} 순서`, failMsg: '정렬 순서 위반' }, 'FAIL',
        { actual: `${res.at}번째 역전 · ${seqStr}`, error: '정렬 불일치', detail: res.note });
      diag.push(`${opt}=위반@${res.at}`);
    }
    // 다음 옵션 위해 트리거 재오픈.
    if (optLabels.length) { await page.getByText(SORT_LABEL_RE).filter({ visible: true }).first().click({ timeout: 2_000 }).catch(() => {}); await settle(page, 500); }
  }
  await page.keyboard.press('Escape').catch(() => {}); await settle(page, 300);
  review({ lang: '한국어', screen: `코스관리(모바일) > ${area}`, kind: '정렬 검증 진단', zone: 'sort', item: `${targets.length}옵션`, value: diag.join(' | '), screenshot: '' });
}

// 엔트리 — 정렬 컨트롤 보유 리스트 화면 순회.
const SORT_SCREENS: MobileArea[] = ['이슈/예측', '작업 관리', '자재관리', '시설관리', '장비관리', '일상 점검'];
export async function runCourseMobileSort(page: Page): Promise<void> {
  const tcRef = '코스관리모바일_정렬검증';
  for (const area of SORT_SCREENS) {
    const ok = await enterAreaFlex(page, area);
    if (!ok) { skip({ path: `모바일정렬-${area}`, tcRef, tcId: 'MSORT', desc: `${area} 진입` }, `${area} 진입 실패`); await returnToLanding(page).catch(() => {}); continue; }
    await verifySortScreen(page, area, tcRef);
    await returnToLanding(page).catch(() => {});
  }
}
