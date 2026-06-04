import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config.js';
import { bus } from '../events.js';
import { loadSession } from '../session.js';
import { readMemory } from '../memory/memory.js';
import { isVoiceConfigured, transcribe } from '../voice.js';
import type { Channel, MessageHandler } from './types.js';

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

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
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

export function createWebChannel(): Channel {
  let messageHandler: MessageHandler;
  const clients = new Set<WebSocket>();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    handleApi(req, res, url).then((handled) => {
      if (!handled) void serveStatic(req, res, url);
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

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
        const msg = JSON.parse(raw.toString()) as { type?: string; sessionKey?: string; text?: string };
        if (msg.type === 'send' && msg.sessionKey && msg.text && messageHandler) {
          void messageHandler({ sessionKey: msg.sessionKey, text: msg.text });
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
      await new Promise<void>((resolve) => server.listen(config.webPort, resolve));
      console.log(`[web] UI server on http://localhost:${config.webPort} (ws: /ws)`);
    },

    // No-op: the browser renders replies from the `turn:end` event on the bus,
    // which already carries finalText for every channel.
    async sendReply() {},
  };
}
