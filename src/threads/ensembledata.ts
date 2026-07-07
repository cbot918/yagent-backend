import { config } from '../config.js';
import { extractPosts, findUnits } from './parse.js';
import type { SearchResult, ThreadsSource } from './types.js';

/**
 * EnsembleData unofficial Threads API — metered (free tier is a small daily
 * *units* allotment, not per-request). When it's exhausted the API returns
 * HTTP 495 + {"detail":"Maximum requests limit reached for today…"}, which we
 * flag as `quota` so the caller can fall back to the browser source.
 *
 * Endpoint: GET {base}/threads/keyword/search?name=<kw>&sorting=<0|1>&token=<token>
 */
export function createEnsembleDataSource(): ThreadsSource {
  return {
    name: 'ensembledata',
    async search(keyword, sort): Promise<SearchResult> {
      if (!config.ensembledataToken) {
        return { ok: false, httpStatus: 0, posts: [], error: 'ENSEMBLEDATA_TOKEN not set' };
      }

      const url = new URL(`${config.ensembledataBaseUrl}/threads/keyword/search`);
      url.searchParams.set('name', keyword);
      url.searchParams.set('sorting', sort === 'recent' ? '1' : '0');
      url.searchParams.set('token', config.ensembledataToken);

      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      } catch (err) {
        return { ok: false, httpStatus: 0, posts: [], error: err instanceof Error ? err.message : String(err) };
      }

      const bodyText = await res.text();
      if (!res.ok) {
        const quota = res.status === 495 || /maximum requests limit/i.test(bodyText);
        return { ok: false, httpStatus: res.status, posts: [], error: bodyText.slice(0, 300), quota };
      }

      let json: unknown;
      try {
        json = JSON.parse(bodyText);
      } catch {
        return { ok: false, httpStatus: res.status, posts: [], error: `invalid JSON: ${bodyText.slice(0, 200)}` };
      }

      return { ok: true, httpStatus: res.status, posts: extractPosts(json), units: findUnits(json) };
    },
  };
}
