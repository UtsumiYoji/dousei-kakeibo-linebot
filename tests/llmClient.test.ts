import { describe, expect, it, vi } from "vitest";
import { LlmError, SakuraLlmClient, parseJsonObject } from "../src/llmClient.js";

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function client(fetchImpl: typeof fetch) {
  return new SakuraLlmClient({
    token: "secret",
    baseUrl: "https://example.test/v1",
    model: "test-model",
    retryDelayMs: 0,
    fetchImpl
  });
}

describe("SakuraLlmClient", () => {
  it("モデルとトークンを指定してJSONを返す", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => completion('{"ok":true}'));

    await expect(client(fetchImpl).completeJson([{ role: "user", content: "hi" }])).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "test-model", temperature: 0 });
  });

  it("429は再試行する", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(completion('{"ok":true}'));

    await expect(client(fetchImpl).completeJson([])).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("5xxやJSONの崩れも再試行し、続けば失敗にする", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 504 }))
      .mockResolvedValueOnce(completion("読めません"));

    await expect(client(fetchImpl).completeJson([])).rejects.toBeInstanceOf(LlmError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("400は再試行しない", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 400 }));

    await expect(client(fetchImpl).completeJson([])).rejects.toBeInstanceOf(LlmError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("通信エラーはLlmErrorにする", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("network");
    });

    await expect(client(fetchImpl).completeJson([])).rejects.toBeInstanceOf(LlmError);
  });
});

describe("parseJsonObject", () => {
  it("コードブロックや前後の文を取り除く", () => {
    expect(parseJsonObject('はい\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("JSONがなければ失敗する", () => {
    expect(() => parseJsonObject(null)).toThrow(LlmError);
    expect(() => parseJsonObject("{broken")).toThrow(LlmError);
  });
});
