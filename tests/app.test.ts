import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const channelSecret = "test-channel-secret";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp({
    port: 0,
    kakeiboApiBaseUrl: "http://127.0.0.1:9",
    lineChannelSecret: channelSecret,
    lineChannelAccessToken: "test-access-token",
    allowedUserIds: new Set(["Utest"]),
    sessionTtlMs: 60_000
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sign(body: string): string {
  return createHmac("sha256", channelSecret).update(body).digest("base64");
}

function postWebhook(body: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/webhook/line`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body
  });
}

describe("POST /webhook/line", () => {
  it("署名ヘッダーがなければ401を返す", async () => {
    const response = await postWebhook(JSON.stringify({ events: [] }));
    expect(response.status).toBe(401);
  });

  it("署名が一致しなければ401を返す", async () => {
    const response = await postWebhook(JSON.stringify({ events: [] }), { "x-line-signature": sign("other") });
    expect(response.status).toBe(401);
  });

  it("正しい署名でもbodyがJSONでなければ400を返す", async () => {
    const body = "not-json";
    const response = await postWebhook(body, { "x-line-signature": sign(body) });
    expect(response.status).toBe(400);
  });

  it("正しい署名のイベントなしリクエストは200を返す", async () => {
    const body = JSON.stringify({ destination: "Uxxx", events: [] });
    const response = await postWebhook(body, { "x-line-signature": sign(body) });
    expect(response.status).toBe(200);
  });
});
