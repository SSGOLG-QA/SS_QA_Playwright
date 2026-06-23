import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataGrid } from '../lib/components/DataGrid';
import { inferFormula } from '../lib/domain/formula';
import { parseVisitRow, visitInvariants, SS_RATIO_CANDIDATES, PRINT_RATE_CANDIDATES } from '../lib/domain/visitStatus';
import { parseReviewRow, reviewInvariants, OVERALL_RATING_CANDIDATES } from '../lib/domain/reviewStats';
import { parseCourseRow, courseInvariants } from '../lib/domain/courseAnalysis';

// 순수 도메인 로직 단위테스트 — StrykerJS 뮤테이션 테스트 대상.
//  경계값·정확연산 위주로 작성(mutant kill 강화). 실행: npm run test:unit

// ── DataGrid 정적 파서 ───────────────────────────────────────────
test('DataGrid.num: 콤마 제거·숫자 추출·NaN', () => {
  assert.equal(DataGrid.num('1,234'), 1234);
  assert.equal(DataGrid.num('85.7%'), 85.7);
  assert.equal(DataGrid.num('-12'), -12);
  assert.equal(DataGrid.num('총 24명'), 24);
  assert.ok(Number.isNaN(DataGrid.num('')));
  assert.ok(Number.isNaN(DataGrid.num(null)));
  assert.ok(Number.isNaN(DataGrid.num('없음')));
});

test('DataGrid.pair: 앞 두 숫자', () => {
  assert.deepEqual(DataGrid.pair('12 / 8'), [12, 8]);
  assert.deepEqual(DataGrid.pair('남 12 여 8'), [12, 8]);
  assert.deepEqual(DataGrid.pair('1,200/3,400'), [1200, 3400]);
  const [a, b] = DataGrid.pair('5');
  assert.equal(a, 5);
  assert.ok(Number.isNaN(b));
});

test('DataGrid.pct = num', () => {
  assert.equal(DataGrid.pct('85.7%'), 85.7);
  assert.equal(DataGrid.pct('100'), 100);
});

// ── inferFormula: 정밀도 자동감지 + 적합도 + 정렬 ────────────────
test('inferFormula: 완전일치 후보가 fit=of, 내림차순 정렬', () => {
  const rows = [{ a: 10, b: 100, shown: 10 }, { a: 25, b: 100, shown: 25 }]; // a/b*100 == shown
  const res = inferFormula(rows, r => r.shown, [
    { label: 'a/b%', calc: r => (r.a / r.b) * 100 },
    { label: 'b/a%', calc: r => (r.b / r.a) * 100 },
  ]);
  assert.equal(res[0].label, 'a/b%');       // 정렬: 적합도 높은 것 먼저
  assert.equal(res[0].fit, 2);
  assert.equal(res[0].of, 2);
  assert.equal(res[1].fit, 0);
});

test('inferFormula: 정수 표시면 정수 반올림으로 비교(소수 후보도 통과)', () => {
  const rows = [{ n: 1, d: 3, shown: 33 }]; // 1/3*100=33.33 → 정수표시 33 → round=33 일치
  const res = inferFormula(rows, r => r.shown, [{ label: 'n/d', calc: r => (r.n / r.d) * 100 }]);
  assert.equal(res[0].fit, 1);
});

test('inferFormula: 소수 표시면 소수1자리 반올림(정수화 안 함)', () => {
  const rows = [{ n: 1, d: 3, shown: 33.3 }]; // 33.33→소수1자리 33.3 일치
  const res = inferFormula(rows, r => r.shown, [{ label: 'n/d', calc: r => (r.n / r.d) * 100 }]);
  assert.equal(res[0].fit, 1);
});

test('inferFormula: shown=NaN 행은 of에서 제외', () => {
  const rows = [{ v: 5, shown: 5 }, { v: 9, shown: NaN }];
  const res = inferFormula(rows, r => r.shown, [{ label: 'v', calc: r => r.v }]);
  assert.equal(res[0].of, 1);
  assert.equal(res[0].fit, 1);
});

test('inferFormula: tol 경계(기본 0.15)', () => {
  const rows = [{ shown: 10 }];
  // 소수 표시(10은 정수 → allInt true → round). 10.1 → round 10 == 10 통과. 10.6 → round 11 != 10
  const ok = inferFormula(rows as any, (r: any) => r.shown, [{ label: 'c', calc: () => 10.1 }]);
  assert.equal(ok[0].fit, 1);
});

// ── visitStatus ─────────────────────────────────────────────────
test('parseVisitRow: 분리 남/여 컬럼 우선', () => {
  const r = parseVisitRow({ '날짜': '2026.06.18', '총 내장객': '24', '내장객 남': '14', '내장객 여': '10', '유효 내장객': '20', 'SS회원 비율': '50%', '출력률': '80%' });
  assert.equal(r.total, 24);
  assert.equal(r.male, 14);
  assert.equal(r.female, 10);
  assert.equal(r.valid, 20);
  assert.equal(r.ssRatio, 50);
  assert.equal(r.printRate, 80);
});

test('parseVisitRow: 병합 남/여 폴백', () => {
  const r = parseVisitRow({ '총 내장객': '30', '내장객 남/여': '18 / 12' });
  assert.equal(r.male, 18);
  assert.equal(r.female, 12);
});

test('visitInvariants: 총=남+여 (참/거짓)', () => {
  const ok = visitInvariants({ date: 'd', total: 24, male: 14, female: 10, valid: 20, ssExisting: 0, ssNew: 0, ssDaily: 0, ssRatio: 50, prints: 0, printRate: 0 });
  const sum = ok.find(i => i.name === '총 내장객 = 남 + 여')!;
  assert.equal(sum.ok, true);
  const bad = visitInvariants({ date: 'd', total: 25, male: 14, female: 10, valid: 20, ssExisting: 0, ssNew: 0, ssDaily: 0, ssRatio: 50, prints: 0, printRate: 0 });
  assert.equal(bad.find(i => i.name === '총 내장객 = 남 + 여')!.ok, false);
});

test('visitInvariants: 유효 ≤ 총 (경계 포함)', () => {
  const eq = visitInvariants({ date: 'd', total: 20, male: 10, female: 10, valid: 20, ssExisting: 0, ssNew: 0, ssDaily: 0, ssRatio: 0, prints: 0, printRate: 0 });
  assert.equal(eq.find(i => i.name === '유효 내장객 ≤ 총 내장객')!.ok, true); // 20<=20
  const over = visitInvariants({ date: 'd', total: 20, male: 10, female: 10, valid: 21, ssExisting: 0, ssNew: 0, ssDaily: 0, ssRatio: 0, prints: 0, printRate: 0 });
  assert.equal(over.find(i => i.name === '유효 내장객 ≤ 총 내장객')!.ok, false);
});

test('visitInvariants: SS비율 0~100 경계', () => {
  const mk = (ssRatio: number) => visitInvariants({ date: 'd', total: NaN, male: NaN, female: NaN, valid: NaN, ssExisting: 0, ssNew: 0, ssDaily: 0, ssRatio, prints: NaN, printRate: NaN }).find(i => i.name === 'SS회원 비율 0~100%')!.ok;
  assert.equal(mk(0), true);
  assert.equal(mk(100), true);
  assert.equal(mk(-1), false);
  assert.equal(mk(101), false);
});

test('visitInvariants: 필드 누락(NaN)이면 해당 불변식 생략', () => {
  const inv = visitInvariants({ date: 'd', total: NaN, male: NaN, female: NaN, valid: NaN, ssExisting: 0, ssNew: 0, ssDaily: 0, ssRatio: NaN, prints: NaN, printRate: NaN });
  assert.equal(inv.length, 0);
});

test('SS_RATIO_CANDIDATES: (기존+신규)/총 = 50%', () => {
  const row = { date: 'd', total: 20, male: 0, female: 0, valid: 10, ssExisting: 6, ssNew: 4, ssDaily: 2, ssRatio: 50, prints: 0, printRate: 0 };
  assert.equal(SS_RATIO_CANDIDATES[0].calc(row), 50);       // (6+4)/20*100
  assert.equal(SS_RATIO_CANDIDATES[1].calc(row), 60);       // (6+4+2)/20*100
  assert.equal(SS_RATIO_CANDIDATES[2].calc(row), 100);      // (6+4)/10*100
  assert.ok(Number.isNaN(PRINT_RATE_CANDIDATES[0].calc({ ...row, total: 0 }))); // den 0 → NaN
});

// ── reviewStats ─────────────────────────────────────────────────
test('reviewInvariants: 카운트/평점 ≥ 0', () => {
  const inv = reviewInvariants({ date: 'd', regCount: 5, overall: 4.2, course: 4, green: 4, service: 5, progress: 4, fnb: 4, like: 3, dislike: 0, opinion: 1 });
  assert.ok(inv.every(i => i.ok));
  const bad = reviewInvariants({ date: 'd', regCount: -1, overall: 4, course: 4, green: 4, service: 4, progress: 4, fnb: 4, like: 0, dislike: 0, opinion: 0 });
  assert.equal(bad.find(i => i.name === '등록후기 수 ≥ 0')!.ok, false);
});

test('OVERALL_RATING_CANDIDATES: 5항목 평균', () => {
  const row = { date: 'd', regCount: 0, overall: 4, course: 3, green: 5, service: 4, progress: 4, fnb: 4, like: 0, dislike: 0, opinion: 0 };
  assert.equal(OVERALL_RATING_CANDIDATES[0].calc(row), 4); // (3+5+4+4+4)/5
});

// ── courseAnalysis ──────────────────────────────────────────────
test('courseInvariants: 안착률/적중률 0~100, 퍼트·스코어 ≥0', () => {
  const ok = courseInvariants({ hole: '1', score: 4, putts: 2, fairway: 0, green: 100 });
  assert.ok(ok.every(i => i.ok));
  const bad = courseInvariants({ hole: '2', score: -1, putts: 2, fairway: 101, green: 50 });
  assert.equal(bad.find(i => i.name.startsWith('페어웨이'))!.ok, false); // 101>100
  assert.equal(bad.find(i => i.name === '스코어 ≥ 0')!.ok, false);       // -1<0
});

test('parseCourseRow: 퍼트수/적중률 매핑', () => {
  const r = parseCourseRow({ '홀': '3', '스코어': '5', '퍼트수': '2', '페어웨이안착률': '75%', '그린적중률': '50%' });
  assert.equal(r.score, 5);
  assert.equal(r.putts, 2);
  assert.equal(r.fairway, 75);
  assert.equal(r.green, 50);
});

// ══════ 뮤테이션 강화 추가 테스트 (behavioral mutant kill) ══════

// ── 후보 calc 전수 + label(공식 식별자) 검증 ─────────────────────
test('SS_RATIO_CANDIDATES: 전 후보 calc + den=0 NaN + label', () => {
  const row = { date: 'd', total: 20, male: 0, female: 0, valid: 10, ssExisting: 6, ssNew: 4, ssDaily: 2, ssRatio: 0, prints: 0, printRate: 0 };
  assert.equal(SS_RATIO_CANDIDATES[0].calc(row), 50);   // (6+4)/20*100
  assert.equal(SS_RATIO_CANDIDATES[1].calc(row), 60);   // (6+4+2)/20*100
  assert.equal(SS_RATIO_CANDIDATES[2].calc(row), 100);  // (6+4)/10*100
  assert.equal(SS_RATIO_CANDIDATES[3].calc(row), 120);  // (6+4+2)/10*100
  assert.deepEqual(SS_RATIO_CANDIDATES.map(c => c.label), [
    '(기존+신규) / 총내장객', '(기존+신규+일일) / 총내장객', '(기존+신규) / 유효내장객', '(기존+신규+일일) / 유효내장객',
  ]);
  assert.ok(Number.isNaN(SS_RATIO_CANDIDATES[0].calc({ ...row, total: 0 })));   // den 0 → NaN
  assert.ok(Number.isNaN(SS_RATIO_CANDIDATES[2].calc({ ...row, valid: 0 })));
});

test('PRINT_RATE_CANDIDATES: calc 값 + label', () => {
  const row = { date: 'd', total: 50, male: 0, female: 0, valid: 25, ssExisting: 0, ssNew: 0, ssDaily: 0, ssRatio: 0, prints: 10, printRate: 0 };
  assert.equal(PRINT_RATE_CANDIDATES[0].calc(row), 20);  // 10/50*100
  assert.equal(PRINT_RATE_CANDIDATES[1].calc(row), 40);  // 10/25*100
  assert.deepEqual(PRINT_RATE_CANDIDATES.map(c => c.label), ['출력횟수 / 총내장객', '출력횟수 / 유효내장객']);
  assert.ok(Number.isNaN(PRINT_RATE_CANDIDATES[0].calc({ ...row, total: 0 })));
});

test('OVERALL_RATING_CANDIDATES: 평균 + NaN 제외 + label', () => {
  const base = { date: 'd', regCount: 0, overall: 0, like: 0, dislike: 0, opinion: 0 };
  assert.equal(OVERALL_RATING_CANDIDATES[0].calc({ ...base, course: 3, green: 5, service: 4, progress: 4, fnb: 4 }), 4);
  // NaN 항목은 평균에서 제외(분모도 감소): (4+4)/2 = 4
  assert.equal(OVERALL_RATING_CANDIDATES[0].calc({ ...base, course: NaN, green: NaN, service: NaN, progress: 4, fnb: 4 }), 4);
  assert.equal(OVERALL_RATING_CANDIDATES[0].label, '평균(코스·그린·서비스·진행·식음료)');
});

// ── invariant 이름·detail 비공란(StringLiteral '' mutant kill) ────
test('visitInvariants: name/detail 비공란 + detail에 계산값 포함', () => {
  const inv = visitInvariants({ date: '2026.06.18', total: 25, male: 14, female: 10, valid: 20, ssExisting: 0, ssNew: 0, ssDaily: 0, ssRatio: 50, prints: 0, printRate: 0 });
  const sum = inv.find(i => i.name === '총 내장객 = 남 + 여')!;
  assert.ok(sum.detail.includes('2026.06.18'));
  assert.ok(sum.detail.includes('24'));   // 14+10 계산 결과가 detail에 반영
  assert.ok(sum.detail.includes('25'));
  for (const i of inv) assert.ok(i.name.length > 0 && i.detail.length > 0);
});

test('reviewInvariants: 0 경계 ok=true(>= 유지) + 음수 false + 항목 수', () => {
  const zero = reviewInvariants({ date: 'd', regCount: 0, overall: 0, course: 0, green: 0, service: 0, progress: 0, fnb: 0, like: 0, dislike: 0, opinion: 0 });
  assert.equal(zero.length, 10);                    // 4 카운트 + 6 평점
  assert.ok(zero.every(i => i.ok));                 // 모두 0 → '≥0' 참(>0 mutant면 거짓)
  for (const i of zero) assert.ok(i.name.length > 0 && i.detail.length > 0);
  const neg = reviewInvariants({ date: 'd', regCount: 0, overall: -0.1, course: 0, green: 0, service: 0, progress: 0, fnb: 0, like: 0, dislike: 0, opinion: 0 });
  assert.equal(neg.find(i => i.name === "평점 '전체' ≥ 0")!.ok, false);
});

test('courseInvariants: 100 경계 ok=true(<= 유지) + detail 비공란 + 항목 수', () => {
  const r = courseInvariants({ hole: '1', score: 0, putts: 0, fairway: 100, green: 0 });
  assert.equal(r.length, 4);
  assert.ok(r.every(i => i.ok));                     // 0·100 경계 모두 참
  for (const i of r) assert.ok(i.name.length > 0 && i.detail.length > 0);
});

// ── inferFormula 정밀도·정렬·tol 경계 ────────────────────────────
test('inferFormula: 소수 표시는 정수화 안 함(0.3 차이는 탈락)', () => {
  const rows = [{ shown: 33.3 }];                    // 소수 → allInt false → 소수1자리 비교
  const res = inferFormula(rows as any, (r: any) => r.shown, [
    { label: 'exact', calc: () => 33.33 },           // round1 33.3 == 33.3 통과
    { label: 'off', calc: () => 33.9 },              // round1 33.9, |33.9-33.3|=0.6>0.15 탈락
  ]);
  assert.equal(res.find(x => x.label === 'exact')!.fit, 1);
  assert.equal(res.find(x => x.label === 'off')!.fit, 0);
});

test('inferFormula: 빈 행이면 allInt=false, of=0', () => {
  const res = inferFormula([] as any[], (r: any) => r.shown, [{ label: 'c', calc: () => 1 }]);
  assert.equal(res[0].of, 0);
  assert.equal(res[0].fit, 0);
});
