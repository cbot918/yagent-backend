import { EventEmitter } from 'events';
import type { UsageEntry } from './usage/types.js';

/**
 * Structured events emitted by the agent loop so observers (e.g. the web UI)
 * can watch the workflow live — every loop iteration, tool call, and reply.
 * This is separate from the console.logs in agent.ts, which stay for the
 * terminal demo. All events carry the originating session + channel + timestamp.
 */
export interface BaseEvent {
  sessionKey: string;
  channel: string;
  /** Active virtual-company role id for this turn, if any. */
  roleId?: string;
  ts: number;
}

export type AgentEvent =
  | (BaseEvent & { type: 'turn:start'; text: string })
  | (BaseEvent & {
      type: 'llm:response';
      iteration: number;
      content?: string;
      toolCalls?: { name: string; args: Record<string, unknown> }[];
    })
  | (BaseEvent & { type: 'tool:call'; iteration: number; name: string; args: Record<string, unknown> })
  | (BaseEvent & { type: 'tool:result'; iteration: number; name: string; result: string })
  | (BaseEvent & { type: 'turn:end'; finalText: string; iterations: number })
  // Sub-harness (coding agent) dispatch — streamed so the UI can render a
  // delegated coding task's progress live, separate from the orchestrator loop.
  | (BaseEvent & { type: 'dispatch:start'; taskId: string; agent: string; task: string; cwd: string })
  | (BaseEvent & { type: 'dispatch:event'; taskId: string; kind: string; text: string })
  | (BaseEvent & {
      type: 'dispatch:end';
      taskId: string;
      summary: string;
      costUSD?: number;
      isError: boolean;
      exitCode: number;
    })
  // Cost/budget metering — so the dashboard updates spend live and warns on caps.
  | (BaseEvent & { type: 'cost:update'; entry: UsageEntry })
  | (BaseEvent & {
      type: 'budget:alert';
      budgetId: string;
      scope: string;
      match?: string;
      usedUSD: number;
      limitUSD: number;
    });

const EVENT = 'event';

class AgentBus extends EventEmitter {
  emitEvent(event: AgentEvent) {
    this.emit(EVENT, event);
  }

  onEvent(listener: (event: AgentEvent) => void) {
    this.on(EVENT, listener);
    return () => this.off(EVENT, listener);
  }
}

/** Global singleton — channel-agnostic, so the UI sees every channel's activity. */
export const bus = new AgentBus();
// The bus can have many WebSocket subscribers; lift the default cap.
bus.setMaxListeners(0);
