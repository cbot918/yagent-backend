import { Client, GatewayIntentBits, Events, Partials, type Message } from 'discord.js';
import { config } from '../config.js';
import type { Channel, MessageHandler } from './types.js';

export function createDiscordChannel(): Channel {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel], // required to receive DM events
  });

  let messageHandler: MessageHandler;

  // Holds the incoming message per session so sendReply can thread the reply
  const pending = new Map<string, Message>();

  client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    const sessionKey = `${msg.channelId}-${msg.author.id}`;
    pending.set(sessionKey, msg);

    // Typing indicator — refresh every 8s (Discord clears it after ~10s)
    void msg.channel.sendTyping().catch(() => {});
    const typing = setInterval(() => void msg.channel.sendTyping().catch(() => {}), 8000);

    try {
      await messageHandler({ sessionKey, text: msg.content });
    } catch (err) {
      console.error('[discord] handler error:', err);
    } finally {
      clearInterval(typing);
      pending.delete(sessionKey);
    }
  });

  return {
    name: 'discord',

    async start(onMessage: MessageHandler) {
      messageHandler = onMessage;
      await client.login(config.discordToken);
      const u = client.user!;
      console.log('[discord] connected!');
      console.log(`  tag      : ${u.tag}`);
      console.log(`  bot id   : ${u.id}`);
      console.log(`  servers  : ${client.guilds.cache.size}`);
    },

    async sendReply(sessionKey: string, text: string) {
      const chunks = text.match(/[\s\S]{1,1990}/g) ?? [text];
      const original = pending.get(sessionKey);
      try {
        if (original) {
          // Reply to the user's message (threaded), then send follow-up chunks normally
          await original.reply(chunks[0]);
          for (const chunk of chunks.slice(1)) {
            await (original.channel as { send(m: string): Promise<unknown> }).send(chunk);
          }
        } else {
          // Fallback: no pending message, send to channel directly
          const channelId = sessionKey.split('-')[0];
          const ch = await client.channels.fetch(channelId);
          if (ch?.isTextBased()) {
            for (const chunk of chunks) {
              await (ch as { send(m: string): Promise<unknown> }).send(chunk);
            }
          }
        }
      } catch (err) {
        console.error('[discord] sendReply error:', err);
      }
    },
  };
}
