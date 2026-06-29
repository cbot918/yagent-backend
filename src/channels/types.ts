export interface IncomingMessage {
  sessionKey: string;
  text: string;
  /** Which virtual-company role to answer as (manual switchboard). */
  roleId?: string;
  /** Per-turn override of the role's action mode (like plan/edit mode). */
  actionMode?: 'act' | 'advise';
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface Channel {
  name: string;
  start(onMessage: MessageHandler): Promise<void>;
  sendReply(sessionKey: string, text: string): Promise<void>;
}
