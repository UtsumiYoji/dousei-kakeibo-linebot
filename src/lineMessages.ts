import type { TextMessage, QuickReplyItem } from "@line/bot-sdk";
import type { BotReply } from "./types.js";

export function toLineTextMessage(reply: BotReply): TextMessage {
  const message: TextMessage = {
    type: "text",
    text: reply.text
  };

  if (reply.quickReplies?.length) {
    message.quickReply = {
      items: reply.quickReplies.slice(0, 13).map(toQuickReplyItem)
    };
  }

  return message;
}

function toQuickReplyItem(label: string): QuickReplyItem {
  return {
    type: "action",
    action: {
      type: "message",
      label: label.slice(0, 20),
      text: label
    }
  };
}
