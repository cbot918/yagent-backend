/**
 * Shell execution is pluggable behind this interface so the dangerous
 * "run a command" capability can be confined by a real sandbox. Backends:
 *   - host   : runs on the host, NO isolation — dev only
 *   - docker : per-session hardened container (free, local, needs Docker)
 *   - e2b    : per-session Firecracker microVM (managed; works without Docker)
 *
 * Sandboxes are keyed by sessionKey and reused across commands within a chat,
 * so `cd`, installed packages, and files persist — the realistic agent pattern.
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** true if output was clipped to the size cap */
  truncated: boolean;
}

export interface ExecOptions {
  timeoutMs: number;
}

export interface Executor {
  /** Backend id, for logging. */
  readonly name: string;
  /** Run a shell command in the session's sandbox (lazily created). */
  exec(sessionKey: string, command: string, opts: ExecOptions): Promise<ExecResult>;
  /** Tear down one session's sandbox. */
  dispose(sessionKey: string): Promise<void>;
  /** Tear down every sandbox (process shutdown). */
  disposeAll(): Promise<void>;
}
