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

/** Fields the settings UI is allowed to edit (persona/identity stays immutable here). */
export type RolePatch = Partial<
  Pick<Role, 'model' | 'codingAgent' | 'threadsSource' | 'tools' | 'skills' | 'knowledge' | 'actionMode'>
>;

/**
 * Persist an edit to one role's configurable fields back to roles.json
 * (files-as-truth). Only whitelisted fields are written; persona text and
 * identity are untouched. Returns the updated role.
 */
export async function saveRole(id: string, patch: RolePatch): Promise<Role> {
  const raw = await fs.readFile(ROLES_FILE, 'utf8');
  const parsed = JSON.parse(raw) as { roles: Role[] };
  const role = parsed.roles?.find((r) => r.id === id);
  if (!role) throw new Error(`Unknown role "${id}"`);

  const allowed: (keyof RolePatch)[] = ['model', 'codingAgent', 'threadsSource', 'tools', 'skills', 'knowledge', 'actionMode'];
  const target = role as unknown as Record<string, unknown>;
  for (const key of allowed) {
    if (key in patch) {
      const val = patch[key];
      if (val === undefined || val === null) delete target[key];
      else target[key] = val;
    }
  }

  await fs.writeFile(ROLES_FILE, JSON.stringify(parsed, null, 2) + '\n');
  return role;
}

/** The role's persona text: inline systemPrompt, else persona file, else referenced skill body. */
export async function resolvePersona(role: Role): Promise<string> {
  if (role.systemPrompt) return role.systemPrompt;
  if (role.systemPromptFile) {
    try {
      return await fs.readFile(path.resolve(role.systemPromptFile), 'utf8');
    } catch {
      // missing/unreadable persona file → fall through to remaining sources
    }
  }
  if (role.skill) return loadSkillBody(role.skill);
  return DEFAULT_ROLE.systemPrompt!;
}
