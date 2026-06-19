import { describe, expect, it, vi } from "vitest";
import { ExpenseConversation } from "../src/conversation.js";
import { SessionStore } from "../src/sessionStore.js";
import type { KakeiboClient } from "../src/types.js";

function fakeClient(overrides: Partial<KakeiboClient> = {}): KakeiboClient {
  return {
    listCategories: vi.fn(async () => [
      { id: "cat-food", name: "食費", displayOrder: 0 },
      { id: "cat-other", name: "その他", displayOrder: 1 }
    ]),
    listMembers: vi.fn(async () => [
      { id: "member-a", name: "太郎", displayOrder: 0, isActive: true },
      { id: "member-b", name: "花子", displayOrder: 1, isActive: true },
      { id: "member-x", name: "無効", displayOrder: 2, isActive: false }
    ]),
    listUnsettledExpenses: vi.fn(async () => []),
    listRecentExpenses: vi.fn(async () => []),
    getSettlementSummary: vi.fn(async () => ({ balances: [], suggestedTransfers: [] })),
    createExpense: vi.fn(async () => ({ id: "expense-1" })),
    ...overrides
  };
}

describe("ExpenseConversation", () => {
  it("registers an expense through the conversation flow", async () => {
    const client = fakeClient();
    const conversation = new ExpenseConversation(new SessionStore(10000), client, new Set(["user-1"]));

    expect((await conversation.handleText("user-1", "支出登録"))[0]?.text).toContain("支出金額");
    expect((await conversation.handleText("user-1", "1,200"))[0]?.text).toContain("カテゴリ");
    expect((await conversation.handleText("user-1", "食費"))[0]?.text).toContain("支払者");
    expect((await conversation.handleText("user-1", "太郎"))[0]?.text).toContain("支出内容");
    expect((await conversation.handleText("user-1", "コンビニ"))[0]?.text).toContain("この内容");
    expect((await conversation.handleText("user-1", "登録"))[0]?.text).toContain("登録しました");

    expect(client.createExpense).toHaveBeenCalledWith({
      description: "コンビニ",
      amountYen: 1200,
      categoryId: "cat-food",
      payerMemberId: "member-a"
    });
  });

  it("blocks users outside the allowlist", async () => {
    const conversation = new ExpenseConversation(new SessionStore(10000), fakeClient(), new Set(["user-1"]));

    expect((await conversation.handleText("user-2", "支出登録"))[0]?.text).toContain("許可されていません");
  });

  it("returns the LINE user id before checking the allowlist", async () => {
    const conversation = new ExpenseConversation(new SessionStore(10000), fakeClient(), new Set(["user-1"]));

    const reply = (await conversation.handleText("user-2", "ユーザーID"))[0]?.text;

    expect(reply).toContain("user-2");
    expect(reply).toContain("LINE_ALLOWED_USER_IDS");
  });

  it("returns a summary on demand", async () => {
    const conversation = new ExpenseConversation(
      new SessionStore(10000),
      fakeClient({
        listUnsettledExpenses: vi.fn(async () => [{ id: "expense-1", amountYen: 1200 }]),
        getSettlementSummary: vi.fn(async () => ({
          balances: [
            {
              memberId: "member-a",
              name: "太郎",
              paidYen: 1200,
              owedYen: 600,
              transferOutYen: 0,
              transferInYen: 0,
              balanceYen: 600
            }
          ],
          suggestedTransfers: []
        }))
      }),
      new Set(["user-1"])
    );

    const reply = (await conversation.handleText("user-1", "サマリー"))[0]?.text;

    expect(reply).toContain("家計簿サマリー");
    expect(reply).toContain("未清算支出: 1件 / 1,200円");
    expect(reply).toContain("太郎: +600円");
  });

  it("returns recent expenses on demand", async () => {
    const conversation = new ExpenseConversation(
      new SessionStore(10000),
      fakeClient({
        listRecentExpenses: vi.fn(async () => [
          {
            id: "expense-1",
            amountYen: 1200,
            occurredAt: "2026-06-18T12:00:00.000Z",
            description: "コンビニ",
            category: { name: "食費" },
            payer: { name: "太郎" }
          }
        ])
      }),
      new Set(["user-1"])
    );

    const reply = (await conversation.handleText("user-1", "履歴"))[0]?.text;

    expect(reply).toContain("直近の支出 1件");
    expect(reply).toContain("コンビニ 1,200円");
    expect(reply).toContain("食費 / 太郎");
  });

  it("cancels an active session", async () => {
    const conversation = new ExpenseConversation(new SessionStore(10000), fakeClient(), new Set(["user-1"]));

    await conversation.handleText("user-1", "支出登録");
    expect((await conversation.handleText("user-1", "キャンセル"))[0]?.text).toContain("キャンセルしました");
    expect((await conversation.handleText("user-1", "1200"))[0]?.text).toContain("支出登録");
  });

  it("does not process duplicate event ids twice", async () => {
    const conversation = new ExpenseConversation(new SessionStore(10000), fakeClient(), new Set(["user-1"]));

    expect(await conversation.handleText("user-1", "支出登録", "event-1")).toHaveLength(1);
    expect(await conversation.handleText("user-1", "支出登録", "event-1")).toHaveLength(0);
  });
});
