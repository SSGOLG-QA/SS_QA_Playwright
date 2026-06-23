import { Page } from '@playwright/test';
import { check, skip } from './reporter';

// ──────────────────────────────────────────────────────────────
//  API 응답 계약 검증 유틸리티
//
//  목적: UI 렌더링 통과 여부와 무관하게 백엔드 API 계약을 직접 검증
//    - HTTP 상태 200 확인 (5xx/4xx 시 DOM이 빈 것처럼 보여도 PASS 처리되는 맹점 방지)
//    - Content-Type JSON 확인 (HTML 에러 페이지 반환 감지)
//    - 최상위 키 존재 확인 (필드명 변경 등 API 계약 드리프트 감지)
//    - 렌더 행 수 vs API 총 건수 정합성 (선택)
//
//  비파괴 원칙: GET 전용. 응답을 읽기만 하며 데이터 변경 없음.
// ──────────────────────────────────────────────────────────────

export interface ApiCapture {
  urlPattern: string;
  responsePromise: Promise<import('@playwright/test').Response | null>;
}

export interface ApiContractOpts {
  path: string;
  tcRef: string;
  tcId: string;
  expectedStatus?: number;
  expectedKeys?: string[];
  countPath?: string;
  getRenderedCount?: (page: Page) => Promise<number>;
}

/**
 * 네비게이션/검색 전에 호출하여 API 응답 캡처를 시작합니다.
 * urlKeyword: URL에 포함되어야 하는 문자열 (예: '/visit', '/round-list')
 */
export function startCapture(page: Page, urlKeyword: string): ApiCapture {
  const responsePromise = page.waitForResponse(
    res => res.url().includes(urlKeyword) && res.request().method() === 'GET',
    { timeout: 10_000 },
  ).catch(() => null);

  return { urlPattern: urlKeyword, responsePromise };
}

/**
 * startCapture 이후 캡처된 응답을 검증하고 check() 리포터에 기록합니다.
 */
export async function checkApiContract(
  page: Page,
  capture: ApiCapture,
  opts: ApiContractOpts,
): Promise<void> {
  const { path, tcRef, tcId, expectedStatus = 200, expectedKeys = [], countPath, getRenderedCount } = opts;

  const base = { path: `${path} > API 계약`, tcRef, failMsg: 'API 계약 위반' };

  const res = await capture.responsePromise;

  if (!res) {
    skip(
      { ...base, tcId: `${tcId}-API`, desc: `API 응답 캡처 (키워드: ${capture.urlPattern})` },
      '패턴 일치 GET 응답 없음 — URL 키워드 확인 필요 (네트워크 탭에서 실제 엔드포인트 확인)',
    );
    return;
  }

  const actualUrl = res.url();
  const status = res.status();

  // 1. HTTP 상태
  await check(
    page,
    { ...base, tcId: `${tcId}-API-STATUS`, desc: `HTTP ${expectedStatus} (${shortUrl(actualUrl)})`, expected: `HTTP ${expectedStatus}` },
    async () => {
      if (status !== expectedStatus) throw new Error(`HTTP ${status} (기대: ${expectedStatus}) — ${actualUrl}`);
    },
  );

  // 2. Content-Type JSON
  const ct = res.headers()['content-type'] ?? '';
  await check(
    page,
    { ...base, tcId: `${tcId}-API-CT`, desc: `Content-Type JSON (${shortUrl(actualUrl)})`, expected: 'application/json' },
    async () => {
      if (!ct.includes('json')) throw new Error(`Content-Type: ${ct || '(없음)'}`);
    },
  );

  if (expectedKeys.length === 0 && !countPath) return;

  // 3. JSON 파싱
  let body: Record<string, unknown> = {};
  try {
    body = await res.json() as Record<string, unknown>;
  } catch {
    await check(
      page,
      { ...base, tcId: `${tcId}-API-PARSE`, desc: 'JSON 파싱 성공', expected: 'valid JSON' },
      async () => { throw new Error('응답 body JSON 파싱 실패'); },
    );
    return;
  }

  // 4. 최상위 키 존재
  for (const key of expectedKeys) {
    await check(
      page,
      { ...base, tcId: `${tcId}-API-KEY-${key}`, desc: `응답 키 '${key}' 존재`, expected: `key: ${key}` },
      async () => {
        if (!Object.prototype.hasOwnProperty.call(body, key)) {
          throw new Error(`키 '${key}' 없음 — 실제 키: ${Object.keys(body).slice(0, 8).join(', ')}`);
        }
      },
    );
  }

  // 5. 렌더 행 수 vs API 총 건수
  if (countPath && getRenderedCount) {
    const apiCount = getNestedValue(body, countPath);
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
