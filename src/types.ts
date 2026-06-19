export type Member = {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
};

export type Category = {
  id: string;
  name: string;
  displayOrder: number;
};

export type Expense = {
  id: string;
  amountYen: number;
  occurredAt?: string;
  description?: string;
  payer?: {
    name: string;
  };
  category?: {
    name: string;
  };
};

export type SettlementSummary = {
  balances: Array<{
    memberId: string;
    name: string;
    paidYen: number;
    owedYen: number;
    transferOutYen: number;
    transferInYen: number;
    balanceYen: number;
  }>;
  suggestedTransfers: Array<{
    fromMemberId: string;
    fromName: string;
    toMemberId: string;
    toName: string;
    amountYen: number;
  }>;
};

export type ExpenseDraft = {
  amountYen?: number;
  categoryId?: string;
  categoryName?: string;
  payerMemberId?: string;
  payerName?: string;
  description?: string;
};

export type ConversationStep = "amount" | "category" | "payer" | "description" | "confirm";

export type Session = {
  step: ConversationStep;
  draft: ExpenseDraft;
  updatedAt: number;
};

export type BotReply = {
  text: string;
  quickReplies?: string[];
};

export interface KakeiboClient {
  listCategories(): Promise<Category[]>;
  listMembers(): Promise<Member[]>;
  listUnsettledExpenses(): Promise<Expense[]>;
  listRecentExpenses(limit: number): Promise<Expense[]>;
  getSettlementSummary(): Promise<SettlementSummary>;
  createExpense(input: {
    description: string;
    amountYen: number;
    categoryId: string;
    payerMemberId: string;
  }): Promise<unknown>;
}
