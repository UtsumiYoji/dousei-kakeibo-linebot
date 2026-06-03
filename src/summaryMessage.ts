import type { KakeiboClient, SettlementSummary } from "./types.js";

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
