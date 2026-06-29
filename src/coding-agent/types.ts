/**
 * A "coding agent" is an external, swappable coding harness (Claude Code,
 * opencode, Codex, …) that agent-os dispatches heavy coding tasks to. This
 * mirrors the `sandbox/Executor` pattern: one interface, several backends,
 * selected by env (`CODING_AGENT`). The orchestrator stays agent-agnostic —
 * it only ever talks to this interface.
 */

export interface CodingTask {
  /** Precise, self-contained spec/instruction for the harness. */
  prompt: string;
  /** Working directory the harness runs in (the target repo/workspace). */
  cwd: string;
  /** Optional extra context (project facts/memory) prepended to the prompt. */
  context?: string;
}

export type NormalizedEventKind = 'text' | 'tool' | 'status' | 'error';

/**
 * A harness's native streaming output (Claude's NDJSON, opencode's stdout, …)
 * normalized to a tiny common shape so the orchestrator/UI can render any
 * harness identically.
 */
export interface NormalizedEvent {
  kind: NormalizedEventKind;
  text: string;
}

export interface CodingResult {
  /** Final assistant text / diff summary returned to the orchestrator loop. */
  summary: string;
  /** Whether the harness reported a failure. */
  isError: boolean;
  /** Cost in USD, if the harness reports it (Claude does; opencode may not). */
  costUSD?: number;
  /** Token usage, if reported. */
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Child process exit code (-1 if it never launched). */
  exitCode: number;
}

export interface CodingAgent {
  /** Backend id: 'claude' | 'opencode' | … (for logging/attribution). */
  readonly name: string;
  /**
   * Run the task to completion (blocking). Streams progress via `onEvent`
   * and resolves with the final result. Never throws — launch/runtime
   * failures come back as `{ isError: true }`.
   */
  run(task: CodingTask, onEvent: (e: NormalizedEvent) => void): Promise<CodingResult>;
}
