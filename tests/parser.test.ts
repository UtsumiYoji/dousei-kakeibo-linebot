import { describe, expect, it } from "vitest";
import { findByNameOrIndex, isRecentExpensesCommand, isSummaryCommand, parseAmountYen } from "../src/parser.js";

describe("parseAmountYen", () => {
  it.each([
    ["1200", 1200],
    ["1,200", 1200],
    ["1200円", 1200],
    [" 1200 ", 1200]
  ])("parses %s", (input, expected) => {
    expect(parseAmountYen(input)).toBe(expected);
  });

  it.each(["0", "-1", "12.5", "abc", ""])("rejects %s", (input) => {
    expect(parseAmountYen(input)).toBeNull();
  });
});

describe("findByNameOrIndex", () => {
  const items = [{ name: "食費" }, { name: "その他" }];

  it("finds by 1-based index", () => {
    expect(findByNameOrIndex(items, "2")).toEqual({ name: "その他" });
  });

  it("finds by name", () => {
    expect(findByNameOrIndex(items, "食費")).toEqual({ name: "食費" });
  });
});

describe("commands", () => {
  it.each(["サマリー", "家計簿サマリー", "清算状況", "精算状況", "状況"])("detects summary command: %s", (input) => {
    expect(isSummaryCommand(input)).toBe(true);
  });

  it.each(["履歴", "支出履歴", "登録履歴", "最近の支出", "直近5件"])("detects recent expenses command: %s", (input) => {
    expect(isRecentExpensesCommand(input)).toBe(true);
  });
});
