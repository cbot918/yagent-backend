import type { NormalizedPost } from './types.js';

/**
 * Both Threads backends return the same nested, version-shifting JSON (the
 * EnsembleData envelope mirrors Threads' internal shape, and the browser scrape
 * pulls Threads' own hydration data straight out of <script> tags). So parsing
 * is shared: walk the JSON and pull out any object that looks like a post
 * (caption text + engagement/user), deduping by text. Defensive on purpose — a
 * shape change should degrade gracefully, not throw.
 *
 * Pass a shared `seen` set to dedupe across multiple JSON blobs (the browser
 * source parses dozens of <script> tags in one page).
 */
export function extractPosts(json: unknown, seen = new Set<string>()): NormalizedPost[] {
  const out: NormalizedPost[] = [];

  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, any>;

    const text: string | undefined = obj.caption?.text ?? obj.caption_text ?? obj.text;
    const isPost = typeof text === 'string' && ('like_count' in obj || 'text_post_app_info' in obj || 'user' in obj);
    if (isPost) {
      const trimmed = text!.replace(/\s+/g, ' ').trim();
      const key = trimmed.slice(0, 80);
      if (trimmed && !seen.has(key)) {
        seen.add(key);
        const username = obj.user?.username ?? obj.username ?? '?';
        // Threads permalink = /@<user>/post/<shortcode>. `code` is present on both the
        // browser hydration JSON and the EnsembleData envelope; skip the link if absent.
        const code: string | undefined = obj.code;
        const url = code && username !== '?' ? `https://www.threads.com/@${username}/post/${code}` : undefined;
        // Post creation time: `taken_at` is unix seconds on both sources; some shapes
        // carry ms-precision `device_timestamp` instead. Absent → undefined (recency
        // scoring degrades gracefully).
        const rawTakenAt = obj.taken_at ?? obj.device_timestamp;
        const takenAt =
          typeof rawTakenAt === 'number' && rawTakenAt > 1e9
            ? rawTakenAt > 1e12
              ? Math.floor(rawTakenAt / 1000)
              : Math.floor(rawTakenAt)
            : undefined;
        out.push({
          username,
          text: trimmed,
          likes: Number(obj.like_count ?? 0),
          replies: Number(obj.text_post_app_info?.direct_reply_count ?? obj.reply_count ?? 0),
          url,
          takenAt,
        });
      }
    }

    for (const v of Object.values(obj)) visit(v);
  };

  visit(json);
  return out;
}

/**
 * Find the units-charged value wherever EnsembleData puts it. Their envelope has
 * moved between `units_charged` (top level) and nested spots, so match any numeric
 * key that looks like a units counter rather than hard-coding one path.
 */
export function findUnits(json: unknown): number | undefined {
  let found: number | undefined;
  const visit = (n: unknown) => {
    if (found !== undefined || !n || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (typeof v === 'number' && /unit/i.test(k)) {
        found = v;
        return;
      }
      if (v && typeof v === 'object') visit(v);
    }
  };
  visit(json);
  return found;
}
