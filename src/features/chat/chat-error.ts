/** Thrown by the chat adapter; its `message` is already a Swedish UI string. */
export class ChatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatError';
  }
}
