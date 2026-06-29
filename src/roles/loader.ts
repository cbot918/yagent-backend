import fs from 'fs/promises';
import path from 'path';
import { loadSkillBody } from '../skills/loader.js';
import type { Role } from './types.js';

export type { Role } from './types.js';

// Roles live as data (files-as-truth), so adding a "team member" is editing
// JSON — no code change. Mirrors the skills/ convention.
const ROLES_FILE = path.resolve('./roles/roles.json');

export const DEFAULT_ROLE: Role = {
  id: 'assistant',
  name: 'Assistant',
  emoji: '🤖',
  description: 'General-purpose orchestrator.',
  systemPrompt:
    'You are a helpful, concise orchestrator. Plan the task, use tools, and delegate heavy coding via dispatch_coding_task.',
};

export async function loadRoles(): Promise<Role[]> {
  try {
    const raw = await fs.readFile(ROLES_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { roles?: Role[] };
    const roles = parsed.roles ?? [];
    return roles.length ? roles : [DEFAULT_ROLE];
  } catch {
    return [DEFAULT_ROLE];
  }
}

export async function getRole(id?: string): Promise<Role> {
  if (!id) return DEFAULT_ROLE;
  const roles = await loadRoles();
  return roles.find((r) => r.id === id) ?? DEFAULT_ROLE;
}

/** The role's persona text: inline systemPrompt, else referenced skill body. */
export async function resolvePersona(role: Role): Promise<string> {
  if (role.systemPrompt) return role.systemPrompt;
  if (role.skill) return loadSkillBody(role.skill);
  return DEFAULT_ROLE.systemPrompt!;
}
