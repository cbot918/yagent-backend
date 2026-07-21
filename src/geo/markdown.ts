import type { GeoReport, GeoVerdict } from './types.js';

const ACC_LABEL: Record<GeoVerdict['accuracy'], string> = {
  correct: '✅ 正確',
  partial: '🟡 部分',
  wrong: '❌ 錯誤',
  na: '—',
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Render a GeoReport as a human-readable markdown deliverable (dogfood/export). */
export function renderMarkdown(report: GeoReport, dateStr: string): string {
  const { input, summary, results, engines } = report;
  const lines: string[] = [];

  lines.push(`# GEO 診斷報告 — ${input.company}`);
  lines.push('');
  lines.push(`> 「AI 眼中的你」:主流 AI 現在怎麼講 ${input.company}、講不講、講對嗎。`);
  lines.push(`> 日期:${dateStr}｜垂直:${input.vertical}｜市場:${input.market}｜成本:$${report.costUSD.toFixed(4)}`);
  lines.push(`> 探測引擎:${engines.map((e) => `${e.label}(${e.mode === 'open' ? '即時檢索' : '訓練記憶'})`).join('、')}`);
  lines.push('');

  lines.push('## 總覽');
  lines.push('');
  lines.push(`- **提及率**:${pct(summary.mentionRate)}(AI 有沒有把你端出來)`);
  lines.push(`- **正確率**:${pct(summary.accuracyRate)}(被提到時講得對不對)`);
  if (summary.topCompetitors.length) {
    lines.push(`- **最常被端出的競品**:${summary.topCompetitors.map((c) => `${c.name}(${c.count})`).join('、')}`);
  }
  lines.push('');
  lines.push(`### 👉 一句話行動建議`);
  lines.push('');
  lines.push(`> ${summary.oneLineAction || '(無)'}`);
  lines.push('');

  if (summary.gaps.length) {
    lines.push('## 認知缺口');
    lines.push('');
    for (const g of summary.gaps) lines.push(`- ${g}`);
    lines.push('');
  }

  lines.push('## 逐題結果');
  lines.push('');
  for (const qr of results) {
    lines.push(`### [${qr.question.kind === 'entity' ? '實體題' : '產業題'}] ${qr.question.text}`);
    lines.push('');
    lines.push('| 引擎 | 模式 | 提及 | 正確性 | 被端出的競品 | 判讀 |');
    lines.push('|---|---|---|---|---|---|');
    for (const e of qr.engines) {
      const mode = e.mode === 'open' ? '即時檢索' : '訓練記憶';
      const mentioned = e.error ? '⚠️ 失敗' : e.verdict.mentioned ? '有' : '無';
      const acc = ACC_LABEL[e.verdict.accuracy];
      const comp = e.verdict.competitors.join('、') || '—';
      const note = (e.error ? `錯誤:${e.error}` : e.verdict.note || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${e.engineLabel} | ${mode} | ${mentioned} | ${acc} | ${comp} | ${note} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
