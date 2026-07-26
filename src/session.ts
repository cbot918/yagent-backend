import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

const locks = new Map<string, Promise<void>>();

export async function withSessionLock<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(sessionKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => { release = r; });
  locks.set(sessionKey, current);
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

/**
 * Filename-safe form of a session key. Note this is lossy: a delegate sub-session
 * `parent::role` lands on disk as `parent__role`, so anything that reads keys back from the
 * filesystem (the /api/sessions listing, hence the UI) sees the underscore spelling while the
 * runtime still uses `::`. Compare keys through here rather than with `===`.
 */
export function normalizeSessionKey(sessionKey: string): string {
  return sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sessionPath(sessionKey: string) {
  return path.join(config.workspaceDir, '.sessions', `${normalizeSessionKey(sessionKey)}.json`);
}

export async function loadSession(sessionKey: string): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(sessionPath(sessionKey), 'utf8');
    return (JSON.parse(raw) as { messages: unknown[] }).messages ?? [];
  } catch {
    return [];
  }
}

export async function saveSession(sessionKey: string, messages: unknown[]) {
  const p = sessionPath(sessionKey);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify({ messages }, null, 2));
}
