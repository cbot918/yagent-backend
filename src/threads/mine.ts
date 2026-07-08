import type { NormalizedPost } from './types.js';

/**
 * Term mining for hot-topic discovery — pure functions, no I/O. Threads gives us
 * no trending API, so `threads_hot` fans out searches over seed keywords and this
 * module digs the actually-hot terms out of the returned posts: hashtags, CJK
 * n-grams (2–6 chars — no word segmentation needed for zh), and latin tokens,
 * scored by breadth (document frequency) × engagement × recency.
 */

export interface HotTopic {
  term: string;
  /** Distinct posts containing the term (document frequency). */
  postCount: number;
  /** Sum of likes+replies over those posts. */
  engagement: number;
  score: number;
  /** Top posts by engagement containing the term. */
  samples: NormalizedPost[];
}

// Full-candidate rejects (exact match): zh function/filler words that survive the
// boundary filter, plus latin/url noise. Tune after real scans, don't gold-plate.
const STOPWORDS = new Set([
  // zh fillers
  '我們', '你們', '他們', '她們', '大家', '自己', '什麼', '怎麼', '這樣', '那樣', '這個', '那個',
  '一個', '一種', '一樣', '就是', '不是', '還是', '但是', '可是', '因為', '所以', '可以', '沒有',
  '真的', '覺得', '知道', '現在', '時候', '已經', '如果', '應該', '可能', '其實', '然後', '還有',
  '有點', '一下', '一直', '一定', '今天', '昨天', '明天', '每天', '之後', '之前', '開始', '結果',
  '很多', '多少', '東西', '事情', '感覺', '希望', '喜歡', '謝謝', '請問', '大概', '雖然', '或是',
  '而且', '甚至', '突然', '終於', '根本', '完全', '非常', '超級', '比較', '最近', '以前', '以後',
  '有人', '別人', '朋友', '影片', '留言', '分享', '追蹤', '按讚', '回覆', '貼文',
  // domain-generic nouns that dominate any scan without being a rising topic
  '工作', '公司', '主管', '生活', '時間', '問題', '地方', '方式', '內容', '時間點',
  '哪裡', '留下', '離開', '出現', '發現', '選擇', '決定', '需要', '想要', '直接',
  // connective/filler words the boundary filter can't catch (incl. 為什: fragment
  // of 為什麼, whose own last char 麼 is a boundary char)
  '另外', '說明', '只要', '只是', '繼續', '一起', '辦法', '為什', '為何', '如何',
  '不會', '不能', '不要', '不用', '不過', '而已', '例如', '譬如', '到底', '難道',
  '真正', '以上', '以下', '往後', '之後會', '身邊', '家人', '有些', '這種', '那種',
  // latin / url noise (english function words: latin tokens are min length 2)
  'the', 'and', 'for', 'you', 'this', 'that', 'with', 'are', 'was', 'were', 'not',
  'have', 'has', 'had', 'but', 'all', 'can', 'will', 'just', 'like', 'get', 'got',
  'one', 'now', 'out', 'your', 'from', 'they', 'them', 'she', 'his', 'her', 'its',
  'to', 'of', 'in', 'is', 'it', 'im', 'my', 'me', 'be', 'on', 'at', 'as', 'we',
  'do', 'so', 'no', 'if', 'or', 'he', 'an', 'us', 'am', 'by', 'up',
  'https', 'http', 'com', 'www', 'threads', 'instagram', 'reels',
]);

// A CJK n-gram starting or ending with any of these is a grammatically-broken
// fragment (「的大人」「大人了」) — reject cheaply instead of segmenting.
const BOUNDARY_CHARS = new Set(
  '的了嗎吧呢啊喔欸耶啦唷哦呀就也都很才又再被把跟和或而在是有沒不我你他她它們個得地之於與對讓給到從向這那些麼一'.split(''),
);

// Numeral+measure-word fragments (一天/一個月/第一/三小時) rank high in any scan
// but are never a topic — reject them structurally instead of enumerating.
const NUMERAL_MEASURE =
  /^第?[一二兩三四五六七八九十百千萬億幾半數0-9]+(個月|小時|分鐘|天|月|年|次|個|歲|點|篇|人|件|樣|種|條|句|步|名|位|倍|折|元|塊|萬|千|號|樓|集|季|波|場|間|台|隻|張|杯|碗|口|頓|遍|回|款|部|支|門|批|組|排|層|級|份|題|字|秒|堂|節|星期|禮拜)?$/;

const NGRAM_MIN = 2;
const NGRAM_MAX = 6;
const RUN_CAP = 30; // cap each CJK run before n-gram expansion to bound cost
const RECENCY_HALF_WINDOW_SEC = 48 * 3600;

/**
 * All candidate terms in one post, each counted once (drives document frequency).
 * `tags` marks which candidates appeared as an explicit #hashtag — author-declared
 * topics, boosted at scoring time.
 */
function candidatesOf(text: string): { terms: Set<string>; tags: Set<string> } {
  const found = new Set<string>();
  const tags = new Set<string>();

  const push = (raw: string, isTag = false) => {
    const term = raw.trim();
    if (!term || /\s/.test(term) || /^\d+$/.test(term)) return;
    if (NUMERAL_MEASURE.test(term)) return;
    if (STOPWORDS.has(term.toLowerCase())) return;
    found.add(term);
    if (isTag) tags.add(term);
  };

  // 1. Hashtags (Threads topic tags appear inline in the text).
  for (const m of text.matchAll(/#([\p{L}\p{N}_一-鿿]+)/gu)) push(m[1], true);

  // 2. CJK n-grams: expand every 2–6-char substring of each CJK run, rejecting
  //    fragments whose first/last char is a particle/pronoun.
  for (const m of text.matchAll(/[一-鿿]{2,}/g)) {
    const run = m[0].slice(0, RUN_CAP);
    for (let len = NGRAM_MIN; len <= Math.min(NGRAM_MAX, run.length); len++) {
      for (let i = 0; i + len <= run.length; i++) {
        const gram = run.slice(i, i + len);
        if (BOUNDARY_CHARS.has(gram[0]) || BOUNDARY_CHARS.has(gram[len - 1])) continue;
        push(gram);
      }
    }
  }

  // 3. Latin tokens (AI, MBTI, vibe…), lowercased so casing variants merge.
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9]{1,19}/g)) push(m[0].toLowerCase());

  return { terms: found, tags };
}

/**
 * Collapse near-duplicate posts (copypasta content farms post the same template
 * from dozens of accounts, which would let template phrases fake a high document
 * frequency). Shingle-Jaccard on the first 200 chars; keeps the highest-engagement
 * representative of each template.
 */
function collapseNearDuplicates<T extends { post: NormalizedPost }>(tagged: T[]): T[] {
  const shinglesOf = (text: string): Set<string> => {
    const t = text.slice(0, 200);
    const out = new Set<string>();
    for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  const jaccard = (a: Set<string>, b: Set<string>): number => {
    let inter = 0;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    for (const s of small) if (big.has(s)) inter++;
    return inter / (a.size + b.size - inter || 1);
  };

  const byEngagement = [...tagged].sort(
    (a, b) => b.post.likes + b.post.replies - (a.post.likes + a.post.replies),
  );
  const kept: Array<{ item: T; sh: Set<string> }> = [];
  for (const item of byEngagement) {
    const sh = shinglesOf(item.post.text);
    if (!kept.some((k) => jaccard(sh, k.sh) > 0.5)) kept.push({ item, sh });
  }
  return kept.map((k) => k.item);
}

export function mineHotTopics(
  tagged: Array<{ post: NormalizedPost; seed: string }>,
  opts: { exclude?: string[]; limit?: number; nowSec?: number; maxAgeSec?: number } = {},
): HotTopic[] {
  tagged = collapseNearDuplicates(tagged);
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const maxAgeSec = opts.maxAgeSec ?? 14 * 86400;
  const exclude = new Set((opts.exclude ?? []).map((s) => s.trim().toLowerCase()));
  const totalSeeds = new Set(tagged.map((t) => t.seed)).size || 1;

  interface Stat {
    posts: NormalizedPost[];
    seeds: Set<string>;
    engagement: number;
    recencySum: number;
    isHashtag: boolean;
  }
  const stats = new Map<string, Stat>();

  for (const { post, seed } of tagged) {
    const engagement = post.likes + post.replies;
    const recency = post.takenAt
      ? Math.exp(-Math.max(0, nowSec - post.takenAt) / RECENCY_HALF_WINDOW_SEC)
      : 0.5;
    const { terms, tags } = candidatesOf(post.text);
    for (const term of terms) {
      if (exclude.has(term.toLowerCase())) continue; // never surface a seed as a "discovery"
      let s = stats.get(term);
      if (!s)
        stats.set(term, (s = { posts: [], seeds: new Set(), engagement: 0, recencySum: 0, isHashtag: false }));
      s.posts.push(post);
      s.seeds.add(seed);
      s.engagement += engagement;
      s.recencySum += recency;
      if (tags.has(term)) s.isHashtag = true;
    }
  }

  // Breadth threshold: a term must appear across several distinct posts.
  const minDf = tagged.length >= 80 ? 3 : 2;

  const scored = [...stats.entries()]
    .filter(([, s]) => s.posts.length >= minDf)
    // Generic-vocabulary filter: a real topic concentrates in the results of a few
    // seeds; a term spread across half+ of a diverse seed pool (另外/只要/繼續…)
    // is just how people write, not what they're talking about.
    .filter(([, s]) => totalSeeds < 4 || s.seeds.size / totalSeeds < 0.5)
    // Freshness gate for "rising now": if we know the newest post's age and it's
    // older than maxAgeSec, this is an old viral thread the search surfaced, not
    // a current topic.
    .filter(([, s]) => {
      const newest = Math.max(...s.posts.map((p) => p.takenAt ?? 0));
      return newest === 0 || nowSec - newest <= maxAgeSec;
    })
    .map(([term, s]) => {
      const df = s.posts.length;
      const avgRecency = s.recencySum / df;
      // Name-shape priors: everyday 2-char CJK words (心情/重要) fake breadth in any
      // corpus, while coined meme names run 3+ chars (初級大人) — so 2-char pure-CJK
      // terms are damped and longer ones boosted. An explicit #hashtag is an
      // author-declared topic → boosted.
      const cjkOnly = /^[一-鿿]+$/.test(term);
      const lenFactor = !cjkOnly ? 1 : term.length === 2 ? 0.6 : term.length === 3 ? 1 : 1.25;
      const tagFactor = s.isHashtag ? 1.5 : 1;
      // df dominates (breadth of conversation); engagement is log-damped so one
      // whale post can't crown its every bigram; recency multiplies in 0.5–1.5.
      const score = df * (1 + Math.log10(1 + s.engagement)) * (0.5 + avgRecency) * lenFactor * tagFactor;
      return { term, df, engagement: s.engagement, score, posts: s.posts };
    });

  // Substring dedup, longest-first: a shorter candidate riding a longer term's
  // posts (初級大人 → 級大人) is dropped unless it's genuinely broader.
  scored.sort((a, b) => b.term.length - a.term.length || b.score - a.score);
  const kept: typeof scored = [];
  for (const c of scored) {
    const shadowedBy = kept.find((k) => k.term.includes(c.term) && c.df <= k.df * 1.5);
    if (!shadowedBy) kept.push(c);
  }

  kept.sort((a, b) => b.score - a.score);

  // Diversity pass: several phrases of one template family (copypasta farms)
  // survive everything above as distinct terms backed by the SAME posts. Greedily
  // select by score, skipping any candidate whose post set mostly overlaps an
  // already-selected topic — one slot per underlying conversation.
  const postKey = (p: NormalizedPost) => p.url ?? p.text.slice(0, 80);
  const limit = opts.limit ?? 10;
  const selected: Array<{ c: (typeof kept)[number]; keys: Set<string> }> = [];
  for (const c of kept) {
    if (selected.length >= limit) break;
    const keys = new Set(c.posts.map(postKey));
    const dominated = selected.some(({ keys: sk }) => {
      let inter = 0;
      for (const k of keys) if (sk.has(k)) inter++;
      return inter / Math.min(keys.size, sk.size) > 0.6;
    });
    if (!dominated) selected.push({ c, keys });
  }

  // Samples: fresh posts first (an old viral whale misrepresents the current
  // wave), then by engagement.
  const isFresh = (p: NormalizedPost) => p.takenAt != null && nowSec - p.takenAt <= maxAgeSec;
  return selected.map(({ c }) => ({
    term: c.term,
    postCount: c.df,
    engagement: c.engagement,
    score: c.score,
    samples: [...c.posts]
      .sort(
        (a, b) =>
          Number(isFresh(b)) - Number(isFresh(a)) || b.likes + b.replies - (a.likes + a.replies),
      )
      .slice(0, 3),
  }));
}
