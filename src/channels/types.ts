export interface IncomingMessage {
  sessionKey: string;
  text: string;
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface Channel {
  name: string;
  start(onMessage: MessageHandler): Promise<void>;
  sendReply(sessionKey: string, text: string): Promise<void>;
}
