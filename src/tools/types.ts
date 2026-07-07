export interface ToolContext {
  sessionKey: string;
  workspaceDir: string;
  /** Originating channel name — so tools (e.g. dispatch) can emit bus events. */
  channel: string;
  /** Active virtual-company role id, when the turn is bound to a role. */
  roleId?: string;
  /** Default coding harness for this turn's role (dispatch_coding_task). */
  codingAgent?: string;
  /** Threads data backend for this turn's role (threads_trend): 'ensembledata' | 'browser'. */
  threadsSource?: string;
  /** Delegation nesting depth (0 = top-level user turn). Guards delegate_to_role recursion. */
  delegationDepth?: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  getAll(): Tool[] {
    return [...this.tools.values()];
  }

  async run(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: unknown tool "${name}"`;
    try {
      return await tool.run(args, ctx);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  toOpenAIFormat() {
    return this.getAll().map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}
