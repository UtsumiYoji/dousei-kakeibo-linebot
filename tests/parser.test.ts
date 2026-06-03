import { describe, expect, it } from "vitest";
import { findByNameOrIndex, parseAmountYen } from "../src/parser.js";

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
