import 'dotenv/config';
import path from 'path';

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? '',
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  discordToken: process.env.DISCORD_TOKEN ?? '',
  allowShell: process.env.ALLOW_SHELL === 'true',
  workspaceDir: path.resolve(process.env.WORKSPACE_DIR ?? './workspace'),
  // A second, READ-ONLY guarded root covering the other repos on this machine, so a role can
  // inspect a project's docs/config without paying a coding-harness dispatch just to read a
  // file. Mirrors `resolveInKnowledge`'s pattern rather than widening WORKSPACE_DIR — which
  // would also widen write_file/shell, and would relocate .sessions/.memory along with it.
  // Empty (default) = the project-read tools are not registered.
  projectsRoot: process.env.PROJECTS_ROOT ? path.resolve(process.env.PROJECTS_ROOT) : '',
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
  codingAgent: (process.env.CODING_AGENT ?? 'claude') as 'claude' | 'opencode' | 'codex',
  codingAgentTimeoutMs: Number(process.env.CODING_AGENT_TIMEOUT_MS ?? 600000),
  claudeBin: process.env.CLAUDE_BIN ?? 'claude',
  claudeModel: process.env.CLAUDE_MODEL ?? '', // '' = harness default
  // Headless harness has no TTY to answer permission prompts; allow it to act.
  // Self-use only. Set CLAUDE_YOLO=false to require a permissioned setup instead.
  claudeYolo: process.env.CLAUDE_YOLO !== 'false',
  opencodeBin: process.env.OPENCODE_BIN ?? 'opencode',
  opencodeModel: process.env.OPENCODE_MODEL ?? 'openrouter/anthropic/claude-3.5-sonnet',
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  // Codex CLI (the QA role's harness — separate account from engineering's Claude).
  // Defaults stay on the plain-stdout path so any CLI version works; CODEX_JSON=true opts
  // into the JSONL stream, which is the only way token counts reach the usage ledger.
  codexBin: process.env.CODEX_BIN ?? 'codex',
  codexModel: process.env.CODEX_MODEL ?? '', // '' = harness default
  // codex's sandbox policy: read-only | workspace-write | danger-full-access.
  // 'workspace-write' lets it edit the repo it was pointed at without the blanket
  // --dangerously-bypass-approvals-and-sandbox escape hatch.
  codexSandbox: process.env.CODEX_SANDBOX ?? 'workspace-write',
  // codex refuses to run outside a git repo unless told otherwise. Left off by default so
  // a dispatch that landed in the wrong directory fails loudly instead of editing it.
  codexSkipGitCheck: process.env.CODEX_SKIP_GIT_CHECK === 'true',
  codexJson: process.env.CODEX_JSON === 'true',

  // Shell sandbox: host (dev only) | docker | e2b
  shellBackend: (process.env.SHELL_BACKEND ?? 'host') as 'host' | 'docker' | 'e2b',
  shellTimeoutMs: Number(process.env.SHELL_TIMEOUT_MS ?? 15000),
  sandboxImage: process.env.SANDBOX_IMAGE ?? 'node:22-alpine',
  sandboxNetwork: process.env.SANDBOX_NETWORK ?? 'none', // 'none' blocks curl; 'bridge' allows outbound
  sandboxMemory: process.env.SANDBOX_MEMORY ?? '512m',
  sandboxCpus: Number(process.env.SANDBOX_CPUS ?? 1),
  e2bApiKey: process.env.E2B_API_KEY ?? '',

  // E2E acceptance probe (`smoke_check`). A strict ALLOWLIST of origins the tool may call —
  // the opposite posture to browse's blocklist, and deliberately so: acceptance targets are
  // your own localhost/staging deploys, which is exactly what browse's SSRF guard blocks.
  // Naming the reachable origins keeps that narrow instead of reopening the private network.
  // Empty (default) = the tool self-disables.
  e2eAllowedOrigins: (process.env.E2E_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  e2eTimeoutMs: Number(process.env.E2E_TIMEOUT_MS ?? 15000),

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

  // eai-erp backend (報價/專案 ERP). Quote tools self-disable when EAIERP_BASE_URL is unset.
  // Machine auth uses a shared secret sent as the X-Service-Token header (SERVICE_TOKEN on the backend).
  eaiErpBaseUrl: process.env.EAIERP_BASE_URL ?? '',
  eaiErpServiceToken: process.env.EAIERP_SERVICE_TOKEN ?? '',
  // Software-project (swpm) tools authenticate with their OWN service token, mapped
  // server-side to the AGENT_SWPM role (swpm.read/write only). Keeping it separate from
  // the quote token means neither agent's token can reach the other's module.
  // Unset = the swpm tools self-disable.
  eaiErpSwpmToken: process.env.EAIERP_SWPM_TOKEN ?? '',
  // Todo/outcome tools authenticate with a THIRD service token → the AGENT_TODO role
  // (todo.read/write only). Same reasoning as swpm: one module, one machine identity, so a
  // leaked token cannot reach quotes or software projects. Unset = the todo tools self-disable.
  eaiErpTodoToken: process.env.EAIERP_TODO_TOKEN ?? '',
};
