import { config } from '../config.js';

export type EaiErpResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * POST to the eai-erp backend and unwrap its `Response<T>` envelope.
 * Machine auth = the X-Service-Token header (shared secret). The base URL comes from
 * trusted config, so — unlike the model-driven browse tool — it is NOT run through an
 * SSRF guard (the backend commonly lives on a private host).
 *
 * `token` picks which machine identity to present. Each module has its own token mapped
 * server-side to a role with only that module's permissions (quote → `AGENT`,
 * swpm → `AGENT_SWPM`), so a leaked token cannot reach the other module. Defaults to the
 * quote token for callers that predate the split.
 *
 * Business errors surface as HTTP 200 with code != 200 (per the backend contract) — that
 * includes a permission denial (`code: 403`), so a token used against the wrong module
 * comes back here as `{ ok: false, error: '無使用權限' }`. Only a missing/blank Bearer +
 * service token yields a real 401.
 */
export async function eaiErpPost<T>(
  path: string,
  body: unknown,
  opts: { token?: string } = {},
): Promise<EaiErpResult<T>> {
  if (!config.eaiErpBaseUrl) return { ok: false, error: 'EAIERP_BASE_URL not set' };
  const token = opts.token ?? config.eaiErpServiceToken;

  let res: Response;
  try {
    res = await fetch(new URL(path, config.eaiErpBaseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': token,
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return { ok: false, error: `request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const text = await res.text();
  if (res.status === 401) return { ok: false, error: 'unauthorized (check the service token)' };
  if (!res.ok) return { ok: false, error: `backend ${res.status}: ${text.slice(0, 300)}` };

  let parsed: { code?: number; message?: string; data?: T };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `bad JSON from backend: ${text.slice(0, 200)}` };
  }
  if (parsed.code !== 200) return { ok: false, error: parsed.message ?? `business error code=${parsed.code}` };
  return { ok: true, data: parsed.data as T };
}

/** POST to a software-project (swpm) endpoint with that module's own service token. */
export function swpmPost<T>(path: string, body: unknown): Promise<EaiErpResult<T>> {
  return eaiErpPost<T>(path, body, { token: config.eaiErpSwpmToken });
}

/** POST to a todo/outcome endpoint with that module's own service token (→ AGENT_TODO). */
export function todoPost<T>(path: string, body: unknown): Promise<EaiErpResult<T>> {
  return eaiErpPost<T>(path, body, { token: config.eaiErpTodoToken });
}
