import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { appendThreadsLog, countToday } from '../monitor/threadsLog.js';
import { getThreadsSource } from '../threads/index.js';
import { mineHotTopics } from '../threads/mine.js';
import type { NormalizedPost, SearchResult, ThreadsSource } from '../threads/index.js';
import type { Tool, ToolContext } from './types.js';

/**
 * Threads hot-topic DISCOVERY (vs threads_trend which drills into one known
 * keyword). Threads has no trending API, so we fan out searches over a seed
 * keyword pool, aggregate the posts, and mine rising terms in code
 * (threads/mine.ts) — that's how "初級大人"-style memes surface before you know
 * to search for them. Seeds live in roles/seeds.json (owner-editable,
 * files-as-truth, read fresh per call).
 *
 * Quota awareness: a fan-out is one request per seed, so on the metered
 * EnsembleData backend we prefer to route the whole scan to the free browser
 * scrape when it's available; each attempt is logged to the Monitor like
 * threads_trend, with keyword "hot:<seed>".
 */

const SEEDS_FILE = path.resolve('./roles/seeds.json');
const DEFAULT_SEEDS = ['大人', '上班', '離職', '老闆', '同事', '戀愛', '分手', '台灣', '房價', 'AI', '減肥', '星座'];
const MAX_SEEDS = 12;
const MAX_SEEDS_METERED = 8; // each seed costs 1 unit on ensembledata
const CONCURRENCY = 3; // safe: withPage opens a fresh context per call on one shared Chromium

async function resolveSeeds(argSeeds: unknown): Promise<string[]> {
  const clean = (list: unknown): string[] =>
    Array.isArray(list) ? list.map((s) => String(s).trim()).filter(Boolean) : [];

  const fromArgs = clean(argSeeds);
  if (fromArgs.length) return fromArgs.slice(0, MAX_SEEDS);

  try {
    const raw = await fs.readFile(SEEDS_FILE, 'utf8');
    const fromFile = clean((JSON.parse(raw) as { seeds?: unknown }).seeds);
    if (fromFile.length) return fromFile.slice(0, MAX_SEEDS);
  } catch {
    /* missing/invalid seeds.json → hardcoded defaults */
  }
  return DEFAULT_SEEDS;
}

/** Run `fn` over items with a small concurrency pool, preserving order of results. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function relativeAge(takenAt: number | undefined, nowSec: number): string | undefined {
  if (!takenAt) return undefined;
  const h = Math.max(0, Math.round((nowSec - takenAt) / 3600));
  if (h < 1) return '<1h 前';
  if (h < 48) return `${h}h 前`;
  return `${Math.round(h / 24)}d 前`;
}

export const threadsHotTool: Tool = {
  name: 'threads_hot',
  description:
    '掃描 Threads 熱點：對一組泛話題種子關鍵字做批次搜尋、聚合貼文，在程式端挖掘並排名正在竄升的關鍵字／迷因（例如從「大人」相關貼文中發現「初級大人」爆量）。' +
    '何時用：想「發現」現在什麼在紅、但還不知道關鍵字時。想深挖某個已知關鍵字的風向請改用 threads_trend。' +
    '種子池預設讀 roles/seeds.json，可用 seeds 參數覆寫。一次掃描約 20–30 秒。',
  parameters: {
    type: 'object',
    properties: {
      seeds: {
        type: 'array',
        items: { type: 'string' },
        description: '覆寫種子關鍵字池（可省略，預設讀 roles/seeds.json 的泛話題種子）。',
      },
      limit: {
        type: 'number',
        description: '回傳的熱點數量，預設 10（3–15）。',
      },
    },
    required: [],
  },
  async run(args, ctx: ToolContext) {
    const { seeds: rawSeeds, limit: rawLimit } = args as { seeds?: string[]; limit?: number };
    let seeds = await resolveSeeds(rawSeeds);
    if (!seeds.length) return 'Error: 沒有可用的種子關鍵字（seeds 參數與 roles/seeds.json 都是空的）。';
    const limit = Math.min(15, Math.max(3, Math.round(rawLimit ?? 10)));

    // Source selection with quota awareness: prefer the free browser scrape for a
    // whole fan-out when the primary is the metered API and fallback is allowed.
    const primaryName = ctx.threadsSource || config.threadsSource;
    let sourceName = primaryName;
    let forcedToBrowser = false;
    if (primaryName === 'ensembledata' && config.allowBrowser && config.threadsFallback) {
      sourceName = 'browser';
      forcedToBrowser = true;
    }
    let source: ThreadsSource;
    try {
      source = getThreadsSource(sourceName);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (source.name === 'ensembledata' && seeds.length > MAX_SEEDS_METERED) {
      seeds = seeds.slice(0, MAX_SEEDS_METERED);
    }

    const log = async (seed: string, srcName: string, r: SearchResult): Promise<void> => {
      await appendThreadsLog({
        ts: Date.now(),
        keyword: `hot:${seed}`,
        sort: 'recent',
        source: srcName,
        ok: r.ok,
        httpStatus: r.httpStatus,
        resultCount: r.posts.length,
        units: r.units,
        error: r.error,
        preview: r.ok
          ? r.posts.slice(0, 2).map((p) => `@${p.username}: ${p.text.slice(0, 60)}`).join(' | ')
          : undefined,
      });
    };

    // Fan out. One failed seed must not sink the scan; mid-scan quota exhaustion
    // on the metered API switches the remaining seeds to the browser scrape.
    let quotaHit = false;
    const failures: { seed: string; error: string }[] = [];
    const perSeed = await mapPool(seeds, CONCURRENCY, async (seed) => {
      let src = source;
      if (quotaHit && src.name !== 'browser' && config.threadsFallback && config.allowBrowser) {
        src = getThreadsSource('browser');
      }
      let r: SearchResult;
      try {
        r = await src.search(seed, 'recent');
      } catch (err) {
        r = { ok: false, httpStatus: 0, posts: [], error: err instanceof Error ? err.message : String(err) };
      }
      await log(seed, src.name, r);
      if (!r.ok && r.quota) {
        quotaHit = true;
        if (config.threadsFallback && config.allowBrowser && src.name !== 'browser') {
          const browser = getThreadsSource('browser');
          r = await browser.search(seed, 'recent');
          await log(seed, browser.name, r);
        }
      }
      if (!r.ok) failures.push({ seed, error: r.error?.slice(0, 120) ?? `HTTP ${r.httpStatus}` });
      return r.ok ? r.posts : [];
    });

    const n = await countToday();

    // Aggregate + dedupe across seeds (parse.ts only dedupes within one search),
    // keeping each post tagged with the seed that found it — the miner uses seed
    // spread to filter out generic vocabulary.
    const seen = new Set<string>();
    const tagged: Array<{ post: NormalizedPost; seed: string }> = [];
    for (const [i, seedPosts] of perSeed.entries()) {
      for (const p of seedPosts) {
        const key = p.url ?? p.text.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        tagged.push({ post: p, seed: seeds[i] });
      }
    }

    if (failures.length === seeds.length) {
      const hint =
        !config.allowBrowser && quotaHit
          ? '（可設 ALLOW_BROWSER=true 或把此角色的 Threads 來源切為 browser 以繼續）'
          : '';
      return `Error: 熱點掃描失敗（${failures.length}/${seeds.length} 個種子都失敗，source ${source.name}，今日累計呼叫 #${n}）${hint}。第一個錯誤：${failures[0].error}`;
    }
    if (tagged.length === 0) {
      return `Threads 熱點掃描：${seeds.length} 個種子都搜不到貼文（source: ${source.name}, 今日累計呼叫 #${n}）。可能是頁面結構變動或關鍵字太冷門。`;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const topics = mineHotTopics(tagged, { exclude: seeds, limit, nowSec });

    const headerParts = [
      `Threads 熱點掃描 — ${seeds.length - failures.length}/${seeds.length} 個種子, ${tagged.length} 篇貼文`,
      `(source: ${source.name}${forcedToBrowser ? ' [fan-out 改走 browser 以省 API units]' : ''}${quotaHit ? ' [API 配額用盡]' : ''}, 今日累計呼叫 #${n})`,
    ];
    const lines: string[] = [headerParts.join(' ')];
    if (failures.length) lines.push(`失敗種子: ${failures.map((f) => `${f.seed} (${f.error})`).join('; ')}`);
    lines.push('');

    if (topics.length === 0) {
      // Nothing survived mining — hand back the raw top posts so the turn isn't wasted.
      lines.push('沒有挖到跨貼文的竄升關鍵字；以下是互動最高的 5 篇原始貼文：');
      const top = tagged
        .map((t) => t.post)
        .sort((a, b) => b.likes + b.replies - (a.likes + a.replies))
        .slice(0, 5);
      for (const [i, p] of top.entries()) {
        lines.push(`${i + 1}. @${p.username} (♥${p.likes} 💬${p.replies}): ${p.text.slice(0, 120)}${p.url ? `\n   🔗 ${p.url}` : ''}`);
      }
      return lines.join('\n');
    }

    for (const [i, t] of topics.entries()) {
      const newest = Math.max(...t.samples.map((s) => s.takenAt ?? 0));
      const age = relativeAge(newest || undefined, nowSec);
      lines.push(
        `${i + 1}. ${t.term} — 熱度 ${Math.round(t.score)} | 出現 ${t.postCount} 篇 | 互動 ${t.engagement.toLocaleString()}${age ? ` | 最新 ${age}` : ''}`,
      );
      for (const s of t.samples.slice(0, 2)) {
        lines.push(`   ▸ @${s.username} (♥${s.likes} 💬${s.replies}): ${s.text.slice(0, 100)}`);
        if (s.url) lines.push(`     🔗 ${s.url}`);
      }
    }
    lines.push('');
    lines.push('提示：想深挖某個熱點的完整風向與代表貼文，用 threads_trend 針對該關鍵字再查（sort: top）。');
    return lines.join('\n');
  },
};
