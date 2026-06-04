import OpenAI, { toFile } from 'openai';
import { config } from './config.js';

/**
 * Speech-to-text client, kept deliberately separate from the chat client in
 * src/llm.ts: OPENAI_BASE_URL may point at OpenRouter (chat-only), which does
 * not serve /audio/transcriptions. This uses the dedicated VOICE_* settings.
 */
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: config.voiceApiKey, baseURL: config.voiceApiUrl });
  }
  return client;
}

export function isVoiceConfigured(): boolean {
  return Boolean(config.voiceApiKey);
}

/** Transcribe an audio buffer (e.g. webm/opus from MediaRecorder) to text. */
export async function transcribe(audio: Buffer, mime: string): Promise<string> {
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : mime.includes('mp4') ? 'mp4' : 'webm';
  const file = await toFile(audio, `audio.${ext}`, { type: mime || 'audio/webm' });
  const result = await getClient().audio.transcriptions.create({ file, model: config.voiceModel });
  return result.text;
}
