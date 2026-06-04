import fs from 'fs/promises';
import path from 'path';
import type { Tool } from './types.js';

/** Resolve a user-supplied path and reject anything that escapes the workspace. */
export function resolveInWorkspace(workspaceDir: string, filename: string): string | null {
  const fullPath = path.resolve(workspaceDir, filename);
  const rel = path.relative(workspaceDir, fullPath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return fullPath;
}

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file in the workspace',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Path relative to workspace root' },
    },
    required: ['filename'],
  },
  async run(args, ctx) {
    const { filename } = args as { filename: string };
    const fullPath = resolveInWorkspace(ctx.workspaceDir, filename);
    if (!fullPath) return 'Error: path outside workspace';
    return fs.readFile(fullPath, 'utf8');
  },
};
