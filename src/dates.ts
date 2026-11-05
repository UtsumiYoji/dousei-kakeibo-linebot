const TIME_ZONE = "Asia/Tokyo";

/** 日本時間の日付を YYYY-MM-DD で返す。 */
export function jstDate(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TIME_ZONE }).format(date);
}

export function jstWeekday(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: TIME_ZONE, weekday: "short" }).format(date);
}

/** 実在する過去または当日の日付だけを受け入れる。未来の日付はレシートの読み違いとして扱う。 */
export function normalizeDate(value: unknown, today: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value <= today ? value : null;
}

/** 日本時間の正午として送る。どのタイムゾーンで表示しても日付がずれない。 */
export function toOccurredAt(date: string): string {
  return `${date}T12:00:00+09:00`;
}
