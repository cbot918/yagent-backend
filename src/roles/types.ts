/**
 * A Role = one "virtual-company member" the user can pick to talk to
 * (manual switchboard). A role is just a persona (inline system prompt or a
 * referenced skill) plus which orchestrator model and which coding harness it
 * uses. The agent loop is generic; a role parameterizes it per turn.
 */
export interface Role {
  id: string;
  name: string;
  /** Display subtitle, e.g. "Chief Executive". */
  title?: string;
  /** Card glyph for the web grid. */
  emoji?: string;
  description: string;
  /** Inline persona / system prompt. */
  systemPrompt?: string;
  /** OR a skill dir whose SKILL.md body is used as the persona. */
  skill?: string;
  /** Orchestrator model override (OpenAI/OpenRouter id). undefined = default. */
  model?: string;
  /** Coding harness this role dispatches to by default. undefined = default. */
  codingAgent?: 'claude' | 'opencode';
  /** Optional tool allowlist (names). undefined/empty = all tools. */
  tools?: string[];
}
