import { randomUUID } from "node:crypto";

export type Draft = {
  id: string;
  chatId: string;
  createdByUserId?: string;
  date: string;
  amountYen?: number;
  categoryId?: string;
  categoryName?: string;
  payerMemberId?: string;
  payerName?: string;
  description?: string;
  duplicateWarning?: boolean;
  updatedAt: number;
};

export type DraftFields = Omit<Draft, "id" | "chatId" | "createdByUserId" | "updatedAt">;

export class DraftStore {
  private readonly drafts = new Map<string, Draft>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
    private readonly createId: () => string = () => randomUUID()
  ) {}

  create(chatId: string, createdByUserId: string | undefined, fields: DraftFields): Draft {
    const draft: Draft = { ...fields, id: this.createId(), chatId, createdByUserId, updatedAt: this.now() };
    this.drafts.set(draft.id, draft);
    return draft;
  }

  /** 別のチャットの下書きは見えない扱いにする。 */
  get(id: string, chatId: string): Draft | undefined {
    this.cleanup();
    const draft = this.drafts.get(id);
    return draft?.chatId === chatId ? draft : undefined;
  }

  update(id: string, patch: Partial<DraftFields>): Draft | undefined {
    const draft = this.drafts.get(id);
    if (!draft) return undefined;
    const next = { ...draft, ...patch, updatedAt: this.now() };
    this.drafts.set(id, next);
    return next;
  }

  /** 取り出すと同時に削除する。連打しても登録処理に進めるのは1回だけになる。 */
  take(id: string, chatId: string): Draft | undefined {
    const draft = this.get(id, chatId);
    if (draft) this.drafts.delete(id);
    return draft;
  }

  restore(draft: Draft): void {
    this.drafts.set(draft.id, { ...draft, updatedAt: this.now() });
  }

  delete(id: string): void {
    this.drafts.delete(id);
  }

  /** 送信者本人の直近の下書きを優先し、なければチャット内の直近の下書きを返す。 */
  latest(chatId: string, userId?: string): Draft | undefined {
    this.cleanup();
    const inChat = [...this.drafts.values()].filter((draft) => draft.chatId === chatId);
    const own = inChat.filter((draft) => userId !== undefined && draft.createdByUserId === userId);
    return newest(own) ?? newest(inChat);
  }

  private cleanup(): void {
    const now = this.now();
    for (const [id, draft] of this.drafts) {
      if (now - draft.updatedAt > this.ttlMs) this.drafts.delete(id);
    }
  }
}

function newest(drafts: Draft[]): Draft | undefined {
  return drafts.reduce<Draft | undefined>(
    (latest, draft) => (!latest || draft.updatedAt >= latest.updatedAt ? draft : latest),
    undefined
  );
}
