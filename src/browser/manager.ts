import { chromium, type Browser, type Page } from 'playwright';
import { config } from '../config.js';

/**
 * A single shared headless Chromium, launched lazily and reused across calls
 * (launching per call is slow). Each call gets a fresh BrowserContext + Page
 * for clean, isolated state. Mirrors the sandbox singleton + shutdown-cleanup
 * pattern in src/sandbox/index.ts.
 */
let browserPromise: Promise<Browser> | null = null;
let cleanupRegistered = false;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: config.browserHeadless }).catch((err) => {
      browserPromise = null; // allow retry after a fix
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to launch Chromium: ${msg}\nIf the browser is not installed, run: npx playwright install chromium`,
      );
    });
    registerCleanup();
  }
  return browserPromise;
}

function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await closeBrowser().catch(() => {});
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => void close().finally(() => process.exit(0)));
  }
  process.once('beforeExit', () => void close());
}

/** Run `fn` against a fresh page, always tearing the context down afterwards. */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await context.close().catch(() => {});
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  await p.then((b) => b.close()).catch(() => {});
}
