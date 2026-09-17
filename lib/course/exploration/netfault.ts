// Netfault — API 장애(4xx/5xx) 주입 후 앱 복원력 관찰. **비파괴**(서버 데이터 불변; 주입은 응답 가로채기).
//   thick-client: nav만으론 API 미발생 → refetch(조회/검색/적용/새로고침 클릭·없으면 reload) 유발해야 주입이 걸림.
//   오라클: 장애 응답에 앱이 **uncaught JS 예외**(unhandled)나 **무음 백지**로 반응하면 이상. 정상 에러표시=복원력 OK.
//   ⚠ 주입한 5xx 자체는 이상 아님(우리가 만든 것) → http5xx는 무시하고 **pageError(앱 예외)·백지**만 판정.
//   opt-in: EXPLORE_NETFAULT=1 일 때만 실행(디폴트 SKIP). 상태코드 override: EXPLORE_NETFAULT_STATUS.
import type { Page, Route } from '@playwright/test';
import { killAlarms, settle } from '../courseHelpers';
import { RuntimeObservers, detailSignals } from './observers';

export const netfaultEnabled = (): boolean => process.env.EXPLORE_NETFAULT === '1';
export const netfaultStatus = (): number => { const v = Number(process.env.EXPLORE_NETFAULT_STATUS); return v >= 400 && v < 600 ? v : 500; };

// 부팅/인프라 엔드포인트(i18n·공통코드·인증·메뉴·권한) — 주입 제외. 이것까지 죽이면 '전면 outage'라 화면별 장애처리 검증이 안 됨.
// 부팅/사용자 컨텍스트 접두(끝 경계 불요 — hr/my-profile 등 하이픈 변형 포함). 화면 데이터(by-page·course-hole-area 등)는 여기서 제외 안 됨.
const INFRA_RE = /\/(lang|messages|i18n|auth|login|logout|token|refresh|session|menu|permission|locale)(\/|\?|$)|\/common\/(code|config)|\/common\/club\/locale|\/common\/hr\/my|\/user\/(me|info)/i;

const isFaultTarget = (route: Route): boolean => {
  const req = route.request();
  const rt = req.resourceType();
  if (rt !== 'xhr' && rt !== 'fetch') return false;
  if (req.method() !== 'GET') return false;
  const url = req.url();
  if (/\.(js|css|png|jpe?g|svg|gif|woff2?|ico|map)(\?|$)/i.test(url)) return false;
  if (INFRA_RE.test(url)) return false;   // 인프라 제외(부팅 셸은 살리고 화면 데이터만 장애)
  return true;
};

const shortPath = (u: string): string => u.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 80);

// 화면 데이터 GET만 status로 fulfill(인프라 제외). 반환=uninstall + 히트수 + 주입 URL 목록.
async function installFault(page: Page, status: number): Promise<{ uninstall: () => Promise<void>; hits: () => number; urls: () => string[] }> {
  let hit = 0;
  const urls: string[] = [];
  const handler = async (route: Route): Promise<void> => {
    if (isFaultTarget(route)) {
      hit++;
      if (urls.length < 8) urls.push(shortPath(route.request().url()));
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'E2E injected fault', code: status }) }).catch(() => {});
      return;
    }
    await route.continue().catch(() => {});
  };
  await page.route('**/*', handler);
  return { uninstall: async () => { await page.unroute('**/*', handler).catch(() => {}); }, hits: () => hit, urls: () => urls };
}

// refetch 유발 — 검색폼의 조회/검색/적용/새로고침 클릭, 없으면 reload. 반환=유발 방식.
async function triggerRefetch(page: Page): Promise<string> {
  const clicked = await page.evaluate(() => {
    const norm = (s: string): string => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element): boolean => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const root = document.querySelector('.contents, main') || document.body;
    const btn = Array.from(root.querySelectorAll('button, [role="button"]'))
      .find((e) => vis(e) && /^(조회|검색|적용|새로고침)$/.test(norm((e as HTMLElement).innerText || e.textContent || '')));
    if (btn) { (btn as HTMLElement).click(); return norm((btn as HTMLElement).innerText || ''); }
    return '';
  }).catch(() => '');
  if (clicked) return `클릭:${clicked}`;
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  return 'reload';
}

// 본문 백지 여부(콘텐츠 렌더 실패 감지) — 폴링 없이 즉시(호출 시점은 refetch+settle 후).
async function isContentBlank(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector('.contents, main') as HTMLElement | null;
    if (!root) return true;
    const txt = (root.innerText || '').replace(/\s+/g, '').trim();
    return txt.length < 5;
  }).catch(() => false);
}

// 에러 표시(토스트/문구) 휴리스틱 — 복원력 판정 보조.
async function hasErrorIndication(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const t = (document.querySelector('.contents, main, body') as HTMLElement | null)?.innerText || '';
    return /오류|에러|실패|문제가|다시\s*시도|error|failed|잠시\s*후/i.test(t);
  }).catch(() => false);
}

export interface FaultReaction { anomaly: boolean; rule: string; note: string; }

// 장애 주입 1회 → 복원력 관찰 → 원복(unroute + clean reload). obs는 caller가 clear/drain.
export async function observeFaultReaction(page: Page, obs: RuntimeObservers, status: number): Promise<FaultReaction> {
  const before = await isContentBlank(page);
  const f = await installFault(page, status);
  obs.clear();
  const how = await triggerRefetch(page);
  await settle(page, 1_400); await killAlarms(page);
  const sig = obs.drain();
  const blank = await isContentBlank(page);
  const errShown = await hasErrorIndication(page);
  const hits = f.hits();
  const urls = f.urls();
  await f.uninstall();
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});   // 클린 원복(주입 해제 상태 재부팅)
  await settle(page, 1_000); await killAlarms(page);

  const tgt = `대상[${urls.join(', ')}${hits > urls.length ? ` +${hits - urls.length}` : ''}]`;
  if (hits === 0) return { anomaly: false, rule: 'netfault-no-refetch', note: `주입 0건(${how}) — thick-client 프리페치, refetch 미발생 → SKIP` };
  if (sig.pageErrors.length > 0) return { anomaly: true, rule: 'netfault-uncaught', note: `장애(${status}) 주입 ${hits}건·${how} → 앱 uncaught 예외: ${detailSignals(sig)} · ${tgt}` };
  if (blank && !before) return { anomaly: true, rule: 'netfault-silent-blank', note: `장애(${status}) 주입 후 본문 백지·에러표시=${errShown} (${how}, 주입 ${hits}건) · ${tgt}` };
  return { anomaly: false, rule: 'netfault-resilient', note: `장애(${status}) 주입 ${hits}건·${how} → 예외/백지 없음·에러표시=${errShown}(복원력 OK) · ${tgt}` };
}
