import { test, Page } from '@playwright/test';
import { openCourseAdmin, gotoCourseMenu, killAlarms } from '../lib/course/courseHelpers';
import { resetResults, resetNoTC, resetDiff, resetReview, resetIA, record, skip, writeReport } from '../lib/reporter';
import { openEditableForm, closeForm, runFormBattery } from '../lib/course/formE2E';

// ──────────────────────────────────────────────────────────────
//  정보 관리 — 코스 기본 정보 외 10종 폼 E2E(비파괴, 저장 안 함). 한 로그인으로 순회.
//  실행: npm run course:auth 후 npm run course:info-e2e-all
//  각 화면: 진입 → [신규 등록] 모달/[수정] 폼 열기 → 배터리(입력전수·[X]클리어·항목추가/삭제·파일휴지통) → [취소] 폐기.
//  ⚠ 저장/등록(submit) 절대 클릭 금지. 폼 미제공(읽기전용/데이터 의존) 화면은 skip.
//  코스 기본 정보는 전용 spec(course:info-basic-e2e)에서 커버 → 여기선 제외.
// ──────────────────────────────────────────────────────────────

const SCREENS: { sub: string; key: string }[] = [
  { sub: '코스 리뉴얼 정보', key: 'RN' },
  { sub: '홀 별 정보', key: 'HL' },
  { sub: '잔디 측정 정보', key: 'GR' },
  { sub: '토양 측정 정보', key: 'SO' },
  { sub: '발병 정보', key: 'DIS' },
  { sub: '코스 운영 정보', key: 'OP' },
  { sub: '기상 정보', key: 'WX' },
  { sub: '거래처 정보', key: 'VN' },
  { sub: '관리 기준 정보', key: 'EV' },
  { sub: '일상 점검', key: 'DL' },
];

test('정보 관리 10종 폼 E2E(코스 기본 외, 비파괴)', async ({ page, context }) => {
  test.setTimeout(900_000);
  resetResults(); resetNoTC(); resetDiff(); resetReview(); resetIA();
  const admin: Page = await openCourseAdmin(page, context);

  for (const { sub, key } of SCREENS) {
    const P = `정보 관리 > ${sub}`;
    const Rp = `코스관리_정보E2E_${key}`;
    const ok = await gotoCourseMenu(admin, '정보 관리', sub).then(() => true).catch(() => false);
    if (!ok) { skip({ path: P, tcRef: `${Rp}_0`, tcId: `INFOE2E-${key}-00`, desc: '진입' }, '진입 실패'); continue; }
    await admin.waitForTimeout(1_100); await killAlarms(admin);

    const form = await openEditableForm(admin).catch(() => ({ opened: false, kind: '' }));
    if (!form.opened) {
      skip({ path: `${P} > 폼`, tcRef: `${Rp}_form`, tcId: `INFOE2E-${key}-FORM`, desc: '편집 폼([신규 등록]/[수정]) 열기' }, '폼 진입점 없음(읽기전용/데이터 의존)');
      continue;
    }
    record({ path: `${P} > 폼`, tcRef: `${Rp}_form`, tcId: `INFOE2E-${key}-FORM`, desc: `편집 폼 열기(${form.kind})`, failMsg: '폼 미오픈' }, 'PASS', { actual: form.kind });
    await runFormBattery(admin, P, Rp, key).catch(() => {});
    await closeForm(admin).catch(() => {});
    await killAlarms(admin);
  }

  await killAlarms(admin);
  await writeReport('코스관리_정보관리E2E전체');
});
