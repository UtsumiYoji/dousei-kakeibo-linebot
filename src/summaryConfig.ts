import { readFileSync } from "node:fs";
import { z } from "zod";

const weekdayMap = {
  sunday: 0,
  sun: 0,
  "日": 0,
  monday: 1,
  mon: 1,
  "月": 1,
  tuesday: 2,
  tue: 2,
  "火": 2,
  wednesday: 3,
  wed: 3,
  "水": 3,
  thursday: 4,
  thu: 4,
  "木": 4,
  friday: 5,
  fri: 5,
  "金": 5,
  saturday: 6,
  sat: 6,
  "土": 6
} as const;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be HH:mm");

const rawScheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("daily"),
    time: timeSchema
  }),
  z.object({
    type: z.literal("weekly"),
    dayOfWeek: z.union([z.number().int().min(0).max(6), z.string().min(1)]),
    time: timeSchema
  }),
  z.object({
    type: z.literal("monthly"),
    dayOfMonth: z.number().int().min(1).max(31),
    time: timeSchema
  })
]);

const rawConfigSchema = z.object({
  enabled: z.boolean().default(true),
  timezone: z.string().min(1).default("Asia/Tokyo"),
  recipients: z.array(z.string().min(1)).default([]),
  schedules: z.array(rawScheduleSchema).default([])
});

export type SummarySchedule =
  | { type: "daily"; time: string }
  | { type: "weekly"; dayOfWeek: number; time: string }
  | { type: "monthly"; dayOfMonth: number; time: string };

export type SummaryScheduleConfig = {
  enabled: boolean;
  timezone: string;
  recipients: string[];
  schedules: SummarySchedule[];
};

export function loadSummaryScheduleConfig(path: string | undefined, fallbackRecipients: Iterable<string>): SummaryScheduleConfig | null {
  if (!path) return null;

  const parsed = rawConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return {
    enabled: parsed.enabled,
    timezone: parsed.timezone,
    recipients: parsed.recipients.length > 0 ? parsed.recipients : Array.from(fallbackRecipients),
    schedules: parsed.schedules.map(normalizeSchedule)
  };
}

function normalizeSchedule(schedule: z.infer<typeof rawScheduleSchema>): SummarySchedule {
  if (schedule.type !== "weekly") return schedule;
  return {
    ...schedule,
    dayOfWeek: normalizeDayOfWeek(schedule.dayOfWeek)
  };
}

function normalizeDayOfWeek(value: number | string): number {
  if (typeof value === "number") return value;

  const normalized = value.trim().toLowerCase();
  const day = weekdayMap[normalized as keyof typeof weekdayMap];
  if (day == null) {
    throw new Error(`dayOfWeek is invalid: ${value}`);
  }
  return day;
}
