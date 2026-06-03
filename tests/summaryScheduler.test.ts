import { describe, expect, it } from "vitest";
import { getZonedParts, isScheduleDue } from "../src/summaryScheduler.js";

describe("summary schedule matching", () => {
  const parts = {
    dateKey: "2026-06-03",
    dayOfMonth: 3,
    dayOfWeek: 3,
    hour: 21,
    minute: 30
  };

  it("matches daily schedules by time", () => {
    expect(isScheduleDue({ type: "daily", time: "21:30" }, parts)).toBe(true);
    expect(isScheduleDue({ type: "daily", time: "21:31" }, parts)).toBe(false);
  });

  it("matches weekly schedules by weekday and time", () => {
    expect(isScheduleDue({ type: "weekly", dayOfWeek: 3, time: "21:30" }, parts)).toBe(true);
    expect(isScheduleDue({ type: "weekly", dayOfWeek: 4, time: "21:30" }, parts)).toBe(false);
  });

  it("matches monthly schedules by day and time", () => {
    expect(isScheduleDue({ type: "monthly", dayOfMonth: 3, time: "21:30" }, parts)).toBe(true);
    expect(isScheduleDue({ type: "monthly", dayOfMonth: 4, time: "21:30" }, parts)).toBe(false);
  });
});

describe("getZonedParts", () => {
  it("returns local date parts for the configured timezone", () => {
    const parts = getZonedParts(new Date("2026-06-02T15:30:00.000Z"), "Asia/Tokyo");

    expect(parts).toEqual({
      dateKey: "2026-06-03",
      dayOfMonth: 3,
      dayOfWeek: 3,
      hour: 0,
      minute: 30
    });
  });
});
