import { describe, expect, it, vi } from "vitest";
import { buildSummaryMessage } from "../src/summaryMessage.js";
import type { KakeiboClient } from "../src/types.js";

describe("buildSummaryMessage", () => {
  it("formats unsettled totals and balances", async () => {
    const client: KakeiboClient = {
      listCategories: vi.fn(),
      listMembers: vi.fn(),
      createExpense: vi.fn(),
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
