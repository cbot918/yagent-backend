import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
import { deleteSession } from '../session.js';
import type { Room } from './types.js';

// Rooms live as data under the workspace (files-as-truth), mirroring
// .sessions/ — one JSON file per room.
function roomPath(roomId: string) {
  const safe = roomId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(config.workspaceDir, '.rooms', `${safe}.json`);
}

export const DEFAULT_ROOM_ID = 'main';

export async function loadRoom(roomId: string): Promise<Room | null> {
  try {
    const raw = await fs.readFile(roomPath(roomId), 'utf8');
    return JSON.parse(raw) as Room;
  } catch {
    return null;
  }
}

export async function saveRoom(room: Room) {
  const p = roomPath(room.id);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(room, null, 2));
}

export async function listRooms(): Promise<Room[]> {
  try {
    const dir = path.join(config.workspaceDir, '.rooms');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    const rooms: Room[] = [];
    for (const f of files) {
      const room = await loadRoom(f.replace(/\.json$/, ''));
      if (room) rooms.push(room);
    }
    // Oldest first, so the seed room (written before createdAt existed) stays on top
    // and the list doesn't reshuffle under the user as rooms are added.
    return rooms.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  } catch {
    return [];
  }
}

/**
 * Seed a room on first boot so the UI always has one channel — but only when there
 * are no rooms at all. Keying it on "main is missing" instead would resurrect the
 * seed room on the next restart after the user deliberately deleted it.
 */
export async function ensureDefaultRoom(): Promise<Room> {
  const rooms = await listRooms();
  if (rooms.length > 0) return rooms.find((r) => r.id === DEFAULT_ROOM_ID) ?? rooms[0];
  const room: Room = { id: DEFAULT_ROOM_ID, name: '會議室', participants: [], transcript: [], createdAt: Date.now() };
  await saveRoom(room);
  return room;
}

/**
 * Room ids double as filenames and as a sessionKey segment (`room:<id>::<roleId>`,
 * matched by `/^room:([^:]+)$/` in the gateway), so they stay in [a-z0-9-]. Names are
 * usually Chinese and slugify to nothing — hence the `room` fallback plus a numeric
 * suffix, which also settles collisions between two rooms of the same name.
 */
async function allocateRoomId(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'room';
  const taken = new Set((await listRooms()).map((r) => r.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function createRoom(name: string): Promise<Room> {
  const trimmed = name.trim() || '新會議室';
  const room: Room = {
    id: await allocateRoomId(trimmed),
    name: trimmed,
    participants: [],
    transcript: [],
    createdAt: Date.now(),
  };
  await saveRoom(room);
  return room;
}

/**
 * Delete a room and the private sub-sessions its members spoke through. Those are
 * per-room (`room:<id>::<roleId>`), so leaving them behind would both litter the
 * session list and hand a future room that reused the id someone else's memory.
 */
export async function deleteRoom(roomId: string): Promise<boolean> {
  const room = await loadRoom(roomId);
  if (!room) return false;
  for (const roleId of room.participants) {
    await deleteSession(`room:${room.id}::${roleId}`);
  }
  await fs.rm(roomPath(room.id), { force: true });
  return true;
}

export async function addParticipant(roomId: string, roleId: string): Promise<Room | null> {
  const room = await loadRoom(roomId);
  if (!room) return null;
  if (!room.participants.includes(roleId)) {
    room.participants.push(roleId);
    await saveRoom(room);
  }
  return room;
}

export async function removeParticipant(roomId: string, roleId: string): Promise<Room | null> {
  const room = await loadRoom(roomId);
  if (!room) return null;
  const i = room.participants.indexOf(roleId);
  if (i >= 0) {
    room.participants.splice(i, 1);
    await saveRoom(room);
  }
  return room;
}
