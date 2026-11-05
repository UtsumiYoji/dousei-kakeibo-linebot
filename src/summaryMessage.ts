import type { Expense, KakeiboClient, SettlementSummary } from "./types.js";

export async function buildSummaryMessage(kakeibo: KakeiboClient): Promise<string> {
  const [unsettledExpenses, settlement] = await Promise.all([
    kakeibo.listUnsettledExpenses(),
    kakeibo.getSettlementSummary()
  ]);

  const unsettledTotal = unsettledExpenses.reduce((sum, expense) => sum + expense.amountYen, 0);

  return [
    "家計簿サマリー",
    "",
    `未清算支出: ${unsettledExpenses.length}件 / ${formatYen(unsettledTotal)}`,
    "",
    "清算状況:",
    formatBalances(settlement)
  ].join("\n");
}

export async function buildRecentExpensesMessage(kakeibo: KakeiboClient, limit = 5): Promise<string> {
  const expenses = await kakeibo.listRecentExpenses(limit);

  return [
    `直近の支出 ${expenses.length}件`,
    "",
    expenses.length > 0 ? expenses.map(formatExpense).join("\n") : "登録済みの支出はありません。"
  ].join("\n");
}

function formatBalances(settlement: SettlementSummary): string {
  if (settlement.balances.length === 0) return "メンバーが登録されていません。";
  return settlement.balances
    .map((balance) => `${balance.name}: ${formatSignedYen(balance.balanceYen)}`)
    .join("\n");
}

function formatYen(amountYen: number): string {
  return `${amountYen.toLocaleString("ja-JP")}円`;
}

function formatSignedYen(amountYen: number): string {
  if (amountYen > 0) return `+${formatYen(amountYen)}`;
  if (amountYen < 0) return `-${formatYen(Math.abs(amountYen))}`;
  return "±0円";
}

function formatExpense(expense: Expense, index: number): string {
  const date = formatDate(expense.occurredAt);
  const description = expense.description ?? "内容未設定";
  const category = expense.category?.name ?? "カテゴリ不明";
  const payer = expense.payer?.name ?? "支払者不明";
  return `${index + 1}. ${date} ${description} ${formatYen(expense.amountYen)} (${category} / ${payer})`;
}

function formatDate(value: string | undefined): string {
  if (!value) return "日付不明";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日付不明";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric"
  }).format(date);
}
