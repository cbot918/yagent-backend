import fs from 'fs/promises';
import path from 'path';
import type { Tool } from '../tools/types.js';

const SKILLS_DIR = path.resolve('./skills');

export interface SkillSummary {
  name: string;
  description: string;
  dir: string;
}

export async function loadSkillSummaries(): Promise<SkillSummary[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(SKILLS_DIR);
  } catch {
    return [];
  }

  const summaries: SkillSummary[] = [];
  for (const entry of entries) {
    const skillFile = path.join(SKILLS_DIR, entry, 'SKILL.md');
    try {
      const raw = await fs.readFile(skillFile, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim());
      const name = lines[0]?.replace(/^#+\s*/, '').trim() ?? entry;
      const description = lines[1]?.replace(/^#+\s*/, '').trim() ?? '';
      summaries.push({ name, description, dir: entry });
    } catch {
      continue;
    }
  }
  return summaries;
}

export async function loadSkillBody(dirName: string): Promise<string> {
  const skillFile = path.join(SKILLS_DIR, dirName, 'SKILL.md');
  try {
    return await fs.readFile(skillFile, 'utf8');
  } catch {
    return `Skill "${dirName}" not found.`;
  }
}

export const loadSkillTool: Tool = {
  name: 'load_skill',
  description: 'Load the full guidance document (SKILL.md) for a skill by its directory name',
  parameters: {
    type: 'object',
    properties: {
      dir: { type: 'string', description: 'Skill directory name (e.g. "note-taking")' },
    },
    required: ['dir'],
  },
  async run(args) {
    const { dir } = args as { dir: string };
    return loadSkillBody(dir);
  },
};
