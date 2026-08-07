import { config } from '../config.js';
import { complete } from '../llm.js';
import { meterCompletion } from './meter.js';
import type { GeoInput, GeoQuestion, GeoVerdict } from './types.js';

/** Judge model: cheap, JSON-only. Defaults to the orchestrator model. */
function judgeModel(): string {
  return config.geoJudgeModel || config.model;
}

const JUDGE_SYSTEM =
  '你是 GEO(生成引擎優化)分析師。給你「一個潛在客戶問 AI 的問題」、「某個 AI 的實際回答」、以及「目標公司的地面真相」。' +
  '判斷這個 AI 的回答對目標公司的表現,只輸出 JSON,不要多餘文字。格式:\n' +
  '{"mentioned": boolean,            // 回答中有沒有提到目標公司或其產品/別名\n' +
  ' "accuracy": "correct"|"partial"|"wrong"|"na",  // 有提到時講得對不對(對照地面真相);沒提到=na\n' +
  ' "competitors": string[],        // 回答中被點名的「其他」公司/產品(不含目標本身)\n' +
  ' "citedSources": string[],       // 回答有引用的來源/網址(沒有就空陣列)\n' +
  ' "note": string}                 // 一句話:講對/講錯什麼,或為何沒被提到(繁中)';

export interface JudgeResult {
  verdict: GeoVerdict;
  costUSD: number;
}

/** Judge one engine's answer to one question. Mirrors the room moderator: one
 *  cheap metered `complete()` call with JSON output, safe fallback on parse
 *  failure so a bad judge response never sinks the whole report. */
export async function judge(
  sessionKey: string,
  input: GeoInput,
  question: GeoQuestion,
  answer: string,
): Promise<JudgeResult> {
  const targetNames = [input.company, ...input.aliases].filter(Boolean).join('、');
  const res = await complete(
    [
      { role: 'system', content: JUDGE_SYSTEM },
      {
        role: 'user',
        content:
          `## 目標公司\n${input.company}(別名/產品:${targetNames || '無'})\n` +
          `垂直:${input.vertical}｜市場:${input.market}\n\n` +
          `## 地面真相(判 accuracy 的基準)\n${input.groundTruth}\n\n` +
          `## 潛在客戶問的問題\n${question.text}\n\n` +
          `## 這個 AI 的實際回答\n${answer || '(空回答)'}`,
      },
    ],
    [],
    judgeModel(),
  );
  const costUSD = await meterCompletion(sessionKey, judgeModel(), res);

  const raw = res.choices[0]?.message?.content ?? '';
  try {
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '') as Partial<GeoVerdict>;
    const verdict: GeoVerdict = {
      mentioned: Boolean(json.mentioned),
      accuracy: (['correct', 'partial', 'wrong', 'na'] as const).includes(json.accuracy as GeoVerdict['accuracy'])
        ? (json.accuracy as GeoVerdict['accuracy'])
        : json.mentioned
          ? 'partial'
          : 'na',
      competitors: Array.isArray(json.competitors) ? json.competitors.filter((c): c is string => typeof c === 'string') : [],
      citedSources: Array.isArray(json.citedSources)
        ? json.citedSources.filter((c): c is string => typeof c === 'string')
        : undefined,
      note: typeof json.note === 'string' ? json.note : '',
    };
    return { verdict, costUSD };
  } catch {
    // Parse failure → conservative "unknown" verdict, flagged in the note.
    return {
      verdict: { mentioned: false, accuracy: 'na', competitors: [], note: '(judge 無法解析,已跳過)' },
      costUSD,
    };
  }
}
