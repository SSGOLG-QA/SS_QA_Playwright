import { Locator } from '@playwright/test';

// ────────────────────────────────────────────────────────────────
//  L2 Component — DataGrid
//  td17 어드민의 리스트 테이블(.table-overflow-item table 등)을 화면 무관하게
//  "헤더명 → 셀 값" 레코드로 읽는 재사용 컴포넌트. 인덱스 의존(행번호 클릭) 금지,
//  컬럼명 기반 접근으로 컬럼 순서 변경/드리프트에 견고.
//
//  사용:
//    const grid = new DataGrid(page.locator('.table-overflow-item table'));
//    const rows = await grid.records();           // [{ '날짜':'2026.06.16', '총 내장객':'24', ... }]
//    DataGrid.num('1,234') === 1234
//    DataGrid.pair('12 / 8') === [12, 8]
//    DataGrid.pct('85.7%')  === 85.7
// ────────────────────────────────────────────────────────────────
export class DataGrid {
  constructor(private root: Locator) {}

  private norm(s: string): string { return (s || '').replace(/\s+/g, ' ').trim(); }

  /** thead 헤더 텍스트 배열(공백 단일화) */
  async headers(): Promise<string[]> {
    const ths = await this.root.locator('thead th').allInnerTexts().catch(() => []);
    return ths.map(s => this.norm(s));
  }

  async rowCount(): Promise<number> {
    return this.root.locator('tbody tr').count().catch(() => 0);
  }

  /** 빈 상태("내역이 없습니다" 등) 여부 */
  async isEmpty(): Promise<boolean> {
    const n = await this.rowCount();
    if (n === 0) return true;
    const first = this.norm(await this.root.locator('tbody tr').first().innerText().catch(() => ''));
    return /내역이?\s*없습니다|데이터(가)?\s*없습니다|no data/i.test(first);
  }

  /** 모든 행을 헤더명 → 셀값 레코드로 반환 */
  async records(): Promise<Record<string, string>[]> {
    const hs = await this.headers();
    const rows = this.root.locator('tbody tr');
    const n = await rows.count().catch(() => 0);
    const out: Record<string, string>[] = [];
    for (let i = 0; i < n; i++) {
      const tds = rows.nth(i).locator('td');
      const m = await tds.count().catch(() => 0);
      if (m === 0) continue;
      const rec: Record<string, string> = {};
      for (let j = 0; j < m; j++) {
        const key = hs[j] ?? `col${j}`;
        rec[key] = this.norm(await tds.nth(j).innerText().catch(() => ''));
      }
      out.push(rec);
    }
    return out;
  }

  // ── 값 파서(정적 유틸 — 화면 무관 재사용) ──────────────────────
  /** "1,234" → 1234 / 숫자 없으면 NaN */
  static num(s: string | undefined | null): number {
    if (s == null) return NaN;
    const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }

  /** "12 / 8", "12/8", "남 12 여 8" → [12, 8] (앞 두 숫자) */
  static pair(s: string | undefined | null): [number, number] {
    const ns = (String(s ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/g) || []).map(Number);
    return [ns[0] ?? NaN, ns[1] ?? NaN];
  }

  /** "85.7%" / "85.7" → 85.7 */
  static pct(s: string | undefined | null): number {
    return DataGrid.num(s);
  }
}
