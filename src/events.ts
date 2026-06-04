import { EventEmitter } from 'events';

/**
 * Structured events emitted by the agent loop so observers (e.g. the web UI)
 * can watch the workflow live — every loop iteration, tool call, and reply.
 * This is separate from the console.logs in agent.ts, which stay for the
 * terminal demo. All events carry the originating session + channel + timestamp.
 */
export interface BaseEvent {
  sessionKey: string;
  channel: string;
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
  | (BaseEvent & { type: 'turn:end'; finalText: string; iterations: number });

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
