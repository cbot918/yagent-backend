import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import type { Tool } from '../tools/types.js';

function memoryPath(sessionKey: string) {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(config.workspaceDir, '.memory', `${safe}.md`);
}

export async function readMemory(sessionKey: string): Promise<string> {
  try {
    return await fs.readFile(memoryPath(sessionKey), 'utf8');
  } catch {
    return '';
  }
}

async function writeMemory(sessionKey: string, content: string) {
  const p = memoryPath(sessionKey);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
}

export async function getMemoryContext(sessionKey: string): Promise<string> {
  const mem = await readMemory(sessionKey);
  return mem.trim() || 'No memory yet.';
}

export const saveMemoryTool: Tool = {
  name: 'save_memory',
  description: 'Persist important information to memory (survives session restarts). Overwrites the full memory doc.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Full markdown content to save as memory (include all existing facts you want to keep)',
      },
    },
    required: ['content'],
  },
  async run(args, ctx) {
    const { content } = args as { content: string };
    await writeMemory(ctx.sessionKey, content);
    return 'Memory saved.';
  },
};
