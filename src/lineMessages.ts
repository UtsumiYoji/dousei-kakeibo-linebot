import type { FlexBox, FlexComponent, FlexMessage, Message, QuickReplyItem, TextMessage } from "@line/bot-sdk";
import type { BotCard, BotReply } from "./types.js";

export function toLineMessage(reply: BotReply): Message {
  return reply.card ? toFlexMessage(reply.text, reply.card) : toLineTextMessage(reply);
}

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

// クイックリプライは誰かが発言すると消えるので、グループで確認待ちになる操作はカードのボタンにする。
function toFlexMessage(altText: string, card: BotCard): FlexMessage {
  const body: FlexComponent[] = [
    { type: "text", text: card.title, weight: "bold", size: "md", wrap: true },
    ...card.rows.map(toRow)
  ];
  if (card.warning) {
    body.push({ type: "text", text: card.warning, size: "sm", color: "#C0392B", wrap: true });
  }

  return {
    type: "flex",
    altText: altText.slice(0, 400),
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", spacing: "sm", contents: body },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: card.buttons.map((button) => ({
          type: "button",
          style: button.primary ? "primary" : "secondary",
          height: "sm",
          action: {
            type: "postback",
            label: button.label.slice(0, 20),
            data: button.data,
            displayText: button.label
          }
        }))
      }
    }
  };
}

function toRow(row: { label: string; value: string }): FlexBox {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: row.label, size: "sm", color: "#777777", flex: 2 },
      { type: "text", text: row.value, size: "sm", wrap: true, flex: 5 }
    ]
  };
}
