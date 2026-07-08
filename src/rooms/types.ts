/**
 * Room channels: a shared meeting room where multiple virtual-company roles
 * discuss a topic with the user. The room owns a speaker-attributed transcript
 * (files-as-truth); each utterance by a role is produced by a full runTurn on
 * that role's private sub-session (`room:<id>::<roleId>`).
 */

/** One utterance in a room. `speaker` is 'user' or a role id. */
export interface RoomMsg {
  speaker: string;
  text: string;
  ts: number;
}

export interface Room {
  id: string;
  name: string;
  /** Role ids currently in the room (join order = fallback speaking order). */
  participants: string[];
  transcript: RoomMsg[];
}
