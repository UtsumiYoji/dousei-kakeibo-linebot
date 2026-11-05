import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { jstDate, normalizeDate, toOccurredAt } from "../src/dates.js";

const required = {
  KAKEIBO_API_BASE_URL: "http://app:3000",
  LINE_CHANNEL_SECRET: "secret",
  LINE_CHANNEL_ACCESS_TOKEN: "token",
  LINE_ALLOWED_USER_IDS: "U1"
};

describe("loadConfig", () => {
  it("AIの設定がなくても起動できる", () => {
    const config = loadConfig(required);

    expect(config.ai).toBeUndefined();
    expect(config.allowedGroupIds?.size).toBe(0);
    expect(config.memberMap?.size).toBe(0);
    expect(config.draftTtlMs).toBe(24 * 60 * 60 * 1000);
  });

  it("トークンがあればAIを有効にし、既定のモデルを使う", () => {
    const config = loadConfig({ ...required, SAKURA_AI_TOKEN: " token " });

    expect(config.ai).toEqual({
      token: "token",
      baseUrl: "https://api.ai.sakura.ad.jp/v1",
      model: "preview/Qwen3-VL-30B-A3B-Instruct"
    });
  });

  it("グループとメンバーの対応を読み込む", () => {
    const config = loadConfig({ ...required, LINE_ALLOWED_GROUP_IDS: "C1, C2", LINE_MEMBER_MAP: "U1:太郎, U2:花子" });

    expect([...(config.allowedGroupIds ?? [])]).toEqual(["C1", "C2"]);
    expect(config.memberMap?.get("U2")).toBe("花子");
  });

  it("対応表の形式が不正なら起動時に失敗する", () => {
    expect(() => loadConfig({ ...required, LINE_MEMBER_MAP: "U1" })).toThrow("LINE_MEMBER_MAP");
    expect(() => loadConfig({ ...required, LINE_MEMBER_MAP: "U1:" })).toThrow("LINE_MEMBER_MAP");
  });
});

describe("dates", () => {
  it("日本時間で日付を判定する", () => {
    expect(jstDate(new Date("2026-11-05T15:30:00.000Z"))).toBe("2026-11-06");
  });

  it("実在する当日以前の日付だけを受け入れる", () => {
    expect(normalizeDate("2026-11-05", "2026-11-05")).toBe("2026-11-05");
    expect(normalizeDate("2026-11-06", "2026-11-05")).toBeNull();
    expect(normalizeDate("2026-02-30", "2026-11-05")).toBeNull();
    expect(normalizeDate("昨日", "2026-11-05")).toBeNull();
    expect(normalizeDate(null, "2026-11-05")).toBeNull();
  });

  it("日付がずれないよう日本時間の正午で送る", () => {
    expect(new Date(toOccurredAt("2026-11-05")).toISOString()).toBe("2026-11-05T03:00:00.000Z");
  });
});
