import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  KAKEIBO_API_BASE_URL: z.string().url(),
  LINE_CHANNEL_SECRET: z.string().min(1),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().min(1),
  LINE_ALLOWED_USER_IDS: z.string().min(1),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  SUMMARY_SCHEDULE_CONFIG_PATH: z.string().optional().default("")
});

export type AppConfig = {
  port: number;
  kakeiboApiBaseUrl: string;
  lineChannelSecret: string;
  lineChannelAccessToken: string;
  allowedUserIds: Set<string>;
  sessionTtlMs: number;
  summaryScheduleConfigPath?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const allowedUserIds = new Set(
    parsed.LINE_ALLOWED_USER_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );

  if (allowedUserIds.size === 0) {
    throw new Error("LINE_ALLOWED_USER_IDSを設定してください。");
  }

  return {
    port: parsed.PORT,
    kakeiboApiBaseUrl: parsed.KAKEIBO_API_BASE_URL.replace(/\/+$/, ""),
    lineChannelSecret: parsed.LINE_CHANNEL_SECRET,
    lineChannelAccessToken: parsed.LINE_CHANNEL_ACCESS_TOKEN,
    allowedUserIds,
    sessionTtlMs: parsed.SESSION_TTL_MINUTES * 60 * 1000,
    summaryScheduleConfigPath: parsed.SUMMARY_SCHEDULE_CONFIG_PATH.trim() || undefined
  };
}
