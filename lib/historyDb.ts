/**
 * P3-D 이력 트렌드 DB — node:sqlite (Node v22+ 내장, v24 stable)
 *
 * DB 위치: reports/history.db
 * 스키마:
 *   runs      — 실행 1회 집계 (title, ts, total/pass/fail/skip, pass_rate)
 *   run_menus — 해당 실행의 대메뉴별 세부 집계
 *
 * appendRun()은 reporter.ts writeReport() 말미에서 호출.
 * generateDashboard.ts(스크립트)는 load* 함수로 읽어 정적 HTML 생성.
 */

// node:sqlite은 Node v22.5+ 실험적, v22.12+ stable. Node v24에서 완전 stable.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

import path from 'path';
import fs from 'fs';
import type { TCResult } from './reporter';

const DB_PATH = path.join(process.cwd(), 'reports', 'history.db');

function open(): InstanceType<typeof import('node:sqlite').DatabaseSync> {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      title     TEXT    NOT NULL,
      ts        TEXT    NOT NULL,
      total     INTEGER NOT NULL DEFAULT 0,
      pass      INTEGER NOT NULL DEFAULT 0,
      fail      INTEGER NOT NULL DEFAULT 0,
      skip      INTEGER NOT NULL DEFAULT 0,
      pass_rate REAL    NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS run_menus (
      run_id  INTEGER NOT NULL,
      menu    TEXT    NOT NULL,
      total   INTEGER NOT NULL DEFAULT 0,
      pass    INTEGER NOT NULL DEFAULT 0,
      fail    INTEGER NOT NULL DEFAULT 0,
      skip    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_runs_title_ts ON runs (title, ts);
    CREATE INDEX IF NOT EXISTS idx_run_menus_run ON run_menus (run_id);
  `);
  return db;
}

export type RunRow  = { id: number; title: string; ts: string; total: number; pass: number; fail: number; skip: number; pass_rate: number };
export type MenuRow = { run_id: number; menu: string; total: number; pass: number; fail: number; skip: number };

/** 테스트 실행 1회 결과를 DB에 추가 (reporter.writeReport에서 호출) */
export function appendRun(
  title: string,
  results: TCResult[],
  menuGroups: Map<string, TCResult[]>,
): void {
  const db = open();
  try {
    const pass  = results.filter(r => r.status === 'PASS').length;
    const fail  = results.filter(r => r.status === 'FAIL').length;
    const skip  = results.filter(r => r.status === 'SKIP').length;
    const total = results.length;
    const pass_rate = (pass + fail) > 0 ? Math.round(pass / (pass + fail) * 100) : 0;
    const ts = new Date().toISOString();

    const insRun = db.prepare(
      `INSERT INTO runs (title, ts, total, pass, fail, skip, pass_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const { lastInsertRowid } = insRun.run(title, ts, total, pass, fail, skip, pass_rate);
    const runId = lastInsertRowid as number;

    const insMenu = db.prepare(
      `INSERT INTO run_menus (run_id, menu, total, pass, fail, skip)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const [menu, rows] of menuGroups) {
      const mp = rows.filter(r => r.status === 'PASS').length;
      const mf = rows.filter(r => r.status === 'FAIL').length;
      const ms = rows.filter(r => r.status === 'SKIP').length;
      insMenu.run(runId, menu, rows.length, mp, mf, ms);
    }
    console.log(`[history] 기록 완료 run_id=${runId} title=${title} total=${total} PASS=${pass} FAIL=${fail}`);
  } finally {
    db.close();
  }
}

/** 스위트 제목 목록 (대시보드 탭 구성용) */
export function loadTitles(): string[] {
  const db = open();
  try {
    return (db.prepare(
      `SELECT DISTINCT title FROM runs ORDER BY title`,
    ).all() as { title: string }[]).map(r => r.title);
  } finally { db.close(); }
}

/** 특정 스위트의 실행 이력 (시간 오름차순, 최근 N회) */
export function loadRuns(title: string, limit = 30): RunRow[] {
  const db = open();
  try {
    return db.prepare(
      `SELECT * FROM runs WHERE title = ?
       ORDER BY ts ASC LIMIT ?`,
    ).all(title, limit) as RunRow[];
  } finally { db.close(); }
}

/** 대메뉴별 세부 집계 (특정 run_id) */
export function loadRunMenus(runId: number): MenuRow[] {
  const db = open();
  try {
    return db.prepare(
      `SELECT * FROM run_menus WHERE run_id = ? ORDER BY menu`,
    ).all(runId) as MenuRow[];
  } finally { db.close(); }
}
