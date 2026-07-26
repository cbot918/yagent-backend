import { config } from '../config.js';
import { withPage } from '../browser/manager.js';
import type { Tool } from './types.js';

/**
 * End-to-end acceptance probe. Runs a checklist of "call this, expect that" items against
 * a deployed app and reports what actually happened, so a role can judge whether a feature
 * really works — without reading the code that implements it.
 *
 * Security posture is an ALLOWLIST (`E2E_ALLOWED_ORIGINS`), not the blocklist `browse` uses.
 * Acceptance targets are your own localhost/staging origins — precisely the hosts browse's
 * SSRF guard blocks — so naming the handful of reachable origins is both what makes this
 * tool usable and tighter than browse: anything not listed is unreachable, including hosts
 * a blocklist would have missed.
 */

const MAX_BODY_CHARS = 2000;
const MAX_CHECKS = 20;

interface Check {
  name?: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  mode?: 'http' | 'page';
  selector?: string;
  expectStatus?: number;
  expectContains?: string;
}

/** Allowed origins, normalized once. Invalid entries are dropped rather than crashing boot. */
const allowedOrigins = new Set(
  config.e2eAllowedOrigins.flatMap((entry) => {
    try {
      return [new URL(entry).origin];
    } catch {
      return [];
    }
  }),
);

function checkOrigin(raw: string): { url: URL } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: `invalid URL "${raw}"` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `only http(s) URLs are allowed (got "${url.protocol}")` };
  }
  if (!allowedOrigins.has(url.origin)) {
    return {
      error:
        `origin "${url.origin}" is not in E2E_ALLOWED_ORIGINS ` +
        `(allowed: ${[...allowedOrigins].join(', ') || 'none'})`,
    };
  }
  return { url };
}

function truncate(text: string): string {
  return text.length > MAX_BODY_CHARS
    ? `${text.slice(0, MAX_BODY_CHARS)}\n  … (${text.length - MAX_BODY_CHARS} more chars)`
    : text;
}

/** Runs one check and renders it as a block the model can judge. Never throws. */
async function runCheck(check: Check, index: number): Promise<{ text: string; passed: boolean | null }> {
  const label = `${index + 1}. ${check.name ?? `${(check.method ?? 'GET').toUpperCase()} ${check.url}`}`;
  const guard = checkOrigin(check.url);
  if ('error' in guard) {
    return { text: `${label}\n  BLOCKED: ${guard.error}`, passed: false };
  }

  const started = Date.now();
  let status: number | null = null;
  let payload: string;

  try {
    if (check.mode === 'page') {
      if (!config.allowBrowser) {
        return {
          text: `${label}\n  BLOCKED: mode="page" needs ALLOW_BROWSER=true; use mode="http" instead.`,
          passed: false,
        };
      }
      payload = await withPage(async (page) => {
        const res = await page.goto(guard.url.href, {
          waitUntil: 'domcontentloaded',
          timeout: config.e2eTimeoutMs,
        });
        status = res?.status() ?? null;
        const target = check.selector ? page.locator(check.selector).first() : page.locator('body');
        return (await target.innerText()).trim();
      });
    } else {
      const res = await fetch(guard.url, {
        method: (check.method ?? 'GET').toUpperCase(),
        headers: { ...(check.headers ?? {}) },
        body: check.body,
        signal: AbortSignal.timeout(config.e2eTimeoutMs),
      });
      status = res.status;
      payload = await res.text();
    }
  } catch (err) {
    const ms = Date.now() - started;
    return {
      text: `${label}\n  FAIL: request failed after ${ms}ms — ${err instanceof Error ? err.message : String(err)}`,
      passed: false,
    };
  }

  const ms = Date.now() - started;
  const lines = [label, `  status: ${status ?? 'n/a'}`, `  time: ${ms}ms`];

  // Only claim pass/fail for expectations the caller actually stated; otherwise report and
  // let the model judge — an acceptance call is often "does this look right", not an assert.
  let passed: boolean | null = null;
  if (check.expectStatus != null) {
    const ok = status === check.expectStatus;
    passed = ok;
    lines.push(`  expect status ${check.expectStatus}: ${ok ? 'PASS' : 'FAIL'}`);
  }
  if (check.expectContains != null) {
    const ok = payload.includes(check.expectContains);
    passed = passed === null ? ok : passed && ok;
    lines.push(`  expect contains ${JSON.stringify(check.expectContains)}: ${ok ? 'PASS' : 'FAIL'}`);
  }
  lines.push(`  ${check.mode === 'page' ? 'page text' : 'response body'}:\n  ${truncate(payload).replace(/\n/g, '\n  ')}`);

  return { text: lines.join('\n'), passed };
}

export const smokeCheckTool: Tool = {
  name: 'smoke_check',
  description:
    'Run an end-to-end acceptance checklist against a running app and report what actually happened: HTTP status, response body, or the rendered text of a page. Use it to verify that key features really work before signing off — you do not need to read the source. Pass the whole checklist in ONE call (each item is one "call this, expect that"). Set expectStatus/expectContains to get an explicit PASS/FAIL; leave them off to just look at the result and judge for yourself. Only origins configured in E2E_ALLOWED_ORIGINS are reachable.',
  parameters: {
    type: 'object',
    properties: {
      checks: {
        type: 'array',
        description: `The checklist, run in order (max ${MAX_CHECKS}).`,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'What this checks, in plain language — shown in the report.' },
            url: { type: 'string', description: 'Full http(s) URL of an allowed origin.' },
            method: { type: 'string', description: 'HTTP method (default GET). Ignored when mode is "page".' },
            headers: {
              type: 'object',
              description: 'Extra request headers, e.g. {"content-type":"application/json"}.',
              additionalProperties: { type: 'string' },
            },
            body: { type: 'string', description: 'Request body, already serialized (e.g. a JSON string).' },
            mode: {
              type: 'string',
              enum: ['http', 'page'],
              description: '"http" (default) calls the endpoint directly. "page" loads the URL in a headless browser and returns the RENDERED text — use it for UI checks on a JS-rendered app.',
            },
            selector: { type: 'string', description: 'mode="page" only: CSS selector to read text from instead of the whole body.' },
            expectStatus: { type: 'number', description: 'Assert the HTTP status equals this.' },
            expectContains: { type: 'string', description: 'Assert the response body / page text contains this substring.' },
          },
          required: ['url'],
        },
      },
    },
    required: ['checks'],
  },
  async run(args) {
    const { checks } = (args ?? {}) as { checks?: Check[] };
    if (!Array.isArray(checks) || checks.length === 0) return 'Error: "checks" must be a non-empty array.';
    if (checks.length > MAX_CHECKS) return `Error: too many checks (${checks.length}); max ${MAX_CHECKS} per call.`;

    const results = [];
    for (const [i, check] of checks.entries()) {
      results.push(await runCheck(check, i));
    }

    const asserted = results.filter((r) => r.passed !== null);
    const failed = asserted.filter((r) => r.passed === false).length;
    const summary = asserted.length
      ? `${asserted.length - failed}/${asserted.length} asserted checks passed` +
        (results.length > asserted.length ? `; ${results.length - asserted.length} reported without assertions` : '')
      : `${results.length} checks reported (no assertions given — judge the output yourself)`;

    return `SMOKE CHECK — ${summary}\n\n${results.map((r) => r.text).join('\n\n')}`;
  },
};
