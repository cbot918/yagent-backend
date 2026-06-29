import fs from 'fs/promises';
import path from 'path';

// L2 knowledge base: a file-first, on-demand document library (files-as-truth,
// mirrors skills/ and roles/). Progressive disclosure — INDEX.md is injected
// into the system prompt as an always-on map; full docs are pulled on demand via
// the read_doc / search_knowledge tools. No vector store, no fine-tuning.
const KNOWLEDGE_DIR = path.resolve('./knowledge');

/** Resolve a doc path and reject anything that escapes the knowledge root. */
export function resolveInKnowledge(rel: string): string | null {
  const fullPath = path.resolve(KNOWLEDGE_DIR, rel);
  const r = path.relative(KNOWLEDGE_DIR, fullPath);
  if (r === '' || r.startsWith('..') || path.isAbsolute(r)) return null;
  return fullPath;
}

/** Recursively list every markdown doc, as paths relative to knowledge/. */
export async function listDocs(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(path.relative(KNOWLEDGE_DIR, full));
    }
  }
  await walk(KNOWLEDGE_DIR);
  return out.sort();
}

/** The always-on map injected into the system prompt. Empty if no INDEX yet. */
export async function readIndex(): Promise<string> {
  const p = resolveInKnowledge('INDEX.md');
  if (!p) return '';
  try {
    return (await fs.readFile(p, 'utf8')).trim();
  } catch {
    return '';
  }
}

/** Read one doc by its knowledge-relative path. */
export async function readDoc(rel: string): Promise<string> {
  const full = resolveInKnowledge(rel);
  if (!full) return `Error: path outside knowledge base`;
  try {
    return await fs.readFile(full, 'utf8');
  } catch {
    return `Error: doc "${rel}" not found. Use the INDEX or search_knowledge to find valid paths.`;
  }
}

export interface KnowledgeHit {
  doc: string;
  line: number;
  snippet: string;
}

/**
 * Grep-style search across the knowledge base (case-insensitive, all query
 * terms must appear in the file). Returns matching lines with context — enough
 * for the agent to decide which doc to read_doc in full.
 */
export async function searchKnowledge(query: string, maxHits = 20): Promise<KnowledgeHit[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const docs = await listDocs();
  const hits: KnowledgeHit[] = [];

  for (const doc of docs) {
    const full = resolveInKnowledge(doc);
    if (!full) continue;
    let content = '';
    try {
      content = await fs.readFile(full, 'utf8');
    } catch {
      continue;
    }
    const lower = content.toLowerCase();
    // Require every term somewhere in the doc (AND), then surface matching lines.
    if (!terms.every((t) => lower.includes(t) || doc.toLowerCase().includes(t))) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
      const l = lines[i].toLowerCase();
      if (terms.some((t) => l.includes(t))) {
        hits.push({ doc, line: i + 1, snippet: lines[i].trim().slice(0, 200) });
      }
    }
    // A doc matched by filename only (no line hit) — still point at it.
    if (!hits.some((h) => h.doc === doc) && terms.some((t) => doc.toLowerCase().includes(t))) {
      hits.push({ doc, line: 1, snippet: '(matched by filename)' });
    }
    if (hits.length >= maxHits) break;
  }
  return hits;
}
