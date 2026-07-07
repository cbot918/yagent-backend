import fs from 'fs/promises';
import { config } from './config.js';
import { ToolRegistry } from './tools/types.js';
import { readFileTool } from './tools/readFile.js';
import { writeFileTool } from './tools/writeFile.js';
import { listFilesTool } from './tools/listFiles.js';
import { shellTool } from './tools/shell.js';
import { browseTool } from './tools/browse.js';
import { saveMemoryTool } from './memory/memory.js';
import { loadSkillTool } from './skills/loader.js';
import { searchKnowledgeTool, readDocTool } from './tools/knowledge.js';
import { dispatchCodingTool } from './tools/dispatchCoding.js';
import { createDelegateRoleTool } from './tools/delegateRole.js';
import { threadsTrendTool } from './tools/threadsTrend.js';
import { cliChannel } from './channels/cli.js';
import { createDiscordChannel } from './channels/discord.js';
import { createWebChannel } from './channels/web.js';
import { loadPlugins } from './plugins/loader.js';
import { createAgent } from './agent.js';
import type { Channel } from './channels/types.js';

async function main() {
  await fs.mkdir(config.workspaceDir, { recursive: true });

  // --- Tools ---
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(listFilesTool);
  registry.register(saveMemoryTool);
  registry.register(loadSkillTool);
  registry.register(searchKnowledgeTool);
  registry.register(readDocTool);
  registry.register(dispatchCodingTool);
  registry.register(createDelegateRoleTool(registry));
  if (config.allowShell) registry.register(shellTool);
  if (config.allowBrowser) registry.register(browseTool);
  // Register threads_trend if any source is available: the metered API (token) or the free browser scrape.
  if (config.ensembledataToken || config.allowBrowser) registry.register(threadsTrendTool);

  // --- Channels ---
  const useWeb = config.enableWeb || process.argv.includes('--web');
  // CLI only with an explicit --cli, or as the interactive dev fallback when there's
  // no Discord token AND we're attached to a real terminal. On a server (no TTY) this
  // stays off, so it won't sit at a `you:` prompt reading stdin that never comes.
  const useCli = process.argv.includes('--cli') || (!config.discordToken && process.stdin.isTTY === true);
  const channels: Channel[] = [];
  if (config.discordToken) channels.push(createDiscordChannel());
  if (useWeb) channels.push(createWebChannel(registry));
  if (useCli) channels.push(cliChannel);

  // --- Plugins ---
  await loadPlugins({
    registerTool: (t) => registry.register(t),
    registerChannel: (ch) => channels.push(ch),
  });

  // --- Start all channels ---
  for (const ch of channels) {
    const agent = createAgent(registry, ch);
    await ch.start((msg) => agent.handle(msg.sessionKey, msg.text, msg.roleId, msg.actionMode));
    console.log(`[gateway] channel started: ${ch.name}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
