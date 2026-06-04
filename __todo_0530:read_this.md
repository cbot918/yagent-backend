What was built
     
  A pluggable execution layer in src/sandbox/, mirroring how src/llm.ts is yagent's one LLM swap point:
  
  ┌───────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │   File    │                                                                   Role                                                                   │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ types.ts  │ Executor interface (exec/dispose/disposeAll) + ExecResult                                                                                │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ host.ts   │ Current behavior, dev only, prints an "UNSANDBOXED" warning                                                                              │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ docker.ts │ Per-session hardened container: --cap-drop ALL, --network none (default), --read-only rootfs + tmpfs, non-root, mem/cpu/pids limits;     │
  │           │ mounts only the workspace; docker exec per command with timeout-kill                                                                     │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ e2b.ts    │ Per-session Firecracker microVM via the e2b SDK (lazy-loaded) — the no-Docker path                                                       │
  │ e2b.ts    │ Per-session Firecracker microVM via the e2b SDK (lazy-loaded) — the no-Docker path                                                       │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ index.ts  │ getExecutor() singleton from SHELL_BACKEND; SIGINT/SIGTERM/beforeExit cleanup                                                            │
  └───────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Plus: shell.ts refactored to use the executor (with output truncation + exit-code reporting), config additions (SHELL_BACKEND, SANDBOX_*, E2B_API_KEY),
  documented .env.example, e2b dependency, and a security bonus — fixed the bypassable startsWith path check in readFile.ts/writeFile.ts (now uses
  path.relative + ../absolute rejection, shared via resolveInWorkspace).

  On your "no Docker" constraint

  This machine has no Docker, so it's a live test of that scenario:
  - SHELL_BACKEND=e2b is the answer for no-Docker machines — managed microVM, just needs E2B_API_KEY.
  - Selecting docker without Docker fails loudly with "Install/start Docker, or set SHELL_BACKEND=e2b … or =host" — never a silent fallback to unsandboxed
  host (which would be the dangerous trap).

  Verified

  - npm run build (tsc, all three backends typecheck) ✅
  - host executor runs (echo/pwd/whoami) ✅
  - end-to-end: agent used shell in a real loop, streamed to the web monitor, created proof.txt ✅
  - no-Docker guardrail: clear error, no host fallback ✅
  - path-jail: ../, absolute, .., empty, and the old sibling-dir bypass all rejected ✅

  Not runtime-tested here (no daemon/key): the actual docker container and e2b sandbox. The verification steps for those are in the plan file.
  This machine has no Docker, so it's a live test of that scenario:
  - SHELL_BACKEND=e2b is the answer for no-Docker machines — managed microVM, just needs E2B_API_KEY.
  - Selecting docker without Docker fails loudly with "Install/start Docker, or set SHELL_BACKEND=e2b … or =host" — never a silent fallback to unsandboxed
  host (which would be the dangerous trap).

  Verified

  - npm run build (tsc, all three backends typecheck) ✅
  - host executor runs (echo/pwd/whoami) ✅
  - end-to-end: agent used shell in a real loop, streamed to the web monitor, created proof.txt ✅
  - no-Docker guardrail: clear error, no host fallback ✅
  - path-jail: ../, absolute, .., empty, and the old sibling-dir bypass all rejected ✅

  Not runtime-tested here (no daemon/key): the actual docker container and e2b sandbox. The verification steps for those are in the plan file.

  One default worth calling out: SANDBOX_NETWORK=none, so your motivating example (curl the news) will fail until you set SANDBOX_NETWORK=bridge —
  deliberately opt-in given the SSRF/exfiltration tradeoff, documented in .env.example.
  Verified

  - npm run build (tsc, all three backends typecheck) ✅
  - host executor runs (echo/pwd/whoami) ✅
  - end-to-end: agent used shell in a real loop, streamed to the web monitor, created proof.txt ✅
  - no-Docker guardrail: clear error, no host fallback ✅
  - path-jail: ../, absolute, .., empty, and the old sibling-dir bypass all rejected ✅

  Not runtime-tested here (no daemon/key): the actual docker container and e2b sandbox. The verification steps for those are in the plan file.

  deliberately opt-in given the SSRF/exfiltration tradeoff, documented in .env.example.
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ types.ts  │ Executor interface (exec/dispose/disposeAll) + ExecResult                                                                                │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ host.ts   │ Current behavior, dev only, prints an "UNSANDBOXED" warning                                                                              │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ docker.ts │ Per-session hardened container: --cap-drop ALL, --network none (default), --read-only rootfs + tmpfs, non-root, mem/cpu/pids limits;     │
  │           │ mounts only the workspace; docker exec per command with timeout-kill                                                                     │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ e2b.ts    │ Per-session Firecracker microVM via the e2b SDK (lazy-loaded) — the no-Docker path                                                       │
  ├───────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ index.ts  │ getExecutor() singleton from SHELL_BACKEND; SIGINT/SIGTERM/beforeExit cleanup                                                            │
  └───────────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  Plus: shell.ts refactored to use the executor (with output truncation + exit-code reporting), config additions (SHELL_BACKEND, SANDBOX_*, E2B_API_KEY),
  documented .env.example, e2b dependency, and a security bonus — fixed the bypassable startsWith path check in readFile.ts/writeFile.ts (now uses
  path.relative + ../absolute rejection, shared via resolveInWorkspace).

  On your "no Docker" constraint

  This machine has no Docker, so it's a live test of that scenario:
  - SHELL_BACKEND=e2b is the answer for no-Docker machines — managed microVM, just needs E2B_API_KEY.
  - Selecting docker without Docker fails loudly with "Install/start Docker, or set SHELL_BACKEND=e2b … or =host" — never a silent fallback to unsandboxed
  host (which would be the dangerous trap).

  Verified

  - npm run build (tsc, all three backends typecheck) ✅
  - host executor runs (echo/pwd/whoami) ✅
  - end-to-end: agent used shell in a real loop, streamed to the web monitor, created proof.txt ✅
  - no-Docker guardrail: clear error, no host fallback ✅
  - path-jail: ../, absolute, .., empty, and the old sibling-dir bypass all rejected ✅

  Not runtime-tested here (no daemon/key): the actual docker container and e2b sandbox. The verification steps for those are in the plan file.

  One default worth calling out: SANDBOX_NETWORK=none, so your motivating example (curl the news) will fail until you set SANDBOX_NETWORK=bridge —
  deliberately opt-in given the SSRF/exfiltration tradeoff, documented in .env.example.

  I haven't committed the sandbox work (your earlier commit request covered the web UI). Want me to commit it? Suggested message: "Add pluggable sandboxed
  shell execution (host/docker/e2b)".