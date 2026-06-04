import readline from 'readline';
import type { Channel, MessageHandler } from './types.js';

export const cliChannel: Channel = {
  name: 'cli',

  async start(onMessage: MessageHandler) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('[cli] yagent ready. Type a message and press enter (ctrl+c to exit).\n');

    const ask = () => {
      rl.question('you: ', async (line) => {
        const text = line.trim();
        if (text) {
          try {
            await onMessage({ sessionKey: 'cli', text });
          } catch (err) {
            console.error(`\n[error] ${err instanceof Error ? err.message : String(err)}\n`);
          }
        }
        ask();
      });
    };
    ask();
  },

  async sendReply(_sessionKey: string, text: string) {
    console.log(`\nagent: ${text}\n`);
  },
};
