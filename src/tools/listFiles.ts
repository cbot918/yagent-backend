import fs from 'fs/promises';
import path from 'path';
import type { Tool } from './types.js';

export const listFilesTool: Tool = {
  name: 'list_files',
  description: 'List files and directories in the workspace',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: 'Subdirectory to list (relative to workspace, default ".")' },
    },
    required: [],
  },
  async run(args, ctx) {
    const { dir = '.' } = args as { dir?: string };
    const fullPath = path.resolve(ctx.workspaceDir, dir);
    if (!fullPath.startsWith(ctx.workspaceDir)) return 'Error: path outside workspace';
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const visible = entries.filter((e) => !e.name.startsWith('.'));
      if (visible.length === 0) return 'Directory is empty.';
      return visible.map((e) => `${e.isDirectory() ? '[dir] ' : '[file]'} ${e.name}`).join('\n');
    } catch {
      return 'Directory not found.';
    }
  },
};
