// Candidate (Phase 10) — REPRODUCIBLE_ANOMALY Finding → Course/exploration/candidates/<slug>.{md,json}
//   ⚠ 기존 Course/ 스펙에 **자동 merge 금지** — 사람 검토 후 승격. 여기선 후보 문서만 산출.
//   필드(아키텍처 §10): Title·Feature·Precondition·Sequence·Expected·Actual·ReproCount·Screenshot·Console·Risk·연관 Jira·추천 Regression Test.
import * as fs from 'fs';
import * as path from 'path';
import type { Finding } from './anomaly';

const RULE_TITLE: Record<string, string> = {
  'runtime-error': 'JS 런타임 예외',
  'http-4xx': 'HTTP 4xx 응답',
  'unexpected-nav': '예상외 페이지 이탈',
  'modal-not-closeable': '모달 표준 닫기 불가(하드내비 필요)',
  'repeat-non-idempotent': '반복 실행 비멱등',
  'netfault-uncaught': 'API 장애 시 uncaught JS 예외',
  'netfault-silent-blank': 'API 장애 시 무음 백지(에러표시 없음)',
  'commit-runtime-error': '저장 제출 중 런타임 예외',
  'commit-save-not-reflected': '저장 후 목록 미반영(상태 소실)',
  'commit-noop': '제출 무동작',
};
const RULE_EXPECT: Record<string, string> = {
  'runtime-error': '트리거 실행 시 콘솔/페이지 JS 예외 없이 대상(모달/상세)이 정상 렌더되어야 한다.',
  'http-4xx': '트리거 실행 시 4xx 없이 데이터가 정상 응답되어야 한다.',
  'unexpected-nav': "뷰형 트리거는 상세/모달로 진입해야 하며 홈('/')으로 이탈하지 않아야 한다.",
  'modal-not-closeable': '모달은 표준 닫기(취소/닫기/X/Escape)로 닫혀야 하며 하드내비 없이 원 화면으로 복귀해야 한다.',
  'repeat-non-idempotent': '동일 트리거를 반복 실행해도 동일 상태로 열려야 한다(멱등).',
  'netfault-uncaught': 'API 4xx/5xx 응답 시 앱은 에러 상태/토스트로 처리하고 uncaught JS 예외를 던지지 않아야 한다.',
  'netfault-silent-blank': 'API 장애 시 사용자에게 에러를 표시해야 하며 본문이 무음 백지로 남지 않아야 한다.',
  'commit-runtime-error': '저장 제출 시 JS 예외/5xx 없이 정상 처리되어야 한다.',
  'commit-save-not-reflected': '저장 성공(모달 닫힘) 시 등록 항목이 목록에 반영되어야 한다(상태 일관성).',
  'commit-noop': '제출은 저장하거나 명확한 검증 오류를 표시해야 하며 무반응이면 안 된다.',
};
const ruleRegression = (f: Finding): string => {
  const feat = f.replay ? `${f.replay.feature} > ${f.replay.sub}` : f.screen;
  const trg = f.replay?.trigger || '(트리거)';
  switch (f.rule) {
    case 'runtime-error': return `${feat} 진입 → [${trg}] 클릭 → page.on('pageerror') 및 console error 수집이 0건임을 assert.`;
    case 'http-4xx': return `${feat} 진입 → [${trg}] → 대상 API 응답 status < 400 임을 assert.`;
    case 'unexpected-nav': return `${feat} 진입 → [${trg}] → expect(page.url()).not.toEqual(홈) & 상세/모달 노출 assert.`;
    case 'modal-not-closeable': return `${feat} 진입 → [${trg}] 모달 열기 → 취소/Escape → expect(모달 미노출) & 하드내비 불필요 assert.`;
    case 'repeat-non-idempotent': return `${feat} 진입 → [${trg}] 2회 열기 → 두 관측의 domSig 동일 assert.`;
    case 'netfault-uncaught': return `${feat} 진입 → page.route로 데이터 API 5xx 주입 → refetch(조회/reload) → page.on('pageerror') 0건 & 에러표시 노출 assert.`;
    case 'netfault-silent-blank': return `${feat} 진입 → API 5xx 주입 → refetch → 본문 비백지 & 에러표시(토스트/문구) 노출 assert.`;
    case 'commit-runtime-error': return `${feat} 진입 → [${trg}] 등록 → 필수필드 채움 → 저장 → pageerror/5xx 0건 assert.`;
    case 'commit-save-not-reflected': return `${feat} 진입 → [${trg}] 등록 마커 저장 → 목록 재조회 → 마커행 존재 assert(저장 반영).`;
    case 'commit-noop': return `${feat} 진입 → [${trg}] 등록 마커 저장 → 저장 성공 토스트 또는 검증오류 표시 assert(무동작 아님).`;
    default: return `${feat} 진입 → [${trg}] 재현 절차 반복 → 이상 부재 assert.`;
  }
};
const severity = (f: Finding): string =>
  f.status === 'ANOMALY' ? '높음(ANOMALY)' : f.status === 'NEEDS_REVIEW' ? '중간(NEEDS_REVIEW)' : String(f.status);
// reproDetail("1회: 재현(...) · 2회: 재현(...)")에서 재현/총회수 파싱. 파괴 커밋은 단발.
const reproCount = (f: Finding): string => {
  if (f.repro === 'not-applicable' && f.rule.startsWith('commit')) return '1 (파괴 커밋 단발 — 자동 재현 안 함)';
  const d = f.reproDetail || '';
  const total = (d.match(/\d+회:/g) || []).length || 2;
  const hits = (d.match(/회:\s*재현/g) || []).length;
  return `${hits}/${total}`;
};
const slugOf = (f: Finding): string =>
  `${f.rule}__${(f.replay?.sub || f.screen)}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80);

function toMarkdown(f: Finding): string {
  const feat = f.replay ? `${f.replay.feature} > ${f.replay.sub}` : f.screen;
  const trg = f.replay?.trigger || '(트리거)';
  const jira = f.jiraKeys.length
    ? f.jiraKeys.map((k) => `[${k}](https://smartscoretech.atlassian.net/browse/${k})`).join(', ')
    : '(직접 연관 없음 — 과거결함 라벨 매칭 0)';
  const shot = f.shotPath ? `\`${path.relative(process.cwd(), f.shotPath).replace(/\\/g, '/')}\`` : '(미수집)';
  const console = f.rule === 'runtime-error' ? `\`\`\`\n${f.evidence}\n\`\`\`` : '(런타임 이상 규칙 아님 — 콘솔 로그 N/A)';
  return `# 결함 후보: ${feat} — ${RULE_TITLE[f.rule] || f.rule}

> ⚠️ **자동 생성 후보(사람 검토 필요)** · Course/ 스펙에 자동 merge 금지 · 세션 내 2회 재현 확인분.
> 원천: AI Exploratory Agent 탐색(비파괴). Finding \`${f.id}\` · 생성 ${new Date().toISOString()}

| 항목 | 내용 |
|---|---|
| **Title** | ${feat} [${trg}] ${RULE_TITLE[f.rule] || f.rule} |
| **Feature** | ${feat} |
| **Rule** | \`${f.rule}\` |
| **Risk(심각도)** | ${severity(f)} |
| **ReproCount** | ${reproCount(f)} (세션 내 재로그인 없이) |
| **연관 Jira** | ${jira} |

## Precondition
- 코스관리 PC(course-mng-td · 킹즈락) 로그인 세션(storageState) 유효.
- \`${feat}\` 메뉴 진입 가능(gotoCourseMenu). 리스트/폼 기본 로드 완료.

## Sequence (재현 절차)
${f.sequence.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Expected
${RULE_EXPECT[f.rule] || '이상 없이 정상 동작해야 한다.'}

## Actual
- ${f.reason}
- **Evidence**: ${f.evidence}

## ReproDetail (2회 재실행)
${f.reproDetail || '-'}

## Console / Runtime
${console}

## Screenshot
${shot}

## 추천 Regression Test
${ruleRegression(f)}

---
_이 후보는 탐색 산출물이며 검증 스펙이 아님. QA 검토 후 \`Course/*.spec.ts\`로 승격._
`;
}

export interface CandidateResult { written: string[]; count: number; skipped: number; }

// REPRODUCIBLE_ANOMALY만 후보 md+json 산출. 반환=작성된 md 경로 목록.
export function writeCandidates(findings: Finding[], dir: string): CandidateResult {
  fs.mkdirSync(dir, { recursive: true });
  // REPRODUCIBLE_ANOMALY(재현확정) + 파괴 커밋 ANOMALY(의도된 단발 관측=확정, 자동 재현 불가).
  const targets = findings.filter((f) =>
    f.repro === 'REPRODUCIBLE_ANOMALY' || (f.rule.startsWith('commit') && f.status === 'ANOMALY'));
  // ── stale 정리: 이전 런의 후보(md/json)와 참조 안 되는 스샷(png)을 제거해 디렉터리를 **현재 런 기준**으로 유지.
  //    (과거 오탐 후보가 잔존해 QA 오도하는 것 방지) — 에이전트 생성물만 대상.
  const keepDocs = new Set(targets.map((f) => slugOf(f)));
  const keepShots = new Set(targets.map((f) => path.basename(f.shotPath || '')).filter(Boolean));
  for (const fn of fs.readdirSync(dir).filter((n) => /\.(md|json|png)$/.test(n))) {
    const base = fn.replace(/\.(md|json)$/, '');
    if (fn.endsWith('.png')) { if (!keepShots.has(fn)) fs.rmSync(path.join(dir, fn), { force: true }); }
    else if (!keepDocs.has(base)) fs.rmSync(path.join(dir, fn), { force: true });
  }
  const written: string[] = [];
  for (const f of targets) {
    const slug = slugOf(f);
    const mdPath = path.join(dir, `${slug}.md`);
    const jsonPath = path.join(dir, `${slug}.json`);
    fs.writeFileSync(mdPath, toMarkdown(f), 'utf8');
    fs.writeFileSync(jsonPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      autoMergeForbidden: true,
      title: `${f.replay ? `${f.replay.feature} > ${f.replay.sub}` : f.screen} [${f.replay?.trigger || ''}] ${RULE_TITLE[f.rule] || f.rule}`,
      feature: f.replay ? `${f.replay.feature} > ${f.replay.sub}` : f.screen,
      rule: f.rule,
      severity: severity(f),
      reproCount: reproCount(f),
      reproDetail: f.reproDetail || '',
      jiraKeys: f.jiraKeys,
      precondition: `코스관리 PC(course-mng-td·킹즈락) 세션 유효 + ${f.replay ? `${f.replay.feature} > ${f.replay.sub}` : f.screen} 진입`,
      sequence: f.sequence,
      expected: RULE_EXPECT[f.rule] || '',
      actual: f.reason,
      evidence: f.evidence,
      console: f.rule === 'runtime-error' ? f.evidence : '',
      screenshot: f.shotPath ? path.relative(process.cwd(), f.shotPath).replace(/\\/g, '/') : '',
      recommendedRegression: ruleRegression(f),
      sourceFindingId: f.id,
    }, null, 2), 'utf8');
    written.push(mdPath);
  }
  return { written, count: targets.length, skipped: findings.length - targets.length };
}
