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
  // When a PaaS injects PORT, bind that exact port (the platform routes to it).
  // Locally (no PORT) we may auto-scan upward if the port is busy.
  portFromPaaS: process.env.PORT != null,
  // Allowed CORS origin for the REST API when the frontend is deployed separately.
  // Set to the web UI's URL in prod; '*' is fine for local/demo.
  webOrigin: process.env.WEB_ORIGIN ?? '*',

  // Coding-agent dispatch (the swappable sub-harness for heavy coding tasks).
  // claude = Claude Code; opencode = opencode (point at OpenRouter via OPENCODE_MODEL).
  codingAgent: (process.env.CODING_AGENT ?? 'claude') as 'claude' | 'opencode',
  codingAgentTimeoutMs: Number(process.env.CODING_AGENT_TIMEOUT_MS ?? 600000),
  claudeBin: process.env.CLAUDE_BIN ?? 'claude',
  claudeModel: process.env.CLAUDE_MODEL ?? '', // '' = harness default
  // Headless harness has no TTY to answer permission prompts; allow it to act.
  // Self-use only. Set CLAUDE_YOLO=false to require a permissioned setup instead.
  claudeYolo: process.env.CLAUDE_YOLO !== 'false',
  opencodeBin: process.env.OPENCODE_BIN ?? 'opencode',
  opencodeModel: process.env.OPENCODE_MODEL ?? 'openrouter/anthropic/claude-3.5-sonnet',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',

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

  // Threads trend scraping via EnsembleData's unofficial API (free tier: 50 units/day).
  // Get a token at https://ensembledata.com (top-left of the dashboard). Tool self-disables when unset.
  ensembledataToken: process.env.ENSEMBLEDATA_TOKEN ?? '',
  ensembledataBaseUrl: process.env.ENSEMBLEDATA_BASE_URL ?? 'https://ensembledata.com/apis',
  // Default Threads data backend: 'ensembledata' (metered API) | 'browser' (free headless scrape).
  // A role can override this; on quota exhaustion we auto-fall back to browser when THREADS_FALLBACK
  // is on and ALLOW_BROWSER=true.
  threadsSource: process.env.THREADS_SOURCE ?? 'ensembledata',
  threadsFallback: process.env.THREADS_FALLBACK !== 'false',

  // Voice transcription (separate from the chat LLM — OPENAI_BASE_URL/OpenRouter
  // does not serve /audio/transcriptions). Powers the web UI mic fallback.
  voiceApiUrl: process.env.VOICE_API_URL ?? 'https://api.openai.com/v1',
  voiceApiKey: process.env.VOICE_API_KEY ?? '',
  voiceModel: process.env.VOICE_MODEL ?? 'whisper-1',

  // GEO diagnosis (Generative Engine Optimization). A deliverable job: probes AI
  // engines with a fixed vertical question set and reports how they portray a
  // company. Data files are files-as-truth under knowledge/geo/ (cwd-relative).
  geoEnginesFile: process.env.GEO_ENGINES_FILE ?? './knowledge/geo/engines.json',
  geoQuestionsFile: process.env.GEO_QUESTIONS_FILE ?? './knowledge/geo/questions.zh-tw.json',
  geoProfileFile: process.env.GEO_PROFILE_FILE ?? './knowledge/geo/eai-profile.md',
  // Judge/synthesis model (cheap, JSON output). '' = fall back to OPENAI_MODEL.
  geoJudgeModel: process.env.GEO_JUDGE_MODEL ?? '',
};
