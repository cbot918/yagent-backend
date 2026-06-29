import type { Tool } from './types.js';
import { readDoc, searchKnowledge } from '../knowledge/loader.js';

export const searchKnowledgeTool: Tool = {
  name: 'search_knowledge',
  description:
    "Search the company knowledge base (knowledge/ docs) for a topic. Returns matching doc paths + line snippets. Use this to find which doc to read_doc, e.g. company strategy, brand voice, product/architecture, pricing.",
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Keywords to search for (space-separated; all must match).' },
    },
    required: ['query'],
  },
  async run(args) {
    const { query } = args as { query: string };
    const hits = await searchKnowledge(query);
    if (hits.length === 0) return `No matches for "${query}". Browse the INDEX or try broader terms.`;
    return hits.map((h) => `${h.doc}:${h.line}: ${h.snippet}`).join('\n');
  },
};

export const readDocTool: Tool = {
  name: 'read_doc',
  description:
    'Read a full document from the company knowledge base by its path (relative to knowledge/, e.g. "company/company-plan.md"). Paths come from the INDEX or search_knowledge.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Doc path relative to knowledge/ (e.g. "marketing/funnel-playbook.md").' },
    },
    required: ['path'],
  },
  async run(args) {
    const { path: docPath } = args as { path: string };
    return readDoc(docPath);
  },
};
