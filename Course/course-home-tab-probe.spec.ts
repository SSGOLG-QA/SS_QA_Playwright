import { test, Page } from '@playwright/test';
import { openCourseAdmin, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  Home 탭 구조 프로브(진단, 비파괴) — 컴포넌트 인벤토리 탭 셀렉터 튜닝용.
//  실행: npm run course:auth 후 npm run course:home-tab-probe
//  목적: Home 탭(관리 목표 및 현황 / 작업 / 비용)의 실제 태그·클래스·부모 컨테이너·형제 구조 덤프
//    → component-inventory.spec 의 탭 셀렉터가 왜 못 잡는지 파악하고 정확한 셀렉터 도출.
//  산출: analysis/코스관리_Home_탭구조.json
//  ⚠ 비파괴: 관찰만(탭 클릭 없음). Home 은 진입 직후 랜딩이라 gotoCourseMenu 불필요.
// ──────────────────────────────────────────────────────────────

const TAB_LABELS = ['관리 목표 및 현황', '관리목표', '관리 목표', '작업', '비용'];

test('Home 탭 구조 프로브(진단)', async ({ page, context }) => {
  test.setTimeout(200_000);
  const admin: Page = await openCourseAdmin(page, context);
  await admin.waitForTimeout(1_500); await killAlarms(admin);

  const out = await admin.evaluate((labels) => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
    const cls = (el: Element) => (typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '');
    const chain = (el: Element, n = 4) => { const out: string[] = []; let p: Element | null = el; for (let i = 0; i < n && p; i++) { out.push(`${p.tagName.toLowerCase()}${cls(p) ? '.' + cls(p).split(/\s+/).slice(0, 3).join('.') : ''}`); p = p.parentElement; } return out.join(' < '); };

    // 1) 탭 라벨 텍스트를 가진 최소 요소(leaf) 찾기
    const all = Array.from(document.querySelectorAll('*')).filter(vis);
    const hits: any[] = [];
    for (const lab of labels) {
      const els = all.filter((e) => {
        const t = norm(e.textContent);
        // 정확/근접 일치 + leaf(자식에 같은 텍스트 없음) + 너무 큰 컨테이너 제외
        return t === lab && !Array.from(e.children).some((c) => norm(c.textContent) === lab) && t.length <= 20;
      });
      els.slice(0, 3).forEach((e) => hits.push({
        label: lab, tag: e.tagName.toLowerCase(), cls: cls(e).slice(0, 80),
        role: e.getAttribute('role') || '', parentCls: cls(e.parentElement || e).slice(0, 80),
        chain: chain(e), siblingCount: e.parentElement ? e.parentElement.children.length : 0,
        parentTag: e.parentElement ? e.parentElement.tagName.toLowerCase() : '',
      }));
    }

    // 2) 탭처럼 보이는 컨테이너 후보(형제 여러 개 + 짧은 텍스트 자식) — 클래스 수집
    const containers: any[] = [];
    const seen = new Set<string>();
    Array.from(document.querySelectorAll('ul, [class*="tab"], [class*="Tab"], [role="tablist"], nav')).filter(vis).forEach((c) => {
      const kids = Array.from(c.children).filter(vis);
      if (kids.length < 2 || kids.length > 8) return;
      const texts = kids.map((k) => norm(k.textContent)).filter((t) => t && t.length <= 20);
      if (texts.length < 2) return;
      const key = cls(c) + '|' + texts.join(',');
      if (seen.has(key)) return; seen.add(key);
      if (/table/i.test(cls(c))) return;
      containers.push({ containerCls: cls(c).slice(0, 80), tag: c.tagName.toLowerCase(), kidTag: kids[0].tagName.toLowerCase(), kidCls: cls(kids[0]).slice(0, 60), texts: texts.slice(0, 8) });
    });

    return { url: location.href, hits, containers: containers.slice(0, 15) };
  }, TAB_LABELS).catch((e) => ({ error: String(e) }));

  if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
  fs.writeFileSync(path.join('analysis', '코스관리_Home_탭구조.json'), JSON.stringify(out, null, 2));
  console.log('\n══ Home 탭 구조 프로브 ══');
  console.log(JSON.stringify(out, null, 1).slice(0, 3000));
  console.log('[out] analysis/코스관리_Home_탭구조.json');
});
