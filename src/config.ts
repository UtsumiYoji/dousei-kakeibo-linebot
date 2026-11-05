import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  KAKEIBO_API_BASE_URL: z.string().url(),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_ALLOWED_USER_IDS: z.string().min(1),
  LINE_ALLOWED_GROUP_IDS: z.string().optional().default(""),
  LINE_MEMBER_MAP: z.string().optional().default(""),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  DRAFT_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
  SAKURA_AI_TOKEN: z.string().optional().default(""),
  SAKURA_AI_BASE_URL: z.string().url().default("https://api.ai.sakura.ad.jp/v1"),
  SAKURA_AI_MODEL: z.string().min(1).default("preview/Qwen3-VL-30B-A3B-Instruct"),
  SUMMARY_SCHEDULE_CONFIG_PATH: z.string().optional().default("")
});

export type AppConfig = {
  port: number;
  kakeiboApiBaseUrl: string;
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  allowedUserIds: Set<string>;
  allowedGroupIds?: Set<string>;
  memberMap?: Map<string, string>;
  sessionTtlMs: number;
  draftTtlMs?: number;
  ai?: {
    token: string;
    baseUrl: string;
    model: string;
  };
  summaryScheduleConfigPath?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const allowedUserIds = new Set(splitList(parsed.LINE_ALLOWED_USER_IDS));
  const aiToken = parsed.SAKURA_AI_TOKEN.trim();

  if (allowedUserIds.size === 0) {
    throw new Error("LINE_ALLOWED_USER_IDSを設定してください。");
  }

  return {
    port: parsed.PORT,
    kakeiboApiBaseUrl: parsed.KAKEIBO_API_BASE_URL.replace(/\/+$/, ""),
    lineChannelSecret: parsed.LINE_CHANNEL_SECRET,
    lineChannelAccessToken: parsed.LINE_CHANNEL_ACCESS_TOKEN,
    allowedUserIds,
    allowedGroupIds: new Set(splitList(parsed.LINE_ALLOWED_GROUP_IDS)),
    memberMap: parseMemberMap(parsed.LINE_MEMBER_MAP),
    sessionTtlMs: parsed.SESSION_TTL_MINUTES * 60 * 1000,
    draftTtlMs: parsed.DRAFT_TTL_MINUTES * 60 * 1000,
    ai: aiToken
      ? { token: aiToken, baseUrl: parsed.SAKURA_AI_BASE_URL.replace(/\/+$/, ""), model: parsed.SAKURA_AI_MODEL }
      : undefined,
    summaryScheduleConfigPath: parsed.SUMMARY_SCHEDULE_CONFIG_PATH.trim() || undefined
  };
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** `Uxxx:太郎,Uyyy:花子` の形式。右辺はメンバー名またはメンバーID。 */
function parseMemberMap(value: string): Map<string, string> {
  const entries = splitList(value).map((entry) => {
    const separator = entry.indexOf(":");
    const userId = entry.slice(0, Math.max(separator, 0)).trim();
    const member = entry.slice(separator + 1).trim();
    if (!userId || !member) throw new Error(`LINE_MEMBER_MAPの形式が不正です: ${entry}`);
    return [userId, member] as const;
  });
  return new Map(entries);
}
