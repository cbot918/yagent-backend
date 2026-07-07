import { config } from '../config.js';
import { appendThreadsLog, countToday } from '../monitor/threadsLog.js';
import { getThreadsSource } from '../threads/index.js';
import type { SearchResult } from '../threads/index.js';
import type { Tool, ToolContext } from './types.js';

/**
 * Threads (Meta) trend collector. The actual fetching is delegated to a swappable
 * ThreadsSource backend (src/threads/): 'ensembledata' (metered API) or 'browser'
 * (free headless scrape). A role picks its default via `role.threadsSource`; if the
 * metered API hits its daily quota we auto-fall back to the browser source (when
 * THREADS_FALLBACK is on and ALLOW_BROWSER=true), so "額度用完" doesn't dead-end.
 *
 * Every call (each backend attempt) is logged via monitor/threadsLog so the sidebar
 * Monitor panel shows the *real* usage — which source, ok/quota, how many posts.
 */

const MAX_POSTS = 15; // cap what we hand back to the model, keep the context tight

export const threadsTrendTool: Tool = {
  name: 'threads_trend',
  description:
    'Search public Threads (Meta) posts for a keyword or hashtag to gauge what is trending and how it is being discussed. ' +
    'Returns the top matching posts ranked by engagement (likes/replies), with author and text. ' +
    'Use this to research user hotspots, sentiment, and content angles on Threads. ' +
    'The data source (metered API vs free browser scrape) is chosen per-role; when the metered API quota runs out it falls back automatically.',
  parameters: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description: 'The keyword or hashtag to search on Threads (e.g. "AI agent", "台北美食"). Do not include the # sign.',
      },
      sort: {
        type: 'string',
        enum: ['top', 'recent'],
        description: 'Ranking of results: "top" (most engagement, default) or "recent" (newest first).',
      },
    },
    required: ['keyword'],
  },
  async run(args, ctx: ToolContext) {
    const { keyword: rawKeyword, sort: rawSort } = args as { keyword: string; sort?: 'top' | 'recent' };
    const sort: 'top' | 'recent' = rawSort === 'recent' ? 'recent' : 'top';
    const keyword = (rawKeyword ?? '').trim();
    if (!keyword) return 'Error: keyword is required.';

    // Log one line per backend attempt, and return "today's call #N".
    const log = async (sourceName: string, r: SearchResult): Promise<number> => {
      const posts = r.posts.slice(0, 3);
      await appendThreadsLog({
        ts: Date.now(),
        keyword,
        sort,
        source: sourceName,
        ok: r.ok,
        httpStatus: r.httpStatus,
        resultCount: r.posts.length,
        units: r.units,
        error: r.error,
        preview: r.ok ? posts.map((p) => `@${p.username}: ${p.text.slice(0, 60)}`).join(' | ') : undefined,
      });
      return countToday(); // total attempts today, this one included
    };

    // Resolve the role's chosen source (ctx.threadsSource), else the global default.
    const primaryName = ctx.threadsSource || config.threadsSource;
    let source;
    try {
      source = getThreadsSource(primaryName);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }

    let result = await source.search(keyword, sort);
    let usedSource = source.name;
    let n = await log(usedSource, result);

    // Auto-fallback: metered API quota exhausted → try the free browser scrape.
    let fellBack = false;
    if (!result.ok && result.quota && config.threadsFallback && config.allowBrowser && usedSource !== 'browser') {
      const browser = getThreadsSource('browser');
      result = await browser.search(keyword, sort);
      usedSource = browser.name;
      n = await log(usedSource, result);
      fellBack = true;
    }

    if (!result.ok) {
      const quotaNote =
        result.quota && !config.allowBrowser
          ? '（可設 ALLOW_BROWSER=true 或把此角色的 Threads 來源切為 browser 以繼續）'
          : '';
      return `Error: Threads 搜尋失敗（來源 ${usedSource}，HTTP ${result.httpStatus}，今日第 ${n} 次）${quotaNote}。${result.error ?? ''}`;
    }

    const posts = result.posts.slice(0, MAX_POSTS);
    // "top" sort: re-rank locally by engagement in case the source's order drifts.
    if (sort === 'top') posts.sort((a, b) => b.likes + b.replies - (a.likes + a.replies));

    const header =
      `Threads "${keyword}" — top ${posts.length} posts ` +
      `(source: ${usedSource}${fellBack ? ' [fallback]' : ''}, sort: ${sort}, today's call #${n}` +
      `${result.units != null ? `, units charged: ${result.units}` : ''})`;

    if (posts.length === 0) return `No Threads posts found for "${keyword}" (source: ${usedSource}, today's call #${n}).`;

    const lines = posts.map(
      (p, i) =>
        `${i + 1}. @${p.username} — ♥${p.likes} 💬${p.replies}\n   ${p.text.slice(0, 240)}` +
        (p.url ? `\n   🔗 ${p.url}` : ''),
    );
    return [header, '', ...lines].join('\n');
  },
};
