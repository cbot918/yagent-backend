import type { Tool } from '../tools/types.js';
import type { Channel } from '../channels/types.js';

export interface PluginContext {
  registerTool(tool: Tool): void;
  registerChannel(channel: Channel): void;
}

export interface Plugin {
  name: string;
  init(ctx: PluginContext): void | Promise<void>;
}
