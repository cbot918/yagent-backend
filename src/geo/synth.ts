import { config } from '../config.js';
import { complete } from '../llm.js';
import { meterCompletion } from './meter.js';
import type { GeoInput, GeoQuestionResult } from './types.js';

/** Compact one run's verdicts into a few lines the synthesizer can reason over. */
function digest(results: GeoQuestionResult[]): string {
  return results
    .map((qr) => {
      const cells = qr.engines
        .map((e) => {
          const m = e.verdict.mentioned ? `提及/${e.verdict.accuracy}` : '未提及';
          const comp = e.verdict.competitors.length ? `,競品:${e.verdict.competitors.join('、')}` : '';
          return `${e.engineLabel}=${m}${comp};${e.verdict.note}`;
        })
        .join(' | ');
      return `- [${qr.question.kind}] ${qr.question.text}\n    ${cells}`;
    })
    .join('\n');
}

const SYNTH_SYSTEM =
  '你是 GEO(生成引擎優化)顧問。給你一家公司在多個 AI 上的診斷結果彙整,' +
  '請找出「認知缺口」並給一句可執行的內容行動建議。只輸出 JSON:\n' +
  '{"gaps": string[],          // 3~5 條:AI 對這家公司最關鍵的缺口/誤解(繁中,具體)\n' +
  ' "oneLineAction": string}   // 一句話:現在最該補的一塊內容(繁中,具體可做)';

export interface SynthResult {
  gaps: string[];
  oneLineAction: string;
  costUSD: number;
}

/** One metered call that turns the raw verdicts into the report's gaps +
 *  headline action. Falls back to a safe empty synthesis on parse failure. */
export async function synthesize(
  sessionKey: string,
  input: GeoInput,
  results: GeoQuestionResult[],
): Promise<SynthResult> {
  const model = config.geoJudgeModel || config.model;
  const res = await complete(
    [
      { role: 'system', content: SYNTH_SYSTEM },
      {
        role: 'user',
        content:
          `## 公司\n${input.company}｜垂直:${input.vertical}｜市場:${input.market}\n\n` +
          `## 各題 × 各 AI 的診斷彙整\n${digest(results)}`,
      },
    ],
    [],
    model,
  );
  const costUSD = await meterCompletion(sessionKey, model, res);

  const raw = res.choices[0]?.message?.content ?? '';
  try {
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '') as { gaps?: unknown; oneLineAction?: unknown };
    return {
      gaps: Array.isArray(json.gaps) ? json.gaps.filter((g): g is string => typeof g === 'string') : [],
      oneLineAction: typeof json.oneLineAction === 'string' ? json.oneLineAction : '',
      costUSD,
    };
  } catch {
    return { gaps: [], oneLineAction: '', costUSD };
  }
}
