import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config.js';
import { bus } from '../events.js';
import { loadSession } from '../session.js';
import { readMemory } from '../memory/memory.js';
import { loadRoles, saveRole } from '../roles/loader.js';
import type { RolePatch } from '../roles/loader.js';
import { listCodingAgents } from '../coding-agent/index.js';
import { listThreadsSources } from '../threads/index.js';
import { loadBilling, readUsage, summarize, evaluateBudgets } from '../usage/index.js';
import { readThreadsLog, countToday } from '../monitor/threadsLog.js';
import { listRooms, loadRoom, addParticipant, removeParticipant } from '../rooms/store.js';
import { isVoiceConfigured, transcribe } from '../voice.js';
import type { Channel, MessageHandler } from './types.js';
import type { ToolRegistry } from '../tools/types.js';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Whisper's per-request limit


/** Collect a request body into a Buffer, rejecting bodies over the cap. */
function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_AUDIO_BYTES) {
        reject(new Error('audio too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Listen on `startPort`, scanning upward on EADDRINUSE up to `maxExtra` times.
 * Resolves with the port actually bound. maxExtra=0 → try exactly one port
 * (used on a PaaS, where the injected PORT must be honoured).
 */
function listenWithRetry(server: http.Server, startPort: number, maxExtra: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && tries < maxExtra) {
        tries++;
        port++;
        console.warn(`[web] port ${port - 1} in use, trying ${port}…`);
        server.listen(port);
      } else {
        server.off('error', onError);
        reject(err);
      }
    };
    server.on('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      resolve(port);
    });
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In prod (dist/channels/web.js) the built frontend lives at <repo>/web/dist.
const WEB_DIST = path.resolve(__dirname, '../../web/dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Allow the separately-deployed web UI to call the API cross-origin. */
function setCors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', config.webOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  setCors(res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

async function listSessionKeys(): Promise<string[]> {
  try {
    const files = await fs.readdir(path.join(config.workspaceDir, '.sessions'));
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  registry: ToolRegistry,
): Promise<boolean> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/')) return false;

  // CORS preflight (e.g. the audio/webm POST to /api/transcribe is non-simple).
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  // Speech-to-text fallback for browsers without the Web Speech API.
  if (pathname === '/api/transcribe' && req.method === 'POST') {
    if (!isVoiceConfigured()) {
      sendJson(res, 503, { error: 'voice transcription not configured (set VOICE_API_KEY)' });
      return true;
    }
    try {
      const audio = await readBody(req);
      const text = await transcribe(audio, req.headers['content-type'] ?? 'audio/webm');
      sendJson(res, 200, { text });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/api/roles' && req.method === 'GET') {
    sendJson(res, 200, { roles: await loadRoles() });
    return true;
  }

  // Available tool names (for the settings UI tool allowlist).
  if (pathname === '/api/tools') {
    sendJson(res, 200, { tools: registry.getAll().map((t) => ({ name: t.name, description: t.description })) });
    return true;
  }

  // Available coding harnesses (the swappable-harness registry).
  if (pathname === '/api/agents') {
    sendJson(res, 200, { agents: listCodingAgents() });
    return true;
  }

  // Available Threads data sources (for the role settings toggle).
  if (pathname === '/api/threads-sources') {
    sendJson(res, 200, { sources: listThreadsSources() });
    return true;
  }

  // Persist a role config edit: POST /api/roles/:id  { model?, codingAgent?, tools?, skills?, knowledge?, actionMode? }
  const roleMatch = pathname.match(/^\/api\/roles\/([^/]+)$/);
  if (roleMatch && req.method === 'POST') {
    const id = decodeURIComponent(roleMatch[1]);
    try {
      const body = (await readBody(req)).toString('utf8');
      const patch = (body ? JSON.parse(body) : {}) as RolePatch;
      const updated = await saveRole(id, patch);
      sendJson(res, 200, { role: updated });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  if (pathname === '/api/usage') {
    const entries = await readUsage();
    const { keys, budgets } = await loadBilling();
    sendJson(res, 200, {
      summary: summarize(entries),
      recent: entries.slice(-100).reverse(),
      keys,
      budgets: await evaluateBudgets(budgets),
    });
    return true;
  }

  // Room channels: list rooms / read one room (with transcript) / edit participants.
  if (pathname === '/api/rooms' && req.method === 'GET') {
    sendJson(res, 200, { rooms: await listRooms() });
    return true;
  }
  const roomMatch = pathname.match(/^\/api\/rooms\/([^/]+)(\/participants)?$/);
  if (roomMatch) {
    const roomId = decodeURIComponent(roomMatch[1]);
    if (roomMatch[2] && req.method === 'POST') {
      try {
        const body = (await readBody(req)).toString('utf8');
        const { add, remove } = (body ? JSON.parse(body) : {}) as { add?: string; remove?: string };
        let room = add ? await addParticipant(roomId, add) : null;
        if (remove) room = await removeParticipant(roomId, remove);
        sendJson(res, 200, { room: room ?? (await loadRoom(roomId)) });
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }
    if (req.method === 'GET') {
      const room = await loadRoom(roomId);
      if (room) sendJson(res, 200, { room });
      else sendJson(res, 404, { error: `unknown room "${roomId}"` });
      return true;
    }
  }

  // Monitor: the threads_trend call log (files-as-truth in .monitor/threads.jsonl).
  if (pathname === '/api/monitor/threads') {
    sendJson(res, 200, { entries: await readThreadsLog(200), todayCount: await countToday() });
    return true;
  }

  if (pathname === '/api/sessions') {
    sendJson(res, 200, { sessions: await listSessionKeys() });
    return true;
  }

  // /api/sessions/:key  and  /api/sessions/:key/memory
  const m = pathname.match(/^\/api\/sessions\/([^/]+)(\/memory)?$/);
  if (m) {
    const key = decodeURIComponent(m[1]);
    if (m[2]) {
      sendJson(res, 200, { sessionKey: key, memory: await readMemory(key) });
    } else {
      sendJson(res, 200, { sessionKey: key, messages: await loadSession(key) });
    }
    return true;
  }

  sendJson(res, 404, { error: 'not found' });
  return true;
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  let filePath = path.resolve(WEB_DIST, rel);
  // Prevent path traversal outside the dist dir.
  if (!filePath.startsWith(WEB_DIST)) filePath = path.join(WEB_DIST, 'index.html');

  try {
    let data = await fs.readFile(filePath).catch(async () => {
      // SPA fallback: unknown route → index.html
      return fs.readFile(path.join(WEB_DIST, 'index.html'));
    });
    const ext = path.extname(filePath) || '.html';
    res.writeHead(200, { 'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. Run `npm run web:build` to build the UI, or use the Vite dev server.');
  }
}

export function createWebChannel(registry: ToolRegistry): Channel {
  let messageHandler: MessageHandler;
  const clients = new Set<WebSocket>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    handleApi(req, res, url, registry).then((handled) => {
      if (!handled) void serveStatic(req, res, url);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  // In `{ server }` mode the WSS re-emits the http server's listen errors; without
  // a handler an EADDRINUSE during port-scanning would crash as an unhandled
  // 'error'. Swallow it here — listenWithRetry drives the actual retry/reject.
  wss.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') console.error('[web] websocket server error:', err);
  });

  // Fan every agent event out to all connected browsers.
  bus.onEvent((event) => {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          sessionKey?: string;
          text?: string;
          roleId?: string;
          actionMode?: 'act' | 'advise';
        };
        if (msg.type === 'send' && msg.sessionKey && msg.text && messageHandler) {
          // Catch so a failing turn can't become an unhandled rejection (which
          // would crash the whole process and drop every WebSocket).
          void messageHandler({ sessionKey: msg.sessionKey, text: msg.text, roleId: msg.roleId, actionMode: msg.actionMode }).catch((err) => {
            console.error('[web] handler error:', err);
          });
        }
      } catch {
        /* ignore malformed frames */
      }
    });
  });

  return {
    name: 'web',

    async start(onMessage: MessageHandler) {
      messageHandler = onMessage;
      // On a PaaS (PORT injected) bind exactly; locally scan upward if busy.
      const port = await listenWithRetry(server, config.webPort, config.portFromPaaS ? 0 : 10);
      console.log(`[web] UI server on http://localhost:${port} (ws: /ws)`);
    },

    // No-op: the browser renders replies from the `turn:end` event on the bus,
    // which already carries finalText for every channel.
    async sendReply() {},
  };
}
