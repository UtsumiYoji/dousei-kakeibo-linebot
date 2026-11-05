import express from "express";
import {
  Client,
  JSONParseError,
  SignatureValidationFailed,
  middleware,
  type ClientConfig,
  type MiddlewareConfig,
  type WebhookEvent
} from "@line/bot-sdk";
import { ChatQueue } from "./chatQueue.js";
import { ExpenseConversation } from "./conversation.js";
import { DraftStore } from "./draftStore.js";
import { ExpenseAssistant } from "./expenseAssistant.js";
import { HttpKakeiboClient } from "./kakeiboClient.js";
import { handleLineEvent, toChatContext } from "./lineEvents.js";
import { SakuraLlmClient } from "./llmClient.js";
import { SessionStore } from "./sessionStore.js";
import { loadSummaryScheduleConfig } from "./summaryConfig.js";
import { SummaryScheduler } from "./summaryScheduler.js";
import type { AppConfig } from "./config.js";

export function createApp(config: AppConfig) {
  const app = express();
  const lineConfig: MiddlewareConfig = {
    channelSecret: config.lineChannelSecret,
    channelAccessToken: config.lineChannelAccessToken
  };
  const clientConfig: ClientConfig = {
    channelSecret: config.lineChannelSecret,
    channelAccessToken: config.lineChannelAccessToken
  };
  const lineClient = new Client(clientConfig);
  const kakeibo = new HttpKakeiboClient(config.kakeiboApiBaseUrl);
  const sessions = new SessionStore(config.sessionTtlMs);
  const conversation = new ExpenseConversation(sessions, kakeibo, config.allowedUserIds);
  const assistant = new ExpenseAssistant({
    conversation,
    sessions,
    drafts: new DraftStore(config.draftTtlMs ?? 24 * 60 * 60 * 1000),
    kakeibo,
    llm: config.ai ? new SakuraLlmClient(config.ai) : undefined,
    allowedUserIds: config.allowedUserIds,
    allowedGroupIds: config.allowedGroupIds ?? new Set(),
    memberMap: config.memberMap ?? new Map()
  });
  const queue = new ChatQueue();
  const summaryConfig = loadSummaryScheduleConfig(config.summaryScheduleConfigPath, config.allowedUserIds);
  new SummaryScheduler(summaryConfig, kakeibo, lineClient).start();

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/webhook/line", middleware(lineConfig), (request, response) => {
    const events = (request.body.events ?? []) as WebhookEvent[];
    // LLMの応答を待たずに200を返し、結果は返信用トークンで送る。
    response.status(200).end();
    for (const event of events) {
      const context = toChatContext(event.source);
      if (context) void queue.enqueue(context.chatId, () => handleLineEvent(event, assistant, lineClient));
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    // 署名なし・不正署名・壊れたbodyはクライアント側の誤りなので4xxで返す(サーバー障害扱いにしない)。
    if (error instanceof SignatureValidationFailed) {
      console.warn(`webhook rejected: ${error.message}`);
      response.status(401).json({ error: "invalid signature" });
      return;
    }
    if (error instanceof JSONParseError) {
      console.warn(`webhook rejected: ${error.message}`);
      response.status(400).json({ error: "invalid request body" });
      return;
    }

    console.error(error);
    response.status(500).json({ error: "internal server error" });
  });

  return app;
}
