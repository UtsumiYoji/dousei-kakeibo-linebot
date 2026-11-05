import type { Client, EventSource, WebhookEvent } from "@line/bot-sdk";
import type { ChatContext, ExpenseAssistant } from "./expenseAssistant.js";
import { toLineMessage } from "./lineMessages.js";
import type { BotReply } from "./types.js";

type LineClient = Pick<Client, "getMessageContent" | "pushMessage" | "replyMessage">;

export function toChatContext(source: EventSource): ChatContext | null {
  if (source.type === "group") return { chatId: source.groupId, chatType: "group", userId: source.userId };
  if (source.type === "room") return { chatId: source.roomId, chatType: "group", userId: source.userId };
  return source.userId ? { chatId: source.userId, chatType: "user", userId: source.userId } : null;
}

export async function handleLineEvent(event: WebhookEvent, assistant: ExpenseAssistant, lineClient: LineClient): Promise<void> {
  const context = toChatContext(event.source);
  if (!context) return;

  const replies = await dispatch(event, context, assistant, lineClient);
  if (replies.length === 0 || !("replyToken" in event) || !event.replyToken) return;

  const messages = replies.map(toLineMessage);
  try {
    await lineClient.replyMessage(event.replyToken, messages);
  } catch (error) {
    // 順番待ちなどで返信用トークンが切れた場合は、通数を消費するがpushで結果を届ける。
    console.warn("reply failed, falling back to push", error);
    await lineClient.pushMessage(context.chatId, messages);
  }
}

async function dispatch(
  event: WebhookEvent,
  context: ChatContext,
  assistant: ExpenseAssistant,
  lineClient: LineClient
): Promise<BotReply[]> {
  const eventId = typeof event.webhookEventId === "string" ? event.webhookEventId : undefined;

  if (event.type === "postback") return assistant.handlePostback(context, event.postback.data, eventId);
  if (event.type !== "message") return [];

  const { message } = event;
  if (message.type === "text") return assistant.handleText(context, message.text, eventId);
  if (message.type === "image" && message.contentProvider.type === "line") {
    return assistant.handleImage(context, () => downloadContent(lineClient, message.id), eventId);
  }
  return [];
}

async function downloadContent(lineClient: LineClient, messageId: string): Promise<Buffer> {
  const stream = await lineClient.getMessageContent(messageId);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks);
}
