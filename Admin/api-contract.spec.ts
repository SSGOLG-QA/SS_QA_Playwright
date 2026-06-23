/**
 * API 응답 계약 검증 스펙 (P1-B)
 *
 * 목적: 5개 핵심 화면의 백엔드 API 응답을 직접 검증
 *   - HTTP 상태 200
 *   - Content-Type application/json
 *   - 응답 최상위 키 존재 (API 계약 드리프트 감지)
 *   - 렌더 행 수 vs API 총 건수 정합성
 *
 * 실행: npm run test:admin -- Admin/api-contract.spec.ts
 *
 * 주의:
 *   - 첫 실행 시 SKIP이 많으면 URL 키워드가 실제 엔드포인트와 불일치.
 *     → discovery 테스트를 먼저 실행하여 실제 API URL을 확인하세요.
 *     → 확인된 URL 키워드로 API_KEYWORDS 상수를 수정합니다.
 */

import { test } from '../lib/fixtures';
import { resetResults, resetNoTC, resetDiff, writeReport } from '../lib/reporter';
import { gotoMenu } from '../lib/reporter';
import { startCapture, checkApiContract } from '../lib/apiContract';

// ──────────────────────────────────────────────────────────────
//  API URL 키워드 설정
//  실제 네트워크 요청을 보고 아래 키워드를 수정하세요.
//  (브라우저 개발자 도구 > Network > XHR/Fetch 탭에서 확인)
// ──────────────────────────────────────────────────────────────
const API = {
  visitStatus:   '/visit',          // 내장 현황 API 키워드
  roundAll:      '/round',          // 전체 라운드 API 키워드
  fnbOrder:      '/order',          // FnB 주문 내역 API 키워드
  accountList:   '/account',        // 계정 리스트 API 키워드
  tournament:    '/tournament',     // 대회관리 API 키워드
};

// ──────────────────────────────────────────────────────────────
//  1. API 엔드포인트 탐지 (discovery)
//  실제 URL을 모를 때 먼저 이 테스트를 실행하여 캡처된 API URL을 확인합니다.
// ──────────────────────────────────────────────────────────────
test.describe('API 엔드포인트 탐지 (discovery)', () => {

  test('내장 현황 — 네트워크 요청 캡처', async ({ admin }) => {
    const captured: string[] = [];
    admin.on('response', res => {
      const ct = res.headers()['content-type'] ?? '';
      if (ct.includes('json') && res.request().method() === 'GET') {
        captured.push(`${res.status()} ${res.url()}`);
      }
    });

    await gotoMenu(admin, '라운드 관리', '내장 현황', {
      path: 'API 탐지 > 내장 현황', tcRef: 'API_DISCOVERY', tcId: 'DISC-01',
      desc: '내장 현황 진입 시 JSON API 캡처', failMsg: '메뉴 진입 불가',
    });
    await admin.waitForLoadState('networkidle').catch(() => {});
    await admin.waitForTimeout(2000);

    console.log('\n[API Discovery] 내장 현황 JSON GET 응답:');
    captured.forEach(u => console.log(' ', u));
    if (captured.length === 0) console.log('  (없음 — 이미 로드된 상태이거나 non-JSON)');
  });

  test('전체 라운드 — 네트워크 요청 캡처', async ({ admin }) => {
    const captured: string[] = [];
    admin.on('response', res => {
      const ct = res.headers()['content-type'] ?? '';
      if (ct.includes('json') && res.request().method() === 'GET') {
        captured.push(`${res.status()} ${res.url()}`);
      }
    });

    await gotoMenu(admin, '라운드 관리', '전체라운드', {
      path: 'API 탐지 > 전체라운드', tcRef: 'API_DISCOVERY', tcId: 'DISC-02',
      desc: '전체 라운드 진입 시 JSON API 캡처', failMsg: '메뉴 진입 불가',
    });
    await admin.waitForLoadState('networkidle').catch(() => {});
    await admin.waitForTimeout(2000);

    console.log('\n[API Discovery] 전체 라운드 JSON GET 응답:');
    captured.forEach(u => console.log(' ', u));
  });

  test('FnB 주문 내역 — 네트워크 요청 캡처', async ({ admin }) => {
    const captured: string[] = [];
    admin.on('response', res => {
      const ct = res.headers()['content-type'] ?? '';
      if (ct.includes('json') && res.request().method() === 'GET') {
        captured.push(`${res.status()} ${res.url()}`);
      }
    });

    await gotoMenu(admin, '식음 관리', '주문 내역 관리', {
      path: 'API 탐지 > FnB 주문', tcRef: 'API_DISCOVERY', tcId: 'DISC-03',
      desc: 'FnB 주문 내역 진입 시 JSON API 캡처', failMsg: '메뉴 진입 불가',
    });
    await admin.waitForLoadState('networkidle').catch(() => {});
    await admin.waitForTimeout(2000);

    console.log('\n[API Discovery] FnB 주문 내역 JSON GET 응답:');
    captured.forEach(u => console.log(' ', u));
  });

  test('계정 리스트 — 네트워크 요청 캡처', async ({ admin }) => {
    const captured: string[] = [];
    admin.on('response', res => {
      const ct = res.headers()['content-type'] ?? '';
      if (ct.includes('json') && res.request().method() === 'GET') {
        captured.push(`${res.status()} ${res.url()}`);
      }
    });

    await gotoMenu(admin, '계정 관리', '계정 리스트', {
      path: 'API 탐지 > 계정 리스트', tcRef: 'API_DISCOVERY', tcId: 'DISC-04',
      desc: '계정 리스트 진입 시 JSON API 캡처', failMsg: '메뉴 진입 불가',
    });
    await admin.waitForLoadState('networkidle').catch(() => {});
    await admin.waitForTimeout(2000);

    console.log('\n[API Discovery] 계정 리스트 JSON GET 응답:');
    captured.forEach(u => console.log(' ', u));
  });

  test('대회관리 — 네트워크 요청 캡처', async ({ admin }) => {
    const captured: string[] = [];
    admin.on('response', res => {
      const ct = res.headers()['content-type'] ?? '';
      if (ct.includes('json') && res.request().method() === 'GET') {
        captured.push(`${res.status()} ${res.url()}`);
      }
    });

    await gotoMenu(admin, '대회', '대회관리', {
      path: 'API 탐지 > 대회관리', tcRef: 'API_DISCOVERY', tcId: 'DISC-05',
      desc: '대회관리 진입 시 JSON API 캡처', failMsg: '메뉴 진입 불가',
    });
    await admin.waitForLoadState('networkidle').catch(() => {});
    await admin.waitForTimeout(2000);

    console.log('\n[API Discovery] 대회관리 JSON GET 응답:');
    captured.forEach(u => console.log(' ', u));
  });
});

// ──────────────────────────────────────────────────────────────
//  2. API 계약 검증 (API_KEYWORDS 수정 후 실행)
// ──────────────────────────────────────────────────────────────
test.describe('API 계약 검증 — 5개 핵심 화면', () => {

  test.beforeEach(async () => {
    resetResults(); resetNoTC(); resetDiff();
  });

  test.afterAll(async () => {
    await writeReport('api-contract');
  });

  // ── 1. 내장 현황 ──────────────────────────────────────────────
  test('내장 현황 API 계약', async ({ admin }) => {
    const capture = startCapture(admin, API.visitStatus);

    await gotoMenu(admin, '라운드 관리', '내장 현황', {
      path: '라운드관리 > 내장 현황', tcRef: 'API_CONTRACT', tcId: 'APC-01',
      desc: '내장 현황 메뉴 진입', failMsg: '메뉴 진입 불가',
    });

    await checkApiContract(admin, capture, {
      path: '라운드관리 > 내장 현황',
      tcRef: 'API_CONTRACT',
      tcId: 'APC-01',
      expectedStatus: 200,
      // 응답 구조 확인 후 실제 키로 교체하세요 (discovery 결과 참조)
      expectedKeys: [],
      // 렌더 행 수 vs API 총 건수 정합성 (키 확인 후 활성화)
      // countPath: 'data.total',
      // getRenderedCount: async (page) =>
      //   page.locator('.table-overflow-item table tbody tr').count(),
    });
  });

  // ── 2. 전체 라운드 ────────────────────────────────────────────
  test('전체 라운드 API 계약', async ({ admin }) => {
    const capture = startCapture(admin, API.roundAll);

    await gotoMenu(admin, '라운드 관리', '전체라운드', {
      path: '라운드관리 > 전체라운드', tcRef: 'API_CONTRACT', tcId: 'APC-02',
      desc: '전체 라운드 메뉴 진입', failMsg: '메뉴 진입 불가',
    });

    await checkApiContract(admin, capture, {
      path: '라운드관리 > 전체라운드',
      tcRef: 'API_CONTRACT',
      tcId: 'APC-02',
      expectedStatus: 200,
      expectedKeys: [],
    });
  });

  // ── 3. FnB 주문 내역 ─────────────────────────────────────────
  test('FnB 주문 내역 API 계약', async ({ admin }) => {
    const capture = startCapture(admin, API.fnbOrder);

    await gotoMenu(admin, '식음 관리', '주문 내역 관리', {
      path: '식음 관리 > 주문 내역 관리', tcRef: 'API_CONTRACT', tcId: 'APC-03',
      desc: 'FnB 주문 내역 메뉴 진입', failMsg: '메뉴 진입 불가',
    });

    await checkApiContract(admin, capture, {
      path: '식음 관리 > 주문 내역 관리',
      tcRef: 'API_CONTRACT',
      tcId: 'APC-03',
      expectedStatus: 200,
      expectedKeys: [],
    });
  });

  // ── 4. 계정 리스트 ────────────────────────────────────────────
  test('계정 리스트 API 계약', async ({ admin }) => {
    const capture = startCapture(admin, API.accountList);

    await gotoMenu(admin, '계정 관리', '계정 리스트', {
      path: '계정 관리 > 계정 리스트', tcRef: 'API_CONTRACT', tcId: 'APC-04',
      desc: '계정 리스트 메뉴 진입', failMsg: '메뉴 진입 불가',
    });

    await checkApiContract(admin, capture, {
      path: '계정 관리 > 계정 리스트',
      tcRef: 'API_CONTRACT',
      tcId: 'APC-04',
      expectedStatus: 200,
      expectedKeys: [],
    });
  });

  // ── 5. 대회관리 ──────────────────────────────────────────────
  test('대회관리 API 계약', async ({ admin }) => {
    const capture = startCapture(admin, API.tournament);

    await gotoMenu(admin, '대회', '대회관리', {
      path: '대회 > 대회관리', tcRef: 'API_CONTRACT', tcId: 'APC-05',
      desc: '대회관리 메뉴 진입', failMsg: '메뉴 진입 불가',
    });

    await checkApiContract(admin, capture, {
      path: '대회 > 대회관리',
      tcRef: 'API_CONTRACT',
      tcId: 'APC-05',
      expectedStatus: 200,
      expectedKeys: [],
    });
  });
});
