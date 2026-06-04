import fs from 'fs/promises';
import path from 'path';
import type { PluginContext } from './types.js';

const PLUGINS_DIR = path.resolve('./plugins');

export async function loadPlugins(ctx: PluginContext) {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(PLUGINS_DIR);
  } catch {
    return;
  }

  for (const entry of entries) {
    for (const filename of ['index.ts', 'index.js']) {
      const pluginPath = path.join(PLUGINS_DIR, entry, filename);
      try {
        await fs.access(pluginPath);
        const module = (await import(pluginPath)) as { default?: { name: string; init: (ctx: PluginContext) => void | Promise<void> } };
        const plugin = module.default;
        if (!plugin?.name || !plugin?.init) continue;
        console.log(`[plugins] loaded: ${plugin.name}`);
        await plugin.init(ctx);
        break;
      } catch {
        continue;
      }
    }
  }
}
