// Runtime Observer — 세션 상주 훅으로 console 에러·pageerror(JS 예외)·network(4xx/5xx·요청실패)·dialog 수집.
//   각 액션/전이 전 clear() → 후 drain() 으로 그 구간의 런타임 신호를 evidence로 첨부. 판정은 안 함(Phase 8 Anomaly 입력).
//   ⚠ dialog: beforeunload=accept(하드내비 허용), 그 외(alert/confirm/prompt)=기록 후 dismiss(비커밋). 새탭도 자동 부착.
import type { Page, BrowserContext } from '@playwright/test';

export interface HttpHit { url: string; status: number; }
export interface DialogHit { type: string; message: string; }
export interface RuntimeSignals {
  consoleErrors: string[];
  pageErrors: string[];
  http4xx: HttpHit[];
  http5xx: HttpHit[];
  requestFailed: string[];
  dialogs: DialogHit[];
}

function fresh(): RuntimeSignals {
  return { consoleErrors: [], pageErrors: [], http4xx: [], http5xx: [], requestFailed: [], dialogs: [] };
}

const shortUrl = (u: string): string => u.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 100);

export class RuntimeObservers {
  private buf: RuntimeSignals = fresh();
  private attached = new WeakSet<Page>();

  attach(admin: Page, context: BrowserContext): void {
    this.attachPage(admin);
    context.on('page', (p) => this.attachPage(p));   // 새탭/팝업도 관측
  }

  private attachPage(page: Page): void {
    if (this.attached.has(page)) return;
    this.attached.add(page);
    page.on('console', (msg) => { if (msg.type() === 'error') this.buf.consoleErrors.push(msg.text().slice(0, 200)); });
    page.on('pageerror', (err) => { this.buf.pageErrors.push(String(err && err.message ? err.message : err).slice(0, 200)); });
    page.on('requestfailed', (req) => {
      const rt = req.resourceType();
      if (rt !== 'xhr' && rt !== 'fetch') return;   // 정적자산 abort 무시(데이터 API만)
      this.buf.requestFailed.push(`${shortUrl(req.url())} (${req.failure()?.errorText || 'failed'})`);
    });
    page.on('response', (res) => {
      try {
        const rt = res.request().resourceType();
        if (rt !== 'xhr' && rt !== 'fetch') return;
        const s = res.status();
        if (s >= 500) this.buf.http5xx.push({ url: shortUrl(res.url()), status: s });
        else if (s >= 400) this.buf.http4xx.push({ url: shortUrl(res.url()), status: s });
      } catch { /* 무시 */ }
    });
    page.on('dialog', async (d) => {
      this.buf.dialogs.push({ type: d.type(), message: d.message().slice(0, 120) });
      try { if (d.type() === 'beforeunload') await d.accept(); else await d.dismiss(); } catch { /* 이미 처리됨 */ }
    });
  }

  clear(): void { this.buf = fresh(); }

  // 현재까지 수집된 신호를 반환하고 버퍼 리셋(구간 관측).
  drain(): RuntimeSignals { const s = this.buf; this.buf = fresh(); return s; }
}

// 신호 요약 문자열(evidence). 이상 여부 판정은 안 함(수치만).
export function fmtSignals(s: RuntimeSignals): string {
  return `console ${s.consoleErrors.length}·pageerr ${s.pageErrors.length}·4xx ${s.http4xx.length}·5xx ${s.http5xx.length}·reqfail ${s.requestFailed.length}·dialog ${s.dialogs.length}`;
}

// 에러성 신호가 하나라도 있으면 true(Phase 8 Anomaly 게이트에서 사용).
export function hasErrorSignal(s: RuntimeSignals): boolean {
  return s.consoleErrors.length > 0 || s.pageErrors.length > 0 || s.http4xx.length > 0 || s.http5xx.length > 0 || s.requestFailed.length > 0;
}

// 이상 상세(에러 신호 요약 — 리뷰 value 용).
export function detailSignals(s: RuntimeSignals): string {
  const parts: string[] = [];
  if (s.pageErrors.length) parts.push(`JS예외: ${s.pageErrors.slice(0, 2).join(' / ')}`);
  if (s.http5xx.length) parts.push(`5xx: ${s.http5xx.slice(0, 3).map((h) => `${h.status} ${h.url}`).join(', ')}`);
  if (s.http4xx.length) parts.push(`4xx: ${s.http4xx.slice(0, 3).map((h) => `${h.status} ${h.url}`).join(', ')}`);
  if (s.requestFailed.length) parts.push(`요청실패: ${s.requestFailed.slice(0, 2).join(', ')}`);
  if (s.consoleErrors.length) parts.push(`console: ${s.consoleErrors.slice(0, 2).join(' / ')}`);
  if (s.dialogs.length) parts.push(`dialog: ${s.dialogs.map((d) => `${d.type}"${d.message}"`).slice(0, 2).join(', ')}`);
  return parts.join(' | ');
}
