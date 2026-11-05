import { describe, expect, it, vi } from "vitest";
import { buildMessagePrompt, buildReceiptPrompt, interpretMessage, readReceipt, toAmountYen } from "../src/aiExtractor.js";
import type { LlmClient } from "../src/llmClient.js";

const context = {
  text: "スーパー 1200",
  now: new Date("2026-11-05T03:00:00.000Z"),
  memberNames: ["太郎", "花子"],
  categoryNames: ["食費", "その他"],
  senderName: "太郎",
  draftSummary: null
};

function llm(response: unknown): LlmClient {
  return { completeJson: vi.fn(async () => response) };
}

describe("toAmountYen", () => {
  it("正の整数だけを金額として受け入れる", () => {
    expect(toAmountYen(1200)).toBe(1200);
    expect(toAmountYen("1,200円")).toBe(1200);
    expect(toAmountYen("¥980")).toBe(980);
    expect(toAmountYen(0)).toBeNull();
    expect(toAmountYen(-5)).toBeNull();
    expect(toAmountYen(12.5)).toBeNull();
    expect(toAmountYen(null)).toBeNull();
    expect(toAmountYen("不明")).toBeNull();
  });
});

describe("prompts", () => {
  it("レシートのプロンプトにカテゴリを含める", () => {
    expect(buildReceiptPrompt(["食費", "趣味"])).toContain("食費、趣味");
  });

  it("テキストのプロンプトに日本時間の今日と発言者を含める", () => {
    const prompt = buildMessagePrompt({ ...context, now: new Date("2026-11-05T16:00:00.000Z") });

    expect(prompt).toContain("今日: 2026-11-06 (金)");
    expect(prompt).toContain("発言者: 太郎");
  });

  it("発言者が不明なら支払者を推定させない", () => {
    const prompt = buildMessagePrompt({ ...context, senderName: null });

    expect(prompt).toContain("発言者: 不明");
    expect(prompt).toContain("指定がなければ payer は null");
  });
});

describe("interpretMessage", () => {
  it("金額のない新規の案は質問に変える", async () => {
    const result = await interpretMessage(llm({ action: "propose", amountYen: null }), context);

    expect(result.action).toBe("ask");
  });

  it("下書きがあれば入力に含める", async () => {
    const client = llm({ action: "none" });

    await interpretMessage(client, { ...context, draftSummary: "金額: 100円" });

    expect(JSON.stringify(vi.mocked(client.completeJson).mock.calls[0])).toContain("現在の下書き: 金額: 100円");
  });

  it("想定外のactionは失敗にする", async () => {
    await expect(interpretMessage(llm({ action: "register" }), context)).rejects.toThrow();
  });
});

describe("readReceipt", () => {
  it("PNGとJPEGをdata URIで渡す", async () => {
    const client = llm({ isReceipt: true, totalYen: "750" });

    const result = await readReceipt(client, Buffer.from([0x89, 0x50, 0x4e, 0x47]), ["食費"]);

    expect(result.totalYen).toBe(750);
    expect(JSON.stringify(vi.mocked(client.completeJson).mock.calls[0])).toContain("data:image/png;base64,");
  });
});
