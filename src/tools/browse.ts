import { config } from '../config.js';
import { withPage } from '../browser/manager.js';
import type { Tool } from './types.js';

const MAX_OUTPUT = 8000; // chars of page text returned to the model

/**
 * Guard against SSRF: the agent picks the URL, so block schemes and hosts that
 * could reach local services or cloud metadata. Returns an error string to show
 * the model, or null if the URL is allowed.
 */
function checkUrl(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `Error: invalid URL "${raw}"` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `Error: only http(s) URLs are allowed (got "${url.protocol}")` };
  }
  const host = url.hostname.toLowerCase();
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254'];
  const isPrivate =
    blockedHosts.includes(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    host.endsWith('.localhost');
  if (isPrivate) {
    return { error: `Error: blocked host "${host}" (local/private/metadata addresses are not allowed)` };
  }
  return { url };
}

export const browseTool: Tool = {
  name: 'browse',
  description:
    'Open a web page in a headless browser and return its visible text. Handles JavaScript-rendered pages. ' +
    'Use this to read live web content such as news headlines, articles, or search results.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The http(s) URL to open' },
      selector: {
        type: 'string',
        description: 'Optional CSS selector to extract text from only part of the page (defaults to the whole body)',
      },
    },
    required: ['url'],
  },
  async run(args) {
    const { url, selector } = args as { url: string; selector?: string };

    const checked = checkUrl(url);
    if ('error' in checked) return checked.error;

    return withPage(async (page) => {
      try {
        await page.goto(checked.url.href, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
      } catch (err) {
        return `Error: failed to load ${checked.url.href}: ${err instanceof Error ? err.message : String(err)}`;
      }

      const title = await page.title().catch(() => '');
      let text = '';
      try {
        text = await (selector ? page.locator(selector).first() : page.locator('body')).innerText({
          timeout: 5000,
        });
      } catch (err) {
        return `Error: could not extract text${selector ? ` for selector "${selector}"` : ''}: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      const truncated = text.length > MAX_OUTPUT;
      if (truncated) text = text.slice(0, MAX_OUTPUT) + '\n…[truncated]';

      return [`Title: ${title}`, `URL: ${checked.url.href}`, '', text || '(no visible text found)'].join('\n');
    });
  },
};
