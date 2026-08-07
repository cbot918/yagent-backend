import { complete } from '../llm.js';
import { loadRoles } from '../roles/loader.js';
import { runTurn } from '../agent.js';
import { withSessionLock } from '../session.js';
import { bus } from '../events.js';
import { recordUsage, loadBilling, computeLlmCost } from '../usage/index.js';
import { config } from '../config.js';
import type { ToolRegistry } from '../tools/types.js';
import type { Role } from '../roles/types.js';
import { loadRoom, saveRoom } from './store.js';
import type { Room, RoomMsg } from './types.js';

/** Max roles the moderator may pick per user message (cost ceiling). */
const MAX_SPEAKERS = 3;
/** Max transcript entries fed to the moderator / a speaker (prompt-size cap). */
const CONTEXT_WINDOW = 30;

/** Render transcript entries as speaker-labelled lines. */
function renderTranscript(msgs: RoomMsg[], roles: Role[]): string {
  return msgs
    .map((m) => {
      if (m.speaker === 'user') return `[使用者]: ${m.text}`;
      const role = roles.find((r) => r.id === m.speaker);
      return `[${role?.name ?? m.speaker}]: ${m.text}`;
    })
    .join('\n\n');
}

/**
 * Moderator: one cheap LLM call that picks which room members should respond
 * to the latest user message (1..MAX_SPEAKERS, ordered by relevance). Falls
 * back to the first participant on parse failure so the room never goes silent.
 */
async function pickSpeakers(room: Room, roles: Role[], userText: string): Promise<string[]> {
  const members = room.participants
    .map((id) => {
      const r = roles.find((x) => x.id === id);
      return r ? `- ${r.id}: ${r.name}${r.title ? `（${r.title}）` : ''} — ${r.description}` : null;
    })
    .filter(Boolean)
    .join('\n');
  const recent = renderTranscript(room.transcript.slice(-CONTEXT_WINDOW), roles);

  const res = await complete(
    [
      {
        role: 'system',
        content:
          '你是會議主持人。根據使用者的最新發言與會議脈絡，從房內成員中挑出「應該回應的人」（依相關性排序，1 到 ' +
          `${MAX_SPEAKERS} 位；若使用者點名某成員，就只選被點名的）。只輸出 JSON，格式：{"speakers": ["roleId", ...]}`,
      },
      {
        role: 'user',
        content: `## 房內成員\n${members}\n\n## 近期會議記錄\n${recent || '（尚無記錄）'}\n\n## 使用者最新發言\n${userText}`,
      },
    ],
    [],
  );

  // Meter the moderator call (attributed to the room session, no role).
  if (res.usage) {
    const provider = config.openaiBaseUrl.includes('openrouter') ? 'openrouter' : 'openai';
    const { pricing } = await loadBilling();
    await recordUsage(
      {
        ts: Date.now(),
        sessionKey: `room:${room.id}`,
        source: 'llm',
        provider,
        keyId: provider,
        model: config.model,
        inputTokens: res.usage.prompt_tokens,
        outputTokens: res.usage.completion_tokens,
        costUSD: computeLlmCost(pricing, config.model, res.usage.prompt_tokens, res.usage.completion_tokens),
      },
      { channel: 'web' },
    );
  }

  const raw = res.choices[0]?.message?.content ?? '';
  try {
    const json = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '') as { speakers?: string[] };
    const picked = (json.speakers ?? []).filter((id) => room.participants.includes(id)).slice(0, MAX_SPEAKERS);
    if (picked.length > 0) return picked;
  } catch {
    /* fall through to fallback */
  }
  return room.participants.slice(0, 1);
}

/**
 * Handle one user message to a room: append it, let the moderator pick the
 * relevant members, then each picked member speaks once (a full runTurn with
 * its own persona/tools/budget on the `room:<id>::<roleId>` sub-session),
 * seeing the transcript delta since it last spoke. Serialized per room.
 */
export async function runRoomMessage(registry: ToolRegistry, roomId: string, text: string): Promise<void> {
  await withSessionLock(`room:${roomId}`, async () => {
    // Now that rooms can be created and deleted, an unknown id means the room is
    // gone (or the client is stale) — routing the message into the default room
    // instead would drop it somewhere the user isn't looking.
    const room = await loadRoom(roomId);
    if (!room) {
      console.warn(`[room] message for unknown room "${roomId}" — dropped`);
      return;
    }
    const roles = await loadRoles();
    const base = { sessionKey: `room:${room.id}`, channel: 'web' };

    room.transcript.push({ speaker: 'user', text, ts: Date.now() });
    await saveRoom(room);
    bus.emitEvent({ type: 'room:message', roomId: room.id, speaker: 'user', text, ts: Date.now(), ...base });

    if (room.participants.length === 0) {
      const notice = '（房間裡還沒有成員 — 把左上方的角色拖進會議室再開始討論）';
      room.transcript.push({ speaker: 'system', text: notice, ts: Date.now() });
      await saveRoom(room);
      bus.emitEvent({ type: 'room:message', roomId: room.id, speaker: 'system', text: notice, ts: Date.now(), ...base });
      return;
    }

    const speakers = await pickSpeakers(room, roles, text);
    bus.emitEvent({ type: 'room:round:start', roomId: room.id, speakers, ts: Date.now(), ...base });

    try {
      for (const speakerId of speakers) {
        const role = roles.find((r) => r.id === speakerId);
        if (!role) continue;

        // Delta: everything said since this member last spoke (they keep their
        // own sub-session history, so re-feeding the whole transcript would
        // duplicate what they already know).
        const lastIdx = room.transcript.map((m) => m.speaker).lastIndexOf(speakerId);
        const delta = room.transcript.slice(Math.max(lastIdx + 1, room.transcript.length - CONTEXT_WINDOW), room.transcript.length);

        const prompt =
          `【會議室「${room.name}」】你正在和使用者與其他成員開會。目前在場：` +
          room.participants.map((id) => roles.find((r) => r.id === id)?.name ?? id).join('、') +
          `。以下是你上次發言後的新對話：\n\n${renderTranscript(delta, roles)}\n\n` +
          '請以你的角色立場發表具體意見（必要時先用工具查證知識庫再表態）。直接發言，不用重複別人說過的內容；如果要回應某人，點名對方。';

        const reply = await runTurn(registry, {
          sessionKey: `room:${room.id}::${role.id}`,
          text: prompt,
          roleId: role.id,
          channelName: 'web',
        });

        room.transcript.push({ speaker: role.id, text: reply, ts: Date.now() });
        await saveRoom(room);
        bus.emitEvent({
          type: 'room:message',
          roomId: room.id,
          speaker: role.id,
          speakerName: role.name,
          text: reply,
          ts: Date.now(),
          ...base,
          roleId: role.id,
        });
      }
    } finally {
      bus.emitEvent({ type: 'room:round:end', roomId: room.id, speakers, ts: Date.now(), ...base });
    }
  });
}
