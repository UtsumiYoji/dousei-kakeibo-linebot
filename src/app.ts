import express from "express";
import { Client, middleware, type ClientConfig, type MiddlewareConfig, type WebhookEvent } from "@line/bot-sdk";
import { ExpenseConversation } from "./conversation.js";
import { HttpKakeiboClient } from "./kakeiboClient.js";
import { toLineTextMessage } from "./lineMessages.js";
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
  const summaryConfig = loadSummaryScheduleConfig(config.summaryScheduleConfigPath, config.allowedUserIds);
  new SummaryScheduler(summaryConfig, kakeibo, lineClient).start();

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/webhook/line", middleware(lineConfig), async (request, response, next) => {
    try {
      const events = (request.body.events ?? []) as WebhookEvent[];
      await Promise.all(events.map((event) => handleEvent(event, conversation, lineClient)));
      response.status(200).end();
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "internal server error" });
  });

  return app;
}

async function handleEvent(event: WebhookEvent, conversation: ExpenseConversation, lineClient: Client): Promise<void> {
  if (event.type !== "message" || event.message.type !== "text") return;

  const userId = "userId" in event.source ? event.source.userId : undefined;
  if (!userId) return;

  const eventId = typeof event.webhookEventId === "string" ? event.webhookEventId : undefined;
  const replies = await conversation.handleText(userId, event.message.text, eventId);
  if (replies.length === 0) return;

  await lineClient.replyMessage(event.replyToken, replies.map(toLineTextMessage));
}
