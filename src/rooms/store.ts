import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';
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
    return rooms;
  } catch {
    return [];
  }
}

/** Create the seed room on first boot so the UI always has one channel. */
export async function ensureDefaultRoom(): Promise<Room> {
  const existing = await loadRoom(DEFAULT_ROOM_ID);
  if (existing) return existing;
  const room: Room = { id: DEFAULT_ROOM_ID, name: '會議室', participants: [], transcript: [] };
  await saveRoom(room);
  return room;
}

export async function addParticipant(roomId: string, roleId: string): Promise<Room> {
  const room = (await loadRoom(roomId)) ?? (await ensureDefaultRoom());
  if (!room.participants.includes(roleId)) {
    room.participants.push(roleId);
    await saveRoom(room);
  }
  return room;
}

export async function removeParticipant(roomId: string, roleId: string): Promise<Room> {
  const room = (await loadRoom(roomId)) ?? (await ensureDefaultRoom());
  const i = room.participants.indexOf(roleId);
  if (i >= 0) {
    room.participants.splice(i, 1);
    await saveRoom(room);
  }
  return room;
}
