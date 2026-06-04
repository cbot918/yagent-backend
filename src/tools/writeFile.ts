import fs from 'fs/promises';
import path from 'path';
import type { Tool } from './types.js';
import { resolveInWorkspace } from './readFile.js';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file in the workspace (creates directories if needed)',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Path relative to workspace root' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['filename', 'content'],
  },
  async run(args, ctx) {
    const { filename, content } = args as { filename: string; content: string };
    const fullPath = resolveInWorkspace(ctx.workspaceDir, filename);
    if (!fullPath) return 'Error: path outside workspace';
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    return `Written ${content.length} chars to ${filename}`;
  },
};
