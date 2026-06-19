import { describe, expect, it, vi } from "vitest";
import { buildRecentExpensesMessage, buildSummaryMessage } from "../src/summaryMessage.js";
import type { KakeiboClient } from "../src/types.js";

describe("buildSummaryMessage", () => {
  it("formats unsettled totals and balances", async () => {
    const client: KakeiboClient = {
      listCategories: vi.fn(),
      listMembers: vi.fn(),
      createExpense: vi.fn(),
      listRecentExpenses: vi.fn(),
      listUnsettledExpenses: vi.fn(async () => [
        { id: "expense-1", amountYen: 1200 },
        { id: "expense-2", amountYen: 3000 }
      ]),
      getSettlementSummary: vi.fn(async () => ({
        balances: [
          {
            memberId: "member-a",
            name: "太郎",
            paidYen: 5000,
            owedYen: 3000,
            transferOutYen: 0,
            transferInYen: 0,
            balanceYen: 2000
          },
          {
            memberId: "member-b",
            name: "花子",
            paidYen: 1000,
            owedYen: 3000,
            transferOutYen: 0,
            transferInYen: 0,
            balanceYen: -2000
          }
        ],
        suggestedTransfers: []
      }))
    };

    await expect(buildSummaryMessage(client)).resolves.toBe(
      [
        "家計簿サマリー",
        "",
        "未清算支出: 2件 / 4,200円",
        "",
        "清算状況:",
        "太郎: +2,000円",
        "花子: -2,000円"
      ].join("\n")
    );
  });
});

describe("buildRecentExpensesMessage", () => {
  it("formats recent expenses", async () => {
    const client: KakeiboClient = {
      listCategories: vi.fn(),
      listMembers: vi.fn(),
      createExpense: vi.fn(),
      listUnsettledExpenses: vi.fn(),
      getSettlementSummary: vi.fn(),
      listRecentExpenses: vi.fn(async () => [
        {
          id: "expense-1",
          amountYen: 1200,
          occurredAt: "2026-06-18T12:00:00.000Z",
          description: "コンビニ",
          payer: { name: "太郎" },
          category: { name: "食費" }
        },
        {
          id: "expense-2",
          amountYen: 3000,
          occurredAt: "2026-06-17T12:00:00.000Z",
          description: "日用品",
          payer: { name: "花子" },
          category: { name: "その他" }
        }
      ])
    };

    await expect(buildRecentExpensesMessage(client)).resolves.toBe(
      [
        "直近の支出 2件",
        "",
        "1. 6/18 コンビニ 1,200円 (食費 / 太郎)",
        "2. 6/17 日用品 3,000円 (その他 / 花子)"
      ].join("\n")
    );

    expect(client.listRecentExpenses).toHaveBeenCalledWith(5);
  });

  it("formats an empty list", async () => {
    const client: KakeiboClient = {
      listCategories: vi.fn(),
      listMembers: vi.fn(),
      createExpense: vi.fn(),
      listUnsettledExpenses: vi.fn(),
      getSettlementSummary: vi.fn(),
      listRecentExpenses: vi.fn(async () => [])
    };

    await expect(buildRecentExpensesMessage(client)).resolves.toBe(
      ["直近の支出 0件", "", "登録済みの支出はありません。"].join("\n")
    );
  });
});
