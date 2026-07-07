import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

/**
 * Monitor log for the threads_trend tool (files-as-truth, like sessions/usage).
 *
 * Every real call to the Threads API — success or failure — appends one line to
 * `.monitor/threads.jsonl`. This is what powers the sidebar "Monitor" panel and,
 * crucially, lets us report the *actual* call count instead of letting the model
 * guess (it was hallucinating "已用 4 次"). It also records the raw HTTP status and
 * a preview of what came back, so quota-exhaustion (HTTP 495) is visible at a glance.
 */

export interface ThreadsLogEntry {
  ts: number;
  keyword: string;
  sort: 'top' | 'recent';
  /** Which backend served this call: 'ensembledata' | 'browser'. */
  source: string;
  ok: boolean;
  /** HTTP status; 0 = the request never completed (network/timeout). */
  httpStatus: number;
  /** Posts parsed out of a successful response. */
  resultCount: number;
  /** Units the API says it charged, when it reports them. */
  units?: number;
  /** Error detail when !ok (e.g. the quota-exceeded message). */
  error?: string;
  /** Short preview of the returned data (top posts) for the log UI. */
  preview?: string;
}

const LOG_DIR = path.join(config.workspaceDir, '.monitor');
const LOG_FILE = path.join(LOG_DIR, 'threads.jsonl');

export async function appendThreadsLog(entry: ThreadsLogEntry): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

/** Read the log newest-first, capped at `limit` entries. */
export async function readThreadsLog(limit = 200): Promise<ThreadsLogEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(LOG_FILE, 'utf8');
  } catch {
    return [];
  }
  const entries = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ThreadsLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ThreadsLogEntry => e != null);
  return entries.reverse().slice(0, limit);
}

/** How many calls were made so far today (local date), for the "第 N 次" counter. */
export async function countToday(): Promise<number> {
  const entries = await readThreadsLog(1000);
  const today = new Date().toDateString();
  return entries.filter((e) => new Date(e.ts).toDateString() === today).length;
}
