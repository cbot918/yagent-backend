import 'dotenv/config';
import path from 'path';

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? '',
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  discordToken: process.env.DISCORD_TOKEN ?? '',
  allowShell: process.env.ALLOW_SHELL === 'true',
  workspaceDir: path.resolve(process.env.WORKSPACE_DIR ?? './workspace'),
  enableWeb: process.env.ENABLE_WEB === 'true',
  // PORT is injected by most PaaS (Zeabur/Railway/etc); fall back to WEB_PORT then 3001.
  webPort: Number(process.env.PORT ?? process.env.WEB_PORT ?? 3001),
  // Allowed CORS origin for the REST API when the frontend is deployed separately.
  // Set to the web UI's URL in prod; '*' is fine for local/demo.
  webOrigin: process.env.WEB_ORIGIN ?? '*',

  // Shell sandbox: host (dev only) | docker | e2b
  shellBackend: (process.env.SHELL_BACKEND ?? 'host') as 'host' | 'docker' | 'e2b',
  shellTimeoutMs: Number(process.env.SHELL_TIMEOUT_MS ?? 15000),
  sandboxImage: process.env.SANDBOX_IMAGE ?? 'node:22-alpine',
  sandboxNetwork: process.env.SANDBOX_NETWORK ?? 'none', // 'none' blocks curl; 'bridge' allows outbound
  sandboxMemory: process.env.SANDBOX_MEMORY ?? '512m',
  sandboxCpus: Number(process.env.SANDBOX_CPUS ?? 1),
  e2bApiKey: process.env.E2B_API_KEY ?? '',

  // Browser tool (local headless Playwright)
  allowBrowser: process.env.ALLOW_BROWSER === 'true',
  browserHeadless: process.env.BROWSER_HEADLESS !== 'false',
  browserTimeoutMs: Number(process.env.BROWSER_TIMEOUT_MS ?? 30000),

  // Voice transcription (separate from the chat LLM — OPENAI_BASE_URL/OpenRouter
  // does not serve /audio/transcriptions). Powers the web UI mic fallback.
  voiceApiUrl: process.env.VOICE_API_URL ?? 'https://api.openai.com/v1',
  voiceApiKey: process.env.VOICE_API_KEY ?? '',
  voiceModel: process.env.VOICE_MODEL ?? 'whisper-1',
};
