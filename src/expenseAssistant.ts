import { interpretMessage, readReceipt, type MessageInterpretation } from "./aiExtractor.js";
import type { ExpenseConversation } from "./conversation.js";
import { jstDate, normalizeDate, toOccurredAt } from "./dates.js";
import type { Draft, DraftFields, DraftStore } from "./draftStore.js";
import type { LlmClient } from "./llmClient.js";
import { isCancelCommand, isDraftConfirmCommand, isGroupIdCommand, isUserIdCommand, normalizeText } from "./parser.js";
import type { SessionStore } from "./sessionStore.js";
import type { BotCard, BotReply, Category, KakeiboClient, Member } from "./types.js";

export type ChatContext = {
  chatId: string;
  chatType: "user" | "group";
  userId?: string;
};

type AssistantOptions = {
  conversation: ExpenseConversation;
  sessions: SessionStore;
  drafts: DraftStore;
  kakeibo: KakeiboClient;
  llm?: LlmClient;
  allowedUserIds: Set<string>;
  allowedGroupIds: Set<string>;
  memberMap: Map<string, string>;
  now?: () => Date;
};

const MAX_TEXT_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 100;
const DUPLICATE_LOOKBACK = 30;
const AI_UNAVAILABLE = "いまAIで読み取れません。少し待って送り直すか、「支出登録」と送って手入力してください。";
const DRAFT_GONE = "この下書きは登録済みか、期限が切れています。";

export class ExpenseAssistant {
  private readonly now: () => Date;

  constructor(private readonly options: AssistantOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async handleText(context: ChatContext, text: string, eventId?: string): Promise<BotReply[]> {
    const { conversation, sessions, llm } = this.options;
    if (sessions.markProcessed(eventId)) return [];

    if (context.chatType === "group") {
      if (isGroupIdCommand(text)) {
        return [{ text: `このグループのID:\n${context.chatId}\n\nこの値をLINE_ALLOWED_GROUP_IDSに設定してください。` }];
      }
      if (isUserIdCommand(text)) {
        return [{ text: context.userId ? `あなたのLINE userId:\n${context.userId}\n\nこの値をLINE_MEMBER_MAPに設定してください。` : "LINE userIdを取得できませんでした。" }];
      }
    } else if (isUserIdCommand(text) || !this.isAuthorized(context)) {
      return conversation.handleText(context.chatId, text);
    }

    // 許可されていないグループの会話には反応しない。
    if (!this.isAuthorized(context)) return [];

    const sessionKey = toSessionKey(context);
    if (conversation.hasActiveSession(sessionKey)) return conversation.handleAuthorizedText(sessionKey, text);

    const draft = this.options.drafts.latest(context.chatId, context.userId);
    if (draft && isDraftConfirmCommand(text)) return this.confirmDraft(context, draft.id);
    if (draft && isCancelCommand(text)) return this.cancelDraft(draft);

    if (conversation.isCommand(text)) return conversation.handleAuthorizedText(sessionKey, text);
    if (!llm) return context.chatType === "group" ? [] : conversation.handleAuthorizedText(sessionKey, text);

    return this.interpretText(context, llm, text, draft);
  }

  async handleImage(context: ChatContext, loadImage: () => Promise<Buffer>, eventId?: string): Promise<BotReply[]> {
    const { sessions, llm, kakeibo } = this.options;
    if (sessions.markProcessed(eventId)) return [];
    if (!this.isAuthorized(context)) {
      return context.chatType === "group" ? [] : [{ text: "このLINEユーザーからの支出登録は許可されていません。" }];
    }
    if (!llm) return context.chatType === "group" ? [] : [{ text: "画像の読み取りは設定されていません。「支出登録」と送ってください。" }];

    try {
      const [image, categories, members] = await Promise.all([loadImage(), kakeibo.listCategories(), this.activeMembers()]);
      const reading = await readReceipt(llm, image, categories.map((category) => category.name));
      if (!reading.isReceipt) {
        return context.chatType === "group" ? [] : [{ text: "レシートとして読み取れませんでした。" }];
      }

      const today = jstDate(this.now());
      const category = resolveCategory(reading.category, categories);
      const payer = this.resolveSender(context, members);
      const draft = await this.createDraft(context, {
        date: normalizeDate(reading.date, today) ?? today,
        amountYen: reading.totalYen ?? undefined,
        categoryId: category?.id,
        categoryName: category?.name,
        payerMemberId: payer?.id,
        payerName: payer?.name,
        description: truncate(reading.store ?? reading.description ?? "レシート")
      });
      return [this.draftReply(draft, members, "レシートを読み取りました")];
    } catch (error) {
      console.error("failed to read receipt", error);
      return [{ text: AI_UNAVAILABLE }];
    }
  }

  async handlePostback(context: ChatContext, data: string, eventId?: string): Promise<BotReply[]> {
    const { sessions, drafts } = this.options;
    if (sessions.markProcessed(eventId)) return [];
    if (!this.isAuthorized(context)) return [];

    const params = new URLSearchParams(data);
    const draftId = params.get("draft") ?? "";
    const action = params.get("action");
    if (action === "confirm") return this.confirmDraft(context, draftId);

    const draft = drafts.get(draftId, context.chatId);
    if (!draft) return [{ text: DRAFT_GONE }];
    if (action === "cancel") return this.cancelDraft(draft);
    if (action === "payer") return this.selectPayer(draft, params.get("member") ?? "");
    return [];
  }

  private async interpretText(context: ChatContext, llm: LlmClient, text: string, draft: Draft | undefined): Promise<BotReply[]> {
    const input = normalizeText(text).slice(0, MAX_TEXT_LENGTH);
    if (!input) return [];

    try {
      const [categories, members] = await Promise.all([this.options.kakeibo.listCategories(), this.activeMembers()]);
      const sender = this.resolveSender(context, members);
      const result = await interpretMessage(llm, {
        text: input,
        now: this.now(),
        memberNames: members.map((member) => member.name),
        categoryNames: categories.map((category) => category.name),
        senderName: sender?.name ?? null,
        draftSummary: draft ? summarizeDraft(draft) : null
      });
      return await this.applyInterpretation(context, input, result, draft, categories, members, sender);
    } catch (error) {
      console.error("failed to interpret message", error);
      return [{ text: AI_UNAVAILABLE }];
    }
  }

  private async applyInterpretation(
    context: ChatContext,
    text: string,
    result: MessageInterpretation,
    draft: Draft | undefined,
    categories: Category[],
    members: Member[],
    sender: Member | undefined
  ): Promise<BotReply[]> {
    // 金額待ちの下書きがあるときの発言は、新しい支出ではなくその続きとして扱う。
    const continuesDraft = draft?.amountYen === undefined && result.action !== "none" ? draft : undefined;
    const target = result.action === "update" ? draft : continuesDraft;

    if (target) {
      const updated = this.options.drafts.update(target.id, this.toPatch(result, categories, members, sender, text));
      if (!updated) return [{ text: DRAFT_GONE }];
      return [this.draftReply(await this.refreshDuplicateWarning(updated), members, "下書きを更新しました")];
    }

    if (result.action === "none" || result.action === "update") {
      return context.chatType === "group" ? [] : [{ text: "支出の内容を読み取れませんでした。例: スーパー 1200円" }];
    }

    const category = resolveCategory(result.category, categories);
    const payer = resolvePayer(result.payer, members, sender, text) ?? sender;
    const created = await this.createDraft(context, {
      date: normalizeDate(result.date, jstDate(this.now())) ?? jstDate(this.now()),
      amountYen: result.amountYen ?? undefined,
      categoryId: category?.id,
      categoryName: category?.name,
      payerMemberId: payer?.id,
      payerName: payer?.name,
      description: truncate(result.description ?? text)
    });
    return [this.draftReply(created, members, "この内容で登録しますか？")];
  }

  /** LLMが値を返した項目だけを下書きへ反映する。 */
  private toPatch(
    result: MessageInterpretation,
    categories: Category[],
    members: Member[],
    sender: Member | undefined,
    text: string
  ): Partial<DraftFields> {
    const patch: Partial<DraftFields> = {};
    if (result.amountYen !== null) patch.amountYen = result.amountYen;
    if (result.category) {
      const category = resolveCategory(result.category, categories);
      patch.categoryId = category?.id;
      patch.categoryName = category?.name;
    }
    const payer = resolvePayer(result.payer, members, sender, text);
    if (payer) {
      patch.payerMemberId = payer.id;
      patch.payerName = payer.name;
    }
    if (result.description) patch.description = truncate(result.description);
    const date = normalizeDate(result.date, jstDate(this.now()));
    if (date) patch.date = date;
    return patch;
  }

  private async confirmDraft(context: ChatContext, draftId: string): Promise<BotReply[]> {
    const { drafts, kakeibo } = this.options;
    const current = drafts.get(draftId, context.chatId);
    if (!current) return [{ text: DRAFT_GONE }];
    if (!isComplete(current)) {
      return [this.draftReply(current, await this.activeMembers(), "まだ登録できません")];
    }

    const draft = drafts.take(draftId, context.chatId);
    if (!draft || !isComplete(draft)) return [{ text: DRAFT_GONE }];

    try {
      await kakeibo.createExpense({
        description: draft.description,
        amountYen: draft.amountYen,
        categoryId: draft.categoryId,
        payerMemberId: draft.payerMemberId,
        occurredAt: toOccurredAt(draft.date)
      });
      return [{ text: `支出を登録しました。\n${summarizeDraft(draft)}` }];
    } catch (error) {
      drafts.restore(draft);
      const message = error instanceof Error ? error.message : "登録に失敗しました。";
      return [{ text: `支出を登録できませんでした。\n${message}\nもう一度「登録」を押すと再試行します。` }];
    }
  }

  private cancelDraft(draft: Draft): BotReply[] {
    this.options.drafts.delete(draft.id);
    return [{ text: "下書きを取り消しました。" }];
  }

  private async selectPayer(draft: Draft, memberId: string): Promise<BotReply[]> {
    const members = await this.activeMembers();
    const payer = members.find((member) => member.id === memberId);
    if (!payer) return [this.draftReply(draft, members, "支払者を選び直してください")];

    const updated = this.options.drafts.update(draft.id, { payerMemberId: payer.id, payerName: payer.name });
    return updated ? [this.draftReply(updated, members, "この内容で登録しますか？")] : [{ text: DRAFT_GONE }];
  }

  private async createDraft(context: ChatContext, fields: DraftFields): Promise<Draft> {
    const draft = this.options.drafts.create(context.chatId, context.userId, fields);
    return this.refreshDuplicateWarning(draft);
  }

  private async refreshDuplicateWarning(draft: Draft): Promise<Draft> {
    const duplicateWarning = await this.hasDuplicate(draft);
    return this.options.drafts.update(draft.id, { duplicateWarning }) ?? draft;
  }

  /** 重複の確認は補助機能なので、失敗しても下書きの作成は止めない。 */
  private async hasDuplicate(draft: Draft): Promise<boolean> {
    if (draft.amountYen === undefined) return false;
    try {
      const expenses = await this.options.kakeibo.listRecentExpenses(DUPLICATE_LOOKBACK);
      return expenses.some(
        (expense) =>
          expense.amountYen === draft.amountYen &&
          expense.occurredAt !== undefined &&
          jstDate(new Date(expense.occurredAt)) === draft.date
      );
    } catch (error) {
      console.warn("failed to check duplicate expenses", error);
      return false;
    }
  }

  private draftReply(draft: Draft, members: Member[], title: string): BotReply {
    if (draft.amountYen === undefined) {
      return { text: `金額を読み取れませんでした。金額を送ってください。${draft.description ? `\n内容: ${draft.description}` : ""}` };
    }

    const cancel = { label: "取消", data: `action=cancel&draft=${draft.id}` };
    const needsPayer = !draft.payerMemberId;
    const card: BotCard = {
      title: needsPayer ? "支払者を選んでください" : title,
      rows: [
        { label: "金額", value: `${draft.amountYen.toLocaleString("ja-JP")}円` },
        { label: "カテゴリ", value: draft.categoryName ?? "未設定" },
        { label: "支払者", value: draft.payerName ?? "未設定" },
        { label: "内容", value: draft.description ?? "未設定" },
        { label: "日付", value: draft.date }
      ],
      warning: draft.duplicateWarning ? "同じ日付と金額の支出がすでに登録されています。" : undefined,
      buttons: needsPayer
        ? [
            ...members.map((member) => ({ label: member.name, data: `action=payer&draft=${draft.id}&member=${member.id}`, primary: true })),
            cancel
          ]
        : [{ label: "登録", data: `action=confirm&draft=${draft.id}`, primary: true }, cancel]
    };
    return { text: `${card.title}\n${summarizeDraft(draft)}`, card };
  }

  private isAuthorized(context: ChatContext): boolean {
    return context.chatType === "group"
      ? this.options.allowedGroupIds.has(context.chatId)
      : this.options.allowedUserIds.has(context.chatId);
  }

  private resolveSender(context: ChatContext, members: Member[]): Member | undefined {
    const mapped = context.userId ? this.options.memberMap.get(context.userId) : undefined;
    return mapped ? members.find((member) => member.id === mapped || member.name === mapped) : undefined;
  }

  private async activeMembers(): Promise<Member[]> {
    return (await this.options.kakeibo.listMembers()).filter((member) => member.isActive);
  }
}

function toSessionKey(context: ChatContext): string {
  return context.chatType === "group" ? `${context.chatId}:${context.userId ?? "unknown"}` : context.chatId;
}

function resolveCategory(name: string | null, categories: Category[]): Category | undefined {
  return (
    categories.find((category) => category.name === name) ??
    categories.find((category) => category.name === "その他") ??
    categories[categories.length - 1]
  );
}

/** 送信者が不明なときは、発言に名前が出ているメンバーだけを支払者として認める。 */
function resolvePayer(name: string | null, members: Member[], sender: Member | undefined, text: string): Member | undefined {
  const payer = members.find((member) => member.name === name);
  if (!payer) return undefined;
  return sender || text.includes(payer.name) ? payer : undefined;
}

function isComplete(draft: Draft): draft is Draft & {
  amountYen: number;
  categoryId: string;
  payerMemberId: string;
  description: string;
} {
  return Boolean(draft.amountYen && draft.categoryId && draft.payerMemberId && draft.description);
}

function summarizeDraft(draft: Draft): string {
  return [
    `金額: ${draft.amountYen === undefined ? "未設定" : `${draft.amountYen.toLocaleString("ja-JP")}円`}`,
    `カテゴリ: ${draft.categoryName ?? "未設定"}`,
    `支払者: ${draft.payerName ?? "未設定"}`,
    `内容: ${draft.description ?? "未設定"}`,
    `日付: ${draft.date}`
  ].join("\n");
}

function truncate(text: string): string {
  return text.slice(0, MAX_DESCRIPTION_LENGTH);
}
