import type { ChildProcess } from 'child_process';
import { normalizeSessionKey } from '../session.js';

/**
 * Track spawned harness child processes so they can be force-killed — on shutdown (same
 * contract as the sandbox executors) or when the session that started them is cancelled.
 *
 * A dispatch is the expensive part of a turn: cancelling the agent loop while a Claude/Codex
 * run keeps going would stop the visible work and keep burning the budget underneath. So each
 * child remembers which session it belongs to.
 */
const children = new Map<ChildProcess, string | undefined>();

export function track(child: ChildProcess, sessionKey?: string) {
  children.set(child, sessionKey);
  child.once('close', () => children.delete(child));
}

function kill(child: ChildProcess) {
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

/**
 * Kill the harness processes started by a session — including its delegate sub-sessions
 * (`<caller>::<role>`), which is where a runaway dispatch usually lives.
 * Returns how many were killed, so the caller can report whether anything was really stopped.
 */
export function killSession(sessionKey: string): number {
  const me = normalizeSessionKey(sessionKey);
  let killed = 0;
  for (const [child, key] of children) {
    const owner = key ? normalizeSessionKey(key) : undefined;
    if (owner && (owner === me || owner.startsWith(`${me}__`))) {
      kill(child);
      children.delete(child);
      killed++;
    }
  }
  return killed;
}

export function killAll() {
  for (const c of children.keys()) kill(c);
  children.clear();
}
