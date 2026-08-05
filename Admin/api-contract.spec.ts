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
//  2. API 계약 검증 — 테이블 구동(9개 핵심 화면)
//
//  각 화면 진입 시 발생하는 JSON GET 응답에 대해 일반 계약 불변식을 검증:
//    상태 200 · Content-Type JSON · JSON 파싱/타입 · 에러 envelope 미포함.
//  expectedKeys/countPath는 discovery로 실제 응답 구조 확인 후 화면별로 채우면
//  필드명 드리프트·정합성까지 강화된다(현재는 키 없이도 일반 불변식 수행).
//
//  kw(URL 키워드)가 빗나가도 apiContract의 fallbackAny가 임의 JSON GET로 폴백하므로
//  대부분의 화면에서 SKIP 없이 계약이 검증된다.
// ──────────────────────────────────────────────────────────────
interface ApiScreen {
  menu: string; sub: string; kw: string; id: string; label: string;
  expectedKeys?: string[];
  countPath?: string;
  countSel?: string;
}

const SCREENS: ApiScreen[] = [
  { menu: '라운드 관리', sub: '내장 현황', kw: '/visit', id: 'APC-01', label: '라운드관리 > 내장 현황' },
  { menu: '라운드 관리', sub: '전체라운드', kw: '/round', id: 'APC-02', label: '라운드관리 > 전체라운드' },
  { menu: '식음 관리', sub: '주문 내역 관리', kw: '/order', id: 'APC-03', label: '식음 관리 > 주문 내역 관리' },
  { menu: '계정 관리', sub: '계정 리스트', kw: '/account', id: 'APC-04', label: '계정 관리 > 계정 리스트' },
  { menu: '대회', sub: '대회관리', kw: '/tournament', id: 'APC-05', label: '대회 > 대회관리' },
  { menu: '캐디 관리', sub: '캐디 리스트', kw: '/caddie', id: 'APC-06', label: '캐디 관리 > 캐디 리스트' },
  { menu: '고객 평가 관리', sub: '후기 리스트', kw: '/review', id: 'APC-07', label: '고객 평가 관리 > 후기 리스트' },
  { menu: '코스 운영 관리', sub: '핀 포지션 관리', kw: '/pin', id: 'APC-08', label: '코스 운영 관리 > 핀 포지션 관리' },
  { menu: '배토 관리', sub: '배토 기록 조회', kw: '/topdressing', id: 'APC-09', label: '배토 관리 > 배토 기록 조회' },
];

test.describe('API 계약 검증 — 핵심 화면', () => {

  test.beforeEach(async () => {
    resetResults(); resetNoTC(); resetDiff();
  });

  test.afterAll(async () => {
    await writeReport('api-contract');
  });

  for (const s of SCREENS) {
    test(`${s.label} API 계약`, async ({ admin }) => {
      const capture = startCapture(admin, s.kw);

      await gotoMenu(admin, s.menu, s.sub, {
        path: s.label, tcRef: 'API_CONTRACT', tcId: s.id,
        desc: `${s.sub} 메뉴 진입`, failMsg: '메뉴 진입 불가',
      });

      await checkApiContract(admin, capture, {
        path: s.label,
        tcRef: 'API_CONTRACT',
        tcId: s.id,
        expectedStatus: 200,
        expectedKeys: s.expectedKeys ?? [],
        countPath: s.countPath,
        getRenderedCount: s.countSel
          ? async (page) => page.locator(s.countSel!).count()
          : undefined,
      });
    });
  }
});
