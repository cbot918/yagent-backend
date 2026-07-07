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
  /** OR a markdown file (path relative to project root) whose content is the persona. */
  systemPromptFile?: string;
  /** OR a skill dir whose SKILL.md body is used as the persona. */
  skill?: string;
  /** Orchestrator model override (OpenAI/OpenRouter id). undefined = default. */
  model?: string;
  /** Coding harness this role dispatches to by default. undefined = default. */
  codingAgent?: 'claude' | 'opencode';
  /** Threads data backend for threads_trend: 'ensembledata' (metered API) | 'browser' (free scrape). undefined = default. */
  threadsSource?: 'ensembledata' | 'browser';
  /** Optional tool allowlist (names). undefined/empty = all tools. */
  tools?: string[];
  /**
   * Default action mode. 'act' = can use mutating tools (write/shell/dispatch);
   * 'advise' = read-only (advisory). undefined = 'act'. A session can override
   * this per turn (like plan/edit mode).
   */
  actionMode?: 'act' | 'advise';
  /**
   * Skill dirs this role owns — listed as "your skills" in the prompt (the role
   * can still load_skill any installed skill). undefined/empty = all skills.
   */
  skills?: string[];
  /**
   * Knowledge docs (paths relative to knowledge/) this role should know about —
   * injected as "your reference docs" and retrievable via read_doc.
   */
  knowledge?: string[];
}
