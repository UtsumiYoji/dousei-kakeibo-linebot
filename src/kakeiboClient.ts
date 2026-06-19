import type { Category, Expense, KakeiboClient, Member, SettlementSummary } from "./types.js";

export class HttpKakeiboClient implements KakeiboClient {
  constructor(private readonly baseUrl: string) {}

  async listCategories(): Promise<Category[]> {
    return this.request<Category[]>("/api/categories");
  }

  async listMembers(): Promise<Member[]> {
    return this.request<Member[]>("/api/members");
  }

  async listUnsettledExpenses(): Promise<Expense[]> {
    return this.request<Expense[]>("/api/expenses?settled=unsettled");
  }

  async listRecentExpenses(limit: number): Promise<Expense[]> {
    const expenses = await this.request<Expense[]>("/api/expenses?settled=all");
    return expenses.slice(0, Math.max(0, limit));
  }

  async getSettlementSummary(): Promise<SettlementSummary> {
    return this.request<SettlementSummary>("/api/settlements");
  }

  async createExpense(input: {
    description: string;
    amountYen: number;
    categoryId: string;
    payerMemberId: string;
  }): Promise<unknown> {
    return this.request("/api/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : `家計簿APIへの接続に失敗しました。(${response.status})`;
      throw new Error(message);
    }

    return data as T;
  }
}
