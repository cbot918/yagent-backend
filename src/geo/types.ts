// GEO diagnosis types. A GEO job takes a target company + a fixed vertical
// question set, probes several AI engines, and judges each answer against a
// ground-truth profile — producing a deliverable "how AI sees you" report.

/** How the target is described to the diagnosis (the thing we search AI for). */
export interface GeoInput {
  /** Canonical company/brand name, e.g. "ElementAI". */
  company: string;
  /** Alternate names/products the model might use, e.g. ["AgentOS", "yagent"]. */
  aliases: string[];
  /** Vertical context, e.g. "裝修 / 系統櫃 / 安裝業". */
  vertical: string;
  /** Market context, e.g. "台灣 / 華語圈". */
  market: string;
  /** Ground-truth profile text used to judge accuracy (from eai-profile.md). */
  groundTruth: string;
}

/** One probing engine = one model queried in one mode. */
export interface GeoEngine {
  id: string;
  label: string;
  /** closed = training-memory recall; open = live web retrieval (e.g. Perplexity). */
  mode: 'closed' | 'open';
  /** OpenRouter model id. */
  model: string;
}

/** A fixed question in the vertical set. */
export interface GeoQuestion {
  id: string;
  /** discovery = industry search a prospect would ask; entity = direct name probe. */
  kind: 'discovery' | 'entity';
  text: string;
}

/** The judge's structured verdict on one engine's answer to one question. */
export interface GeoVerdict {
  /** Was the target company/brand named at all? */
  mentioned: boolean;
  /** If mentioned, is what it said correct? 'na' when not mentioned. */
  accuracy: 'correct' | 'partial' | 'wrong' | 'na';
  /** Other companies/products the answer named instead of/alongside the target. */
  competitors: string[];
  /** For open-mode engines: sources the answer cited, if any. */
  citedSources?: string[];
  /** One-line judge note (what it got right/wrong, or why absent). */
  note: string;
}

/** One engine's full result for one question: raw answer + verdict. */
export interface GeoEngineResult {
  engineId: string;
  engineLabel: string;
  mode: 'closed' | 'open';
  model: string;
  /** The model's actual answer (may be truncated for storage). */
  rawAnswer: string;
  verdict: GeoVerdict;
  /** Set when the probe or judge failed, so the report can show a gap honestly. */
  error?: string;
}

/** All engines' results for one question. */
export interface GeoQuestionResult {
  question: GeoQuestion;
  engines: GeoEngineResult[];
}

/** Aggregate read across the whole run. */
export interface GeoSummary {
  /** Fraction of (question × engine) cells where the target was mentioned. */
  mentionRate: number;
  /** Fraction of mentions that were judged 'correct' (partial/wrong excluded). */
  accuracyRate: number;
  /** Competitors ranked by how often they were named, most first. */
  topCompetitors: { name: string; count: number }[];
  /** Notable gaps/misconceptions surfaced by the judge. */
  gaps: string[];
  /** One-line action recommendation (what content to create). */
  oneLineAction: string;
}

/** The deliverable report. */
export interface GeoReport {
  id: string;
  ts: number;
  input: GeoInput;
  engines: GeoEngine[];
  results: GeoQuestionResult[];
  summary: GeoSummary;
  /** USD spent on this run (probes + judges), for the deliverable footer. */
  costUSD: number;
}
