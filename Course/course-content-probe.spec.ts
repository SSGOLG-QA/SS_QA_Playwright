import { test, Page } from '@playwright/test';
import { openCourseAdmin, killAlarms } from '../lib/course/courseHelpers';
import * as fs from 'fs';
import * as path from 'path';

// ──────────────────────────────────────────────────────────────
//  Title/안내문구/섹션제목/컬럼/상태 미검출 진단 프로브(비파괴).
//  실행: npm run course:auth 후 npm run course:content-probe
//  대상: Home(작업 탭). 스크린샷 대비 미검출 항목(예측 정보 요약·오늘의 작업·이번 달 작업·최근 작업 일보 등
//    섹션 제목, "특정 날짜를 선택하여…"/"7일 내로 West 1…" 안내문구, 완료/진행중/대기중 상태, 테이블 컬럼)의
//    실제 태그·클래스 파악 → component-inventory 텍스트/컬럼 셀렉터 정밀 튜닝.
//  산출: analysis/코스관리_Home작업_콘텐츠.json
//  ⚠ 비파괴: 작업 탭 클릭 후 관찰만.
// ──────────────────────────────────────────────────────────────

test('Home 작업 탭 콘텐츠(Title/문구/컬럼/상태) 미검출 진단', async ({ page, context }) => {
  test.setTimeout(200_000);
  const admin: Page = await openCourseAdmin(page, context);
  await admin.waitForTimeout(1_500); await killAlarms(admin);
  // 작업 탭 클릭
  await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const el = Array.from(document.querySelectorAll('.tab-group > *, [role="tab"]')).find((e) => norm(e.textContent) === '작업');
    (el as HTMLElement | undefined)?.click();
  }).catch(() => {});
  await admin.waitForTimeout(1_500); await killAlarms(admin);

  const out = await admin.evaluate(() => {
    const norm = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
    const clsOf = (e: Element) => (typeof e.className === 'string' ? e.className : (e.getAttribute && e.getAttribute('class')) || '');
    const root = document.querySelector('.contents, main') || document.body;
    const inData = (e: Element) => !!e.closest('tbody, .list-table-group, .side-navbar-container, .header');

    // 목표 문구들(스크린샷 기준)의 실제 요소 찾기
    const targets = ['예측 정보 요약', '오늘의 작업', '이번 달 작업', '최근 작업 일보', '작업 계획 보기', '완료', '진행중', '대기 중', '7일 내로', '특정 날짜를 선택'];
    const hits: any[] = [];
    Array.from(root.querySelectorAll('*')).filter((e) => vis(e) && !inData(e)).forEach((e) => {
      const t = norm(e.textContent);
      for (const tg of targets) {
        if (t.startsWith(tg) && t.length <= tg.length + 30 && !Array.from(e.children).some((c) => norm(c.textContent).startsWith(tg))) {
          hits.push({ target: tg, tag: e.tagName.toLowerCase(), cls: clsOf(e).slice(0, 60), text: t.slice(0, 50), parentCls: clsOf(e.parentElement || e).slice(0, 50) });
          break;
        }
      }
    });

    // 제목류 클래스 후보 수집(title/tit/head 포함 클래스)
    const titleCls = new Set<string>();
    Array.from(root.querySelectorAll('[class*="title"], [class*="tit"], [class*="head"], h1,h2,h3,h4,h5')).filter((e) => vis(e) && !inData(e)).forEach((e) => {
      const c = clsOf(e); const t = norm(e.textContent);
      if (t && t.length <= 30) titleCls.add(`${e.tagName.toLowerCase()}.${c.slice(0, 40)} = "${t.slice(0, 24)}"`);
    });

    // 안내/info/guide/alert 클래스 후보
    const infoCls = new Set<string>();
    Array.from(root.querySelectorAll('[class*="info"], [class*="guide"], [class*="notice"], [class*="alert"], [class*="desc"], [class*="comment"], [class*="msg"]')).filter((e) => vis(e) && !inData(e)).forEach((e) => {
      const t = norm(e.textContent); const c = clsOf(e);
      if (t && t.length >= 6 && t.length <= 80 && !e.querySelector('input,button')) infoCls.add(`${e.tagName.toLowerCase()}.${c.slice(0, 40)} = "${t.slice(0, 30)}"`);
    });

    // 테이블 컬럼(thead th)
    const columns = Array.from(root.querySelectorAll('thead th, .list-table-group thead td, [class*="table-head"] [class*="cell"]')).filter(vis).map((e) => norm(e.textContent)).filter(Boolean).slice(0, 20);

    return { hits, titleCls: Array.from(titleCls).slice(0, 25), infoCls: Array.from(infoCls).slice(0, 15), columns };
  }).catch((e) => ({ error: String(e) }));

  if (!fs.existsSync('analysis')) fs.mkdirSync('analysis', { recursive: true });
  fs.writeFileSync(path.join('analysis', '코스관리_Home작업_콘텐츠.json'), JSON.stringify(out, null, 2));
  console.log('\n══ Home 작업 탭 콘텐츠 프로브 ══');
  console.log(JSON.stringify(out, null, 1).slice(0, 3500));
  console.log('[out] analysis/코스관리_Home작업_콘텐츠.json');
});
