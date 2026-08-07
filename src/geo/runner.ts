import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { withSessionLock } from '../session.js';
import { budgetGate } from '../usage/index.js';
import { loadEngines, probe } from './engines.js';
import { judge } from './judge.js';
import { synthesize } from './synth.js';
import { saveReport } from './store.js';
import { GEO_PROVIDER } from './meter.js';
import type {
  GeoEngineResult,
  GeoInput,
  GeoQuestion,
  GeoQuestionResult,
  GeoReport,
  GeoSummary,
} from './types.js';

/** Raised when a governing budget is exceeded before the run starts. */
export class GeoBudgetError extends Error {}

export interface RunGeoOptions {
  company?: string;
  aliases?: string[];
  vertical?: string;
  market?: string;
  /** Ground-truth text; defaults to knowledge/geo/eai-profile.md. */
  groundTruth?: string;
}

interface QuestionSet {
  vertical?: string;
  market?: string;
  questions: GeoQuestion[];
}

async function loadQuestionSet(): Promise<QuestionSet> {
  const raw = await fs.readFile(path.resolve(config.geoQuestionsFile), 'utf8');
  return JSON.parse(raw) as QuestionSet;
}

async function resolveInput(opts: RunGeoOptions, qset: QuestionSet): Promise<GeoInput> {
  const groundTruth =
    opts.groundTruth ?? (await fs.readFile(path.resolve(config.geoProfileFile), 'utf8').catch(() => ''));
  return {
    company: opts.company ?? 'ElementAI',
    aliases: opts.aliases ?? ['AgentOS', 'yagent', 'AiErp'],
    vertical: opts.vertical ?? qset.vertical ?? '',
    market: opts.market ?? qset.market ?? '',
    groundTruth,
  };
}

/** Probe + judge every engine for one question (engines run concurrently). */
async function runQuestion(
  sessionKey: string,
  input: GeoInput,
  question: GeoQuestion,
  engines: Awaited<ReturnType<typeof loadEngines>>,
): Promise<{ result: GeoQuestionResult; cost: number }> {
  let cost = 0;
  const cells = await Promise.all(
    engines.map(async (engine): Promise<GeoEngineResult> => {
      const cellBase = { engineId: engine.id, engineLabel: engine.label, mode: engine.mode, model: engine.model };
      try {
        const p = await probe(sessionKey, engine, question.text);
        cost += p.costUSD;
        const j = await judge(sessionKey, input, question, p.answer);
        cost += j.costUSD;
        return { ...cellBase, rawAnswer: p.answer.slice(0, 4000), verdict: j.verdict };
      } catch (err) {
        return {
          ...cellBase,
          rawAnswer: '',
          verdict: { mentioned: false, accuracy: 'na', competitors: [], note: '(探測失敗)' },
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
  return { result: { question, engines: cells }, cost };
}

/** Aggregate mention/accuracy rates + competitor tally across the whole run. */
function aggregate(results: GeoQuestionResult[]): Omit<GeoSummary, 'gaps' | 'oneLineAction'> {
  const cells = results.flatMap((r) => r.engines);
  const total = cells.length || 1;
  const mentioned = cells.filter((c) => c.verdict.mentioned);
  const correct = mentioned.filter((c) => c.verdict.accuracy === 'correct');

  const tally = new Map<string, number>();
  for (const c of cells) {
    for (const comp of c.verdict.competitors) {
      const key = comp.trim();
      if (key) tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  const topCompetitors = [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    mentionRate: mentioned.length / total,
    accuracyRate: mentioned.length ? correct.length / mentioned.length : 0,
    topCompetitors,
  };
}

/**
 * Run a full GEO diagnosis: fixed question set × engines, judged against the
 * ground-truth profile, aggregated + synthesized into a deliverable report.
 * A job (not a chat role) — invoked from the REST route or the dogfood script.
 */
export async function runGeoDiagnosis(opts: RunGeoOptions = {}): Promise<GeoReport> {
  const blocked = await budgetGate({ provider: GEO_PROVIDER, keyId: GEO_PROVIDER });
  if (blocked.length > 0) {
    const b = blocked[0];
    throw new GeoBudgetError(
      `GEO 診斷被預算擋下:超過 ${b.budget.scope}${b.budget.match ? ` "${b.budget.match}"` : ''} 上限 ` +
        `($${b.usedUSD.toFixed(2)} / $${b.limitUSD.toFixed(2)})。到 billing.json 調高。`,
    );
  }

  const id = `geo-${randomUUID().slice(0, 8)}`;
  const sessionKey = `geo:${id}`;

  return withSessionLock(sessionKey, async () => {
    const qset = await loadQuestionSet();
    const [input, engines] = await Promise.all([resolveInput(opts, qset), loadEngines()]);

    let costUSD = 0;
    const results: GeoQuestionResult[] = [];
    for (const question of qset.questions) {
      const { result, cost } = await runQuestion(sessionKey, input, question, engines);
      results.push(result);
      costUSD += cost;
    }

    const base = aggregate(results);
    const synth = await synthesize(sessionKey, input, results);
    costUSD += synth.costUSD;

    const report: GeoReport = {
      id,
      ts: Date.now(),
      input,
      engines,
      results,
      summary: { ...base, gaps: synth.gaps, oneLineAction: synth.oneLineAction },
      costUSD,
    };
    await saveReport(report);
    return report;
  });
}
