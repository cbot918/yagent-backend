import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import type { Tool } from './types.js';

/**
 * Read-only access to the other repos on this machine, rooted at `PROJECTS_ROOT`.
 *
 * Why a separate root instead of just pointing WORKSPACE_DIR higher: the workspace root also
 * governs `write_file` and `shell`, and `.sessions`/`.memory` live inside it — moving it would
 * widen the write surface and orphan existing session state. This mirrors what
 * `resolveInKnowledge` already does for `knowledge/`: one more guarded root, read-only tools
 * only. There is deliberately no project-write tool; changing another repo goes through
 * `dispatch_coding_task`, which runs a real harness in that directory.
 */

const MAX_FILE_CHARS = 20000;
const MAX_ENTRIES = 200;
/** Directories that are never worth listing to a model. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', 'coverage', '.venv']);

type Resolved =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Resolve a path inside PROJECTS_ROOT. Containment is checked twice — lexically, then again
 * after `realpath` — so a symlink inside a repo can't read outside the root.
 *
 * "Outside the root" and "doesn't exist" are reported as *different* errors on purpose. Fold
 * them into one message and a model that simply mistyped a path reads it as "this area is
 * forbidden", then keeps guessing new paths instead of correcting the typo.
 */
export async function resolveInProjects(rel: string): Promise<Resolved> {
  if (!config.projectsRoot) {
    return { ok: false, error: 'PROJECTS_ROOT is not configured, so no project files are readable.' };
  }
  const root = config.projectsRoot;

  const full = path.resolve(root, rel);
  const lexical = path.relative(root, full);
  if (lexical.startsWith('..') || path.isAbsolute(lexical)) {
    return { ok: false, error: `"${rel}" is outside the projects root (${root}). Only paths under it are readable.` };
  }

  let real: string;
  try {
    real = await fs.realpath(full);
  } catch {
    // Point at the deepest ancestor that DOES exist, so the next call can be a correction
    // rather than another guess.
    const hint = await nearestExisting(full, root);
    return {
      ok: false,
      error:
        `"${rel}" does not exist. (This path IS inside the projects root — it is a wrong path, not a blocked one.)` +
        (hint ? `\nNearest existing directory: ${hint}\nList that with list_project_files to see what is actually there.` : ''),
    };
  }

  const afterLinks = path.relative(await fs.realpath(root), real);
  if (afterLinks.startsWith('..') || path.isAbsolute(afterLinks)) {
    return { ok: false, error: `"${rel}" resolves through a symlink to somewhere outside the projects root.` };
  }
  return { ok: true, path: real };
}

/** Walk up from a missing path to the deepest ancestor that exists, stopping at the root. */
async function nearestExisting(full: string, root: string): Promise<string | null> {
  let dir = path.dirname(full);
  while (dir.startsWith(root) && dir !== path.dirname(dir)) {
    try {
      if ((await fs.stat(dir)).isDirectory()) return dir;
    } catch {
      // keep climbing
    }
    dir = path.dirname(dir);
  }
  return null;
}

/** Accept an absolute path under the root as well — models naturally paste absolute paths. */
function toRelative(input: string): string {
  if (config.projectsRoot && path.isAbsolute(input)) {
    return path.relative(config.projectsRoot, input);
  }
  return input;
}

/** Bounded recursive walk. Returns `dir/file` paths relative to `base`. */
async function walk(base: string, depth: number, match: string | undefined): Promise<string[]> {
  const out: string[] = [];
  const needle = match?.toLowerCase();

  async function visit(dir: string, level: number): Promise<void> {
    if (out.length >= MAX_ENTRIES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_ENTRIES) return;
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
      const rel = path.relative(base, path.join(dir, e.name));
      const hit = !needle || e.name.toLowerCase().includes(needle);
      if (hit) out.push(e.isDirectory() ? `  dir   ${rel}` : `  file  ${rel}`);
      if (e.isDirectory() && level < depth) await visit(path.join(dir, e.name), level + 1);
    }
  }

  await visit(base, 1);
  return out.sort();
}

export const listProjectFilesTool: Tool = {
  name: 'list_project_files',
  description:
    "List files and directories inside another project on this machine (read-only). Paths may be relative to the projects root or the absolute path you were handed. Noise directories (node_modules, .git, dist, build, target, …) are always skipped. " +
    "Don't hunt for a file by listing one directory after another — pass `match` to search by filename and raise `depth` to look deeper in a single call.",
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory to list, e.g. "form-platform-server" or its absolute path. Omit for the projects root.',
      },
      depth: {
        type: 'number',
        description: 'How many directory levels to descend (1 = just this directory, max 6). Use 3-6 with `match` to locate a file you cannot place.',
      },
      match: {
        type: 'string',
        description: 'Only report entries whose NAME contains this text (case-insensitive), e.g. "activity" or ".dto.ts". Combine with depth to find a file by name.',
      },
    },
  },
  async run(args) {
    const { path: input, depth, match } = (args ?? {}) as { path?: string; depth?: number; match?: string };
    const levels = Math.min(Math.max(Math.round(depth ?? 1), 1), 6);

    const resolved = await resolveInProjects(toRelative(input ?? '.') || '.');
    if (!resolved.ok) return `Error: ${resolved.error}`;

    let stat;
    try {
      stat = await fs.stat(resolved.path);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (!stat.isDirectory()) return `Error: "${input}" is a file — use read_project_file.`;

    const listed = await walk(resolved.path, levels, match);
    if (!listed.length) {
      return match
        ? `${resolved.path}\n  (nothing matching "${match}" within ${levels} level(s) — try a shorter match or a larger depth)`
        : `${resolved.path}\n  (empty)`;
    }

    const capped = listed.length >= MAX_ENTRIES ? `\n  (stopped at the ${MAX_ENTRIES}-entry cap — narrow with \`match\`)` : '';
    const scope = `${resolved.path}${match ? ` — matching "${match}"` : ''}${levels > 1 ? `, depth ${levels}` : ''}`;
    return `${scope}\n${listed.join('\n')}${capped}`;
  },
};

export const readProjectFileTool: Tool = {
  name: 'read_project_file',
  description:
    'Read one file from another project on this machine (read-only). Paths may be relative to the projects root or absolute. Reach for this to understand a project\'s current state from its own files — CLAUDE.md, README.md, progress.md, HANDOFF.md, package.json — instead of dispatching a coding agent just to read something. Large files are truncated.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File to read, e.g. "form-platform-server/progress.md" or its absolute path.',
      },
    },
    required: ['path'],
  },
  async run(args) {
    const { path: input } = args as { path: string };

    const resolved = await resolveInProjects(toRelative(input));
    if (!resolved.ok) return `Error: ${resolved.error}`;

    let stat;
    try {
      stat = await fs.stat(resolved.path);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (stat.isDirectory()) return `Error: "${input}" is a directory — use list_project_files.`;

    let text: string;
    try {
      text = await fs.readFile(resolved.path, 'utf8');
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    return text.length > MAX_FILE_CHARS
      ? `${text.slice(0, MAX_FILE_CHARS)}\n\n… truncated (${text.length - MAX_FILE_CHARS} more chars)`
      : text;
  },
};
