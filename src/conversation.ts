import { findByNameOrIndex, isCancelCommand, isConfirmCommand, isReviseCommand, isStartCommand, normalizeText, parseAmountYen } from "./parser.js";
import type { BotReply, Category, ExpenseDraft, KakeiboClient, Member, Session } from "./types.js";
import { SessionStore } from "./sessionStore.js";

export class ExpenseConversation {
  constructor(
    private readonly store: SessionStore,
    private readonly kakeibo: KakeiboClient,
    private readonly allowedUserIds: Set<string>
  ) {}

  async handleText(userId: string, text: string, eventId?: string): Promise<BotReply[]> {
    if (this.store.markProcessed(eventId)) return [];

    if (!this.allowedUserIds.has(userId)) {
      return [{ text: "このLINEユーザーからの支出登録は許可されていません。" }];
    }

    if (isCancelCommand(text)) {
      this.store.delete(userId);
      return [{ text: "支出登録をキャンセルしました。" }];
    }

    const session = this.store.get(userId);
    if (!session) {
      if (isStartCommand(text)) {
        this.store.set(userId, { step: "amount", draft: {} });
        return [{ text: "支出金額を入力してください。例: 1200" }];
      }
      return [{ text: "支出を登録する場合は「支出登録」と送ってください。" }];
    }

    switch (session.step) {
      case "amount":
        return this.handleAmount(userId, session, text);
      case "category":
        return this.handleCategory(userId, session, text);
      case "payer":
        return this.handlePayer(userId, session, text);
      case "description":
        return this.handleDescription(userId, session, text);
      case "confirm":
        return this.handleConfirm(userId, session, text);
    }
  }

  private async handleAmount(userId: string, session: Session, text: string): Promise<BotReply[]> {
    const amountYen = parseAmountYen(text);
    if (amountYen == null) {
      return [{ text: "金額は1円以上の整数で入力してください。例: 1200" }];
    }

    const categories = await this.kakeibo.listCategories();
    this.store.set(userId, {
      step: "category",
      draft: { ...session.draft, amountYen }
    });
    return [this.categoryPrompt(categories)];
  }

  private async handleCategory(userId: string, session: Session, text: string): Promise<BotReply[]> {
    const categories = await this.kakeibo.listCategories();
    const category = findByNameOrIndex(categories, text);
    if (!category) return [this.categoryPrompt(categories, "カテゴリを候補から選んでください。")];

    const members = await this.activeMembers();
    this.store.set(userId, {
      step: "payer",
      draft: {
        ...session.draft,
        categoryId: category.id,
        categoryName: category.name
      }
    });
    return [this.payerPrompt(members)];
  }

  private async handlePayer(userId: string, session: Session, text: string): Promise<BotReply[]> {
    const members = await this.activeMembers();
    const payer = findByNameOrIndex(members, text);
    if (!payer) return [this.payerPrompt(members, "支払者を候補から選んでください。")];

    this.store.set(userId, {
      step: "description",
      draft: {
        ...session.draft,
        payerMemberId: payer.id,
        payerName: payer.name
      }
    });
    return [{ text: "支出内容を入力してください。例: コンビニ" }];
  }

  private async handleDescription(userId: string, session: Session, text: string): Promise<BotReply[]> {
    const description = normalizeText(text);
    if (!description) return [{ text: "支出内容を入力してください。例: コンビニ" }];

    const draft = { ...session.draft, description };
    this.store.set(userId, { step: "confirm", draft });
    return [this.confirmPrompt(draft)];
  }

  private async handleConfirm(userId: string, session: Session, text: string): Promise<BotReply[]> {
    if (isReviseCommand(text)) {
      this.store.set(userId, { step: "amount", draft: {} });
      return [{ text: "最初から入力し直します。支出金額を入力してください。例: 1200" }];
    }

    if (!isConfirmCommand(text)) {
      return [this.confirmPrompt(session.draft, "登録する場合は「登録」、やり直す場合は「修正」と送ってください。")];
    }

    const draft = this.requireCompleteDraft(session.draft);
    try {
      await this.kakeibo.createExpense(draft);
      this.store.delete(userId);
      return [{ text: `支出を登録しました。\n${this.summaryText(draft)}` }];
    } catch (error) {
      const message = error instanceof Error ? error.message : "登録に失敗しました。";
      return [{ text: `支出を登録できませんでした。\n${message}\nもう一度「登録」と送ると再試行します。`, quickReplies: ["登録", "修正", "キャンセル"] }];
    }
  }

  private async activeMembers(): Promise<Member[]> {
    return (await this.kakeibo.listMembers()).filter((member) => member.isActive);
  }

  private categoryPrompt(categories: Category[], prefix = "カテゴリを選んでください。番号またはカテゴリ名で入力できます。"): BotReply {
    return {
      text: `${prefix}\n${numberedList(categories)}`,
      quickReplies: categories.map((category) => category.name)
    };
  }

  private payerPrompt(members: Member[], prefix = "支払者を選んでください。番号または名前で入力できます。"): BotReply {
    return {
      text: `${prefix}\n${numberedList(members)}`,
      quickReplies: members.map((member) => member.name)
    };
  }

  private confirmPrompt(draft: ExpenseDraft, prefix = "この内容で登録しますか？"): BotReply {
    return {
      text: `${prefix}\n${this.summaryText(draft)}`,
      quickReplies: ["登録", "修正", "キャンセル"]
    };
  }

  private summaryText(draft: ExpenseDraft): string {
    return [
      `金額: ${draft.amountYen?.toLocaleString("ja-JP")}円`,
      `カテゴリ: ${draft.categoryName}`,
      `支払者: ${draft.payerName}`,
      `内容: ${draft.description}`
    ].join("\n");
  }

  private requireCompleteDraft(draft: ExpenseDraft): {
    description: string;
    amountYen: number;
    categoryId: string;
    payerMemberId: string;
  } {
    if (!draft.description || !draft.amountYen || !draft.categoryId || !draft.payerMemberId) {
      throw new Error("入力内容が不足しています。");
    }
    return {
      description: draft.description,
      amountYen: draft.amountYen,
      categoryId: draft.categoryId,
      payerMemberId: draft.payerMemberId
    };
  }
}

function numberedList(items: Array<{ name: string }>): string {
  if (items.length === 0) return "候補がありません。Webアプリで先に設定してください。";
  return items.map((item, index) => `${index + 1}. ${item.name}`).join("\n");
}
