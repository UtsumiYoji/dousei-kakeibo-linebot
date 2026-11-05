import { Readable } from "node:stream";
import type { WebhookEvent } from "@line/bot-sdk";
import { describe, expect, it, vi } from "vitest";
import { ChatQueue } from "../src/chatQueue.js";
import type { ExpenseAssistant } from "../src/expenseAssistant.js";
import { handleLineEvent, toChatContext } from "../src/lineEvents.js";
import { toLineMessage } from "../src/lineMessages.js";

const common = { mode: "active", timestamp: 0, webhookEventId: "event-1", deliveryContext: { isRedelivery: false } };
const groupSource = { type: "group", groupId: "group-1", userId: "user-1" };

function fakeAssistant(replies = [{ text: "ok" }]) {
  return {
    handleText: vi.fn(async () => replies),
    handleImage: vi.fn(async (_context, load: () => Promise<Buffer>) => {
      await load();
      return replies;
    }),
    handlePostback: vi.fn(async () => replies)
  };
}

function fakeLine() {
  return {
    getMessageContent: vi.fn(async () => Readable.from([Buffer.from("ab"), Buffer.from("c")])),
    pushMessage: vi.fn(async () => ({})),
    replyMessage: vi.fn(async () => ({}))
  };
}

async function run(event: unknown, assistant = fakeAssistant(), line = fakeLine()) {
  await handleLineEvent(event as WebhookEvent, assistant as unknown as ExpenseAssistant, line as never);
  return { assistant, line };
}

describe("toChatContext", () => {
  it("グループとトークルームはチャット単位にする", () => {
    expect(toChatContext({ type: "group", groupId: "g", userId: "u" })).toEqual({ chatId: "g", chatType: "group", userId: "u" });
    expect(toChatContext({ type: "room", roomId: "r" })).toEqual({ chatId: "r", chatType: "group", userId: undefined });
  });

  it("1対1はuserIdをチャットIDにする", () => {
    expect(toChatContext({ type: "user", userId: "u" })).toEqual({ chatId: "u", chatType: "user", userId: "u" });
  });
});

describe("handleLineEvent", () => {
  it("テキストを処理してreplyする", async () => {
    const { assistant, line } = await run({
      ...common,
      type: "message",
      replyToken: "token",
      source: groupSource,
      message: { id: "m1", type: "text", text: "こんにちは" }
    });

    expect(assistant.handleText).toHaveBeenCalledWith(expect.objectContaining({ chatId: "group-1" }), "こんにちは", "event-1");
    expect(line.replyMessage).toHaveBeenCalledWith("token", [{ type: "text", text: "ok" }]);
  });

  it("画像をダウンロードして渡す", async () => {
    const assistant = fakeAssistant();
    const handleImage = assistant.handleImage;
    let loaded: Buffer | undefined;
    handleImage.mockImplementationOnce(async (_context, load) => {
      loaded = await load();
      return [];
    });

    const { line } = await run(
      { ...common, type: "message", replyToken: "token", source: groupSource, message: { id: "m1", type: "image", contentProvider: { type: "line" } } },
      assistant
    );

    expect(line.getMessageContent).toHaveBeenCalledWith("m1");
    expect(loaded?.toString()).toBe("abc");
    expect(line.replyMessage).not.toHaveBeenCalled();
  });

  it("外部URLの画像は扱わない", async () => {
    const { assistant } = await run({
      ...common,
      type: "message",
      replyToken: "token",
      source: groupSource,
      message: { id: "m1", type: "image", contentProvider: { type: "external" } }
    });

    expect(assistant.handleImage).not.toHaveBeenCalled();
  });

  it("postbackを処理する", async () => {
    const { assistant } = await run({
      ...common,
      type: "postback",
      replyToken: "token",
      source: groupSource,
      postback: { data: "action=confirm&draft=d1" }
    });

    expect(assistant.handlePostback).toHaveBeenCalledWith(expect.anything(), "action=confirm&draft=d1", "event-1");
  });

  it("スタンプなど対象外のイベントは無視する", async () => {
    const { line } = await run({
      ...common,
      type: "message",
      replyToken: "token",
      source: groupSource,
      message: { id: "m1", type: "sticker" }
    });

    expect(line.replyMessage).not.toHaveBeenCalled();
  });

  it("replyに失敗したらpushで届ける", async () => {
    const line = fakeLine();
    line.replyMessage.mockRejectedValueOnce(new Error("invalid reply token"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await run(
      { ...common, type: "message", replyToken: "token", source: groupSource, message: { id: "m1", type: "text", text: "x" } },
      fakeAssistant(),
      line
    );

    expect(line.pushMessage).toHaveBeenCalledWith("group-1", [{ type: "text", text: "ok" }]);
    warn.mockRestore();
  });
});

describe("toLineMessage", () => {
  it("カードはpostbackボタン付きのFlexにする", () => {
    const message = toLineMessage({
      text: "確認",
      card: {
        title: "登録しますか",
        rows: [{ label: "金額", value: "750円" }],
        warning: "重複の可能性",
        buttons: [{ label: "登録", data: "action=confirm&draft=d1", primary: true }]
      }
    });

    expect(message.type).toBe("flex");
    const json = JSON.stringify(message);
    expect(json).toContain("action=confirm&draft=d1");
    expect(json).toContain("750円");
    expect(json).toContain("重複の可能性");
  });

  it("カードがなければテキストにする", () => {
    expect(toLineMessage({ text: "こんにちは" })).toEqual({ type: "text", text: "こんにちは" });
  });
});

describe("ChatQueue", () => {
  it("同じチャットは順番に処理し、失敗しても後続を止めない", async () => {
    const queue = new ChatQueue();
    const order: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const first = queue.enqueue("chat", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("first");
      throw new Error("boom");
    });
    const second = queue.enqueue("chat", async () => {
      order.push("second");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
    error.mockRestore();
  });

  it("別のチャットは待たない", async () => {
    const queue = new ChatQueue();
    const order: string[] = [];
    let release = () => {};
    const blocked = queue.enqueue("a", () => new Promise<void>((resolve) => { release = resolve; }));

    await queue.enqueue("b", async () => {
      order.push("b");
    });
    release();
    await blocked;

    expect(order).toEqual(["b"]);
  });
});
