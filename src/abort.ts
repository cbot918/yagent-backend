import { killSession } from './coding-agent/runtime.js';
import { normalizeSessionKey } from './session.js';
/**
 * Cooperative cancellation for a running turn.
 *
 * A turn is a loop of LLM calls and blocking tool runs, not a single awaited request, so
 * there is nothing to `AbortController.abort()` at the top. Instead the loop asks this
 * registry between iterations and gives up at the next safe point — after the in-flight tool
 * finishes, so nothing is left half-written.
 *
 * Sub-sessions (`<caller>::<role>` from delegate_to_role, `room:<id>::<role>`) are cancelled
 * with their parent: aborting the caller has to stop the delegate too, otherwise the visible
 * turn ends while a harness keeps burning budget underneath it.
 */

const aborting = new Set<string>();

/**
 * Mark a session (and its sub-sessions) for cancellation, and kill any coding-harness
 * process it has in flight.
 *
 * The flag alone only stops the loop between iterations — a dispatch that is mid-run would
 * keep going for minutes and keep spending. Killing the child makes the harness call return
 * immediately, so the loop reaches its next check within seconds instead of at timeout.
 */
export function requestAbort(sessionKey: string): { killedProcesses: number } {
  aborting.add(sessionKey);
  const killedProcesses = killSession(sessionKey);
  if (killedProcesses > 0) {
    console.log(`[abort] session=${sessionKey} killed ${killedProcesses} harness process(es)`);
  }
  return { killedProcesses };
}

/**
 * True if this session, or a session it descends from, was aborted.
 *
 * Keys are compared in their filename-safe form because the UI gets its session list from
 * disk, where `parent::role` is stored as `parent__role`. A raw `===` would make "stop" a
 * no-op on exactly the delegate sub-sessions most worth stopping.
 */
export function isAborting(sessionKey: string): boolean {
  const me = normalizeSessionKey(sessionKey);
  for (const key of aborting) {
    const other = normalizeSessionKey(key);
    if (me === other || me.startsWith(`${other}__`)) return true;
  }
  return false;
}

/**
 * Clear the flag once a turn has actually stopped. Called by the loop that observed the
 * abort, so a stale flag can't silently kill the user's *next* message.
 */
export function clearAbort(sessionKey: string): void {
  const me = normalizeSessionKey(sessionKey);
  for (const key of [...aborting]) {
    const other = normalizeSessionKey(key);
    if (other === me || me.startsWith(`${other}__`) || other.startsWith(`${me}__`)) {
      aborting.delete(key);
    }
  }
}

/** Sessions currently marked for cancellation (for diagnostics / the UI). */
export function listAborting(): string[] {
  return [...aborting];
}
