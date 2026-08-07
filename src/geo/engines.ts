import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { complete } from '../llm.js';
import { meterCompletion } from './meter.js';
import type { GeoEngine } from './types.js';

/** Load the probing-engine roster (files-as-truth, editable). */
export async function loadEngines(): Promise<GeoEngine[]> {
  const raw = await fs.readFile(path.resolve(config.geoEnginesFile), 'utf8');
  const parsed = JSON.parse(raw) as { engines?: GeoEngine[] };
  return parsed.engines ?? [];
}

// A prospect asking an AI is a normal user, not a power-user with a fancy
// system prompt. Keep the framing minimal so answers approximate what a real
// user sees, and pin the language so results are comparable.
const PROBE_SYSTEM =
  '你是使用者日常會問到的 AI 助理。用繁體中文自然、具體地回答使用者的問題;' +
  '如果會推薦公司、產品或工具,就直接點名。';

export interface ProbeResult {
  answer: string;
  costUSD: number;
}

/**
 * Ask one engine one question. Returns the model's actual answer. All engines
 * route through the shared OpenAI-compatible client (OpenRouter): a `closed`
 * model answers from training memory, an `open` model (e.g. Perplexity Sonar)
 * does live web retrieval — both are valid GEO signals.
 */
export async function probe(sessionKey: string, engine: GeoEngine, question: string): Promise<ProbeResult> {
  const res = await complete(
    [
      { role: 'system', content: PROBE_SYSTEM },
      { role: 'user', content: question },
    ],
    [],
    engine.model,
  );
  const costUSD = await meterCompletion(sessionKey, engine.model, res);
  const answer = res.choices[0]?.message?.content?.trim() ?? '';
  return { answer, costUSD };
}
