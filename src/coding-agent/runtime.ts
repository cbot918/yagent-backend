import type { ChildProcess } from 'child_process';

/**
 * Track spawned harness child processes so they can be force-killed on
 * shutdown (same shutdown-cleanup contract as the sandbox executors).
 */
const children = new Set<ChildProcess>();

export function track(child: ChildProcess) {
  children.add(child);
  child.once('close', () => children.delete(child));
}

export function killAll() {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  children.clear();
}
