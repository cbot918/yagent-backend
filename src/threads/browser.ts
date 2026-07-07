import { config } from '../config.js';
import { withPage } from '../browser/manager.js';
import { extractPosts } from './parse.js';
import type { SearchResult, ThreadsSource } from './types.js';

/**
 * Free headless-browser scrape of Threads' public search page. Threads is a
 * JavaScript app that ships its post data as hydration JSON inside
 * <script type="application/json"> tags, and — verified — the search page renders
 * those unauthenticated (there's a dismissible login overlay, but the data is in
 * the HTML). So we load the page, pull every JSON blob, and reuse the shared
 * parser. No SSRF guard needed: the host is fixed (threads.com), not agent-chosen.
 *
 * Trade-off vs EnsembleData: no per-request cost / no daily quota, but slower and
 * more brittle (page structure can change). This is the fallback when the metered
 * API runs out. `sort` is best-effort — search default is relevance; the tool
 * re-ranks "top" by engagement locally anyway.
 */
export function createBrowserSource(): ThreadsSource {
  return {
    name: 'browser',
    async search(keyword): Promise<SearchResult> {
      if (!config.allowBrowser) {
        return { ok: false, httpStatus: 0, posts: [], error: 'browser source needs ALLOW_BROWSER=true' };
      }

      const url = `https://www.threads.com/search?q=${encodeURIComponent(keyword)}&serp_type=default`;

      return withPage(async (page) => {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
        } catch (err) {
          return {
            ok: false,
            httpStatus: 0,
            posts: [],
            error: `failed to load Threads search: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        // Let the hydration data settle into the DOM before we read the script tags.
        await page.waitForTimeout(3500);

        let scripts: string[] = [];
        try {
          scripts = await page.$$eval('script[type="application/json"]', (els) =>
            els.map((e) => e.textContent || ''),
          );
        } catch {
          /* no script tags found — fall through to empty result */
        }

        const seen = new Set<string>();
        let posts = [] as SearchResult['posts'];
        for (const s of scripts) {
          try {
            posts = posts.concat(extractPosts(JSON.parse(s), seen));
          } catch {
            /* skip non-JSON / unparseable blobs */
          }
        }

        return { ok: true, httpStatus: 200, posts };
      });
    },
  };
}
