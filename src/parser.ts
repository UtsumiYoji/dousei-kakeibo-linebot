export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function isStartCommand(text: string): boolean {
  const normalized = normalizeText(text);
  return ["支出", "登録", "支出登録"].includes(normalized);
}

export function isCancelCommand(text: string): boolean {
  return ["キャンセル", "取消", "中止", "やめる"].includes(normalizeText(text));
}

export function isConfirmCommand(text: string): boolean {
  return ["登録", "はい", "OK", "ok"].includes(normalizeText(text));
}

export function isReviseCommand(text: string): boolean {
  return ["修正", "やり直し", "戻る"].includes(normalizeText(text));
}

export function parseAmountYen(text: string): number | null {
  const normalized = normalizeText(text)
    .replace(/円$/, "")
    .replace(/,/g, "");
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function findByNameOrIndex<T extends { name: string }>(items: T[], text: string): T | null {
  const normalized = normalizeText(text);
  const index = Number(normalized);
  if (Number.isInteger(index) && index >= 1 && index <= items.length) {
    return items[index - 1] ?? null;
  }

  const exact = items.find((item) => item.name === normalized);
  if (exact) return exact;

  const caseInsensitive = items.find((item) => item.name.toLowerCase() === normalized.toLowerCase());
  return caseInsensitive ?? null;
}
