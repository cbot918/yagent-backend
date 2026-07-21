// GEO dogfood: run the diagnosis against ElementAI itself and write a durable
// markdown report to knowledge/geo/reports/. Run from the repo root:
//   npx tsx src/geo/dogfood.ts
// Requires a working OpenRouter key in .env (OPENAI_BASE_URL + OPENAI_API_KEY).
import fs from 'fs/promises';
import path from 'path';
import { runGeoDiagnosis } from './runner.js';
import { renderMarkdown } from './markdown.js';

async function main() {
  console.log('[geo] 對 ElementAI 跑診斷中(固定題組 × 各 AI,約數十秒)…');
  const report = await runGeoDiagnosis({ company: 'ElementAI' });

  const dateStr = new Date().toISOString().slice(0, 10);
  const md = renderMarkdown(report, dateStr);
  const outDir = path.resolve('./knowledge/geo/reports');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `eai-${dateStr}.md`);
  await fs.writeFile(outPath, md);

  console.log(`[geo] 完成。提及率 ${Math.round(report.summary.mentionRate * 100)}%、` +
    `正確率 ${Math.round(report.summary.accuracyRate * 100)}%、成本 $${report.costUSD.toFixed(4)}`);
  console.log(`[geo] 報告:${outPath}`);
  console.log(`[geo] 一句話行動建議:${report.summary.oneLineAction || '(無)'}`);
}

main().catch((err) => {
  console.error('[geo] 失敗:', err instanceof Error ? err.message : err);
  process.exit(1);
});
