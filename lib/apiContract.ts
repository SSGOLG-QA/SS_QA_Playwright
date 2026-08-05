import { Page, Response } from '@playwright/test';
import { check, skip } from './reporter';

// ──────────────────────────────────────────────────────────────
//  API 응답 계약 검증 유틸리티
//
//  목적: UI 렌더링 통과 여부와 무관하게 백엔드 API 계약을 직접 검증
//    - HTTP 상태 2xx 확인 (5xx/4xx 시 DOM이 빈 것처럼 보여도 PASS되는 맹점 방지)
//    - Content-Type JSON 확인 (HTML 에러/로그인 페이지 반환 감지)
//    - JSON 파싱 가능 + 최상위 타입(object|array) 확인
//    - 에러 envelope 미포함 (success:false / error / code>=400 — 200인데 논리적 실패 감지)
//    - [선택] 최상위 키 존재 (필드명 변경 등 계약 드리프트 감지)
//    - [선택] 렌더 행 수 vs API 총 건수 정합성
//
//  핵심 설계(2026-08 강화):
//    - startCapture는 페이지의 **모든 JSON GET 응답을 수집**한다. 단일 URL 키워드
//      추측이 빗나가도 fallback으로 실제 데이터 응답을 잡아 계약을 검증(false SKIP 감소).
//    - expectedKeys/countPath 없이도 위 일반 불변식은 항상 수행 → discovery 전에도 의미있는 검증.
//
//  비파괴 원칙: GET 전용. 응답을 읽기만 하며 데이터 변경 없음.
// ──────────────────────────────────────────────────────────────

interface CapturedRes {
  url: string;
  status: number;
  ct: string;
  res: Response;
}

export interface ApiCapture {
  urlKeyword: string;
  responses: CapturedRes[];
  detach: () => void;
}

export interface ApiContractOpts {
  path: string;
  tcRef: string;
  tcId: string;
  expectedStatus?: number;
  expectedKeys?: string[];
  countPath?: string;
  getRenderedCount?: (page: Page) => Promise<number>;
  /** true면 키워드 미일치 시에도 캡처된 임의 JSON GET로 폴백(기본 true) */
  fallbackAny?: boolean;
  /** 대기 시간(ms) — 네비게이션 후 응답 수집(기본 2500) */
  settleMs?: number;
}

/**
 * 네비게이션/검색 전에 호출. 이후 발생하는 모든 JSON GET 응답을 수집한다.
 * urlKeyword: 우선 선택할 URL 부분 문자열 (예: '/visit', '/round-list')
 */
export function startCapture(page: Page, urlKeyword: string): ApiCapture {
  const responses: CapturedRes[] = [];
  const handler = (res: Response) => {
    try {
      if (res.request().method() !== 'GET') return;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      responses.push({ url: res.url(), status: res.status(), ct, res });
    } catch { /* 응답 소멸 등 무시 */ }
  };
  page.on('response', handler);
  return { urlKeyword, responses, detach: () => page.off('response', handler) };
}

/** 수집분에서 검증 대상 응답을 선택: 키워드 2xx > 키워드 임의 > (fallback) 임의 2xx JSON */
function pick(cap: ApiCapture, fallbackAny: boolean): CapturedRes | null {
  const kw = cap.urlKeyword;
  const byKw = cap.responses.filter(r => r.url.includes(kw));
  const kw2xx = byKw.filter(r => r.status >= 200 && r.status < 300);
  if (kw2xx.length) return kw2xx[kw2xx.length - 1];   // 키워드 일치 최신
  if (byKw.length) return byKw[byKw.length - 1];       // 키워드 일치(비2xx도 상태검증 대상)
  if (!fallbackAny) return null;
  const any2xx = cap.responses.filter(r => r.status >= 200 && r.status < 300);
  if (any2xx.length) return any2xx[any2xx.length - 1]; // 폴백: 임의 2xx JSON GET
  return cap.responses[cap.responses.length - 1] ?? null;
}

/** 흔한 에러 envelope 패턴 감지(보수적 — false positive 회피) */
function errorEnvelope(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (b.success === false) return 'success:false';
  if (typeof b.error === 'string' && b.error.trim()) return `error:"${b.error.slice(0, 40)}"`;
  if (b.error && typeof b.error === 'object' && Object.keys(b.error as object).length) return 'error:{...}';
  if (typeof b.code === 'number' && b.code >= 400) return `code:${b.code}`;
  if (typeof b.status === 'number' && b.status >= 400) return `status:${b.status}`;
  return null;
}

/**
 * startCapture 이후 호출. 캡처된 응답을 검증하고 check() 리포터에 기록한다.
 * 네비게이션(gotoMenu 등) 후에 호출할 것.
 */
export async function checkApiContract(
  page: Page,
  capture: ApiCapture,
  opts: ApiContractOpts,
): Promise<void> {
  const {
    path, tcRef, tcId,
    expectedStatus = 200, expectedKeys = [], countPath, getRenderedCount,
    fallbackAny = true, settleMs = 2500,
  } = opts;

  const base = { path: `${path} > API 계약`, tcRef, failMsg: 'API 계약 위반' };

  // 응답 수집 완료 대기 후 detach
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(settleMs).catch(() => {});
  capture.detach();

  const chosen = pick(capture, fallbackAny);

  if (!chosen) {
    skip(
      { ...base, tcId: `${tcId}-API`, desc: `JSON GET 응답 캡처 (키워드: ${capture.urlKeyword})` },
      `JSON GET 응답 없음 — URL 키워드 확인 필요(수집 ${capture.responses.length}건). 네트워크 탭에서 실제 엔드포인트 확인`,
    );
    return;
  }

  const { url: actualUrl, status } = chosen;
  const matched = actualUrl.includes(capture.urlKeyword);
  const via = matched ? '' : ' [폴백:키워드불일치]';

  // 1. HTTP 상태
  await check(
    page,
    { ...base, tcId: `${tcId}-API-STATUS`, desc: `HTTP ${expectedStatus} (${shortUrl(actualUrl)})${via}`, expected: `HTTP ${expectedStatus}` },
    async () => {
      if (status !== expectedStatus) throw new Error(`HTTP ${status} (기대: ${expectedStatus}) — ${actualUrl}`);
    },
  );

  // 2. Content-Type JSON
  const ct = chosen.ct;
  await check(
    page,
    { ...base, tcId: `${tcId}-API-CT`, desc: `Content-Type JSON (${shortUrl(actualUrl)})`, expected: 'application/json' },
    async () => {
      if (!ct.includes('json')) throw new Error(`Content-Type: ${ct || '(없음)'}`);
    },
  );

  // 3. JSON 파싱 + 최상위 타입 (키 없이도 항상 수행)
  let body: unknown = undefined;
  let parsed = false;
  await check(
    page,
    { ...base, tcId: `${tcId}-API-PARSE`, desc: 'JSON 파싱 + 최상위 타입(object|array)', expected: 'valid JSON object/array' },
    async () => {
      try { body = await chosen.res.json(); parsed = true; }
      catch { throw new Error('응답 body JSON 파싱 실패(HTML 위장 가능)'); }
      if (body === null || (typeof body !== 'object')) {
        throw new Error(`최상위 타입 ${body === null ? 'null' : typeof body} (object/array 기대)`);
      }
    },
  );

  // 4. 에러 envelope 미포함 (200인데 논리적 실패 감지)
  if (parsed) {
    await check(
      page,
      { ...base, tcId: `${tcId}-API-OK`, desc: '에러 envelope 미포함(success:false/error/code>=400)', expected: 'no error envelope' },
      async () => {
        const sig = errorEnvelope(body);
        if (sig) throw new Error(`에러 응답 감지: ${sig}`);
      },
    );
  }

  // 5. [선택] 최상위 키 존재
  if (parsed && expectedKeys.length && body && typeof body === 'object' && !Array.isArray(body)) {
    const rec = body as Record<string, unknown>;
    for (const key of expectedKeys) {
      await check(
        page,
        { ...base, tcId: `${tcId}-API-KEY-${key}`, desc: `응답 키 '${key}' 존재`, expected: `key: ${key}` },
        async () => {
          if (!Object.prototype.hasOwnProperty.call(rec, key)) {
            throw new Error(`키 '${key}' 없음 — 실제 키: ${Object.keys(rec).slice(0, 10).join(', ')}`);
          }
        },
      );
    }
  }

  // 6. [선택] 렌더 행 수 vs API 총 건수
  if (parsed && countPath && getRenderedCount && body && typeof body === 'object') {
    const apiCount = getNestedValue(body as Record<string, unknown>, countPath);
    const rendered = await getRenderedCount(page).catch(() => -1);
    await check(
      page,
      { ...base, tcId: `${tcId}-API-COUNT`, desc: `API 총 건수(${countPath}:${apiCount}) >= 렌더 행 수(${rendered})`, expected: `rendered <= total` },
      async () => {
        if (apiCount == null) throw new Error(`countPath '${countPath}' 값 없음`);
        if (rendered < 0) throw new Error('렌더 행 수 조회 실패');
        if (rendered > Number(apiCount)) throw new Error(`렌더 ${rendered}행 > API 총 ${apiCount}건`);
      },
    );
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function shortUrl(url: string): string {
  try { return new URL(url).pathname.slice(-50); } catch { return url.slice(-50); }
}
