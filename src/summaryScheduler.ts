import type { Client } from "@line/bot-sdk";
import { buildSummaryMessage } from "./summaryMessage.js";
import type { SummarySchedule, SummaryScheduleConfig } from "./summaryConfig.js";
import type { KakeiboClient } from "./types.js";

type ZonedParts = {
  dateKey: string;
  dayOfMonth: number;
  dayOfWeek: number;
  hour: number;
  minute: number;
};

export class SummaryScheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly sentKeys = new Set<string>();

  constructor(
    private readonly config: SummaryScheduleConfig | null,
    private readonly kakeibo: KakeiboClient,
    private readonly lineClient: Pick<Client, "pushMessage">,
    private readonly now: () => Date = () => new Date()
  ) {}

  start(): void {
    if (!this.config?.enabled || this.config.schedules.length === 0 || this.config.recipients.length === 0) return;
    this.tick();
    this.timer = setInterval(() => void this.tick(), 30_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(date = this.now()): Promise<void> {
    if (!this.config?.enabled) return;

    const parts = getZonedParts(date, this.config.timezone);
    const dueSchedules = this.config.schedules
      .map((schedule, index) => ({ schedule, index }))
      .filter(({ schedule }) => isScheduleDue(schedule, parts))
      .filter(({ index }) => this.markDueOnce(index, parts));

    if (dueSchedules.length === 0) return;

    try {
      const text = await buildSummaryMessage(this.kakeibo);
      await Promise.all(
        this.config.recipients.map((recipient) =>
          this.lineClient.pushMessage(recipient, { type: "text", text })
        )
      );
    } catch (error) {
      console.error("failed to send scheduled summary", error);
    }
  }

  private markDueOnce(scheduleIndex: number, parts: ZonedParts): boolean {
    const key = `${scheduleIndex}:${parts.dateKey}:${parts.hour}:${parts.minute}`;
    if (this.sentKeys.has(key)) return false;
    this.sentKeys.add(key);
    return true;
  }
}

export function isScheduleDue(schedule: SummarySchedule, parts: ZonedParts): boolean {
  const [hour, minute] = schedule.time.split(":").map(Number);
  if (parts.hour !== hour || parts.minute !== minute) return false;

  if (schedule.type === "daily") return true;
  if (schedule.type === "weekly") return parts.dayOfWeek === schedule.dayOfWeek;
  return parts.dayOfMonth === schedule.dayOfMonth;
}

export function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);

  return {
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    dayOfMonth: day,
    dayOfWeek: weekdayToNumber(values.weekday),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function weekdayToNumber(weekday: string | undefined): number {
  switch (weekday) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    case "Sat":
      return 6;
    default:
      throw new Error(`unexpected weekday: ${weekday}`);
  }
}
