/**
 * Swappable Threads data source — mirrors the sandbox/Executor and
 * coding-agent/CodingAgent pattern. One interface, multiple backends selected by
 * `getThreadsSource()`. This is what lets a role flip between the metered
 * EnsembleData API and a free (but heavier) headless-browser scrape when the
 * daily API units run out.
 */

export interface NormalizedPost {
  username: string;
  text: string;
  likes: number;
  replies: number;
  /** Permalink to the post (https://www.threads.com/@user/post/<code>), when derivable. */
  url?: string;
  /** Unix seconds when the post was created (Threads `taken_at`), when present. */
  takenAt?: number;
}

export interface SearchResult {
  ok: boolean;
  /** HTTP status when meaningful (200 ok, 495 = EnsembleData quota); 0 otherwise. */
  httpStatus: number;
  posts: NormalizedPost[];
  /** Units the API charged, when it reports them (EnsembleData only). */
  units?: number;
  /** Error detail when !ok. */
  error?: string;
  /** True when the failure is specifically daily-quota exhaustion (triggers fallback). */
  quota?: boolean;
}

export interface ThreadsSource {
  /** Backend id — matches the key in the factory registry. */
  name: string;
  search(keyword: string, sort: 'top' | 'recent'): Promise<SearchResult>;
}
