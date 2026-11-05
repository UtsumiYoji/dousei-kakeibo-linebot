/** チャットごとに処理を順番に実行する。別のチャットの処理は待たない。 */
export class ChatQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(chatId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(chatId) ?? Promise.resolve();
    const next = previous.then(task).catch((error: unknown) => {
      console.error("failed to process LINE event", error);
    });
    this.tails.set(chatId, next);
    void next.finally(() => {
      if (this.tails.get(chatId) === next) this.tails.delete(chatId);
    });
    return next;
  }
}
