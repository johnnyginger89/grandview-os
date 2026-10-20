import { describe, expect, it } from "vitest";
import { businessHour, parseBusinessDateTime, startOfBusinessMonth } from "./time";

describe("business time zone", () => {
  it("reads bare wall-clock input as Vancouver time (PDT, UTC-7)", () => {
    expect(parseBusinessDateTime("2026-10-23T10:00")?.toISOString()).toBe("2026-10-23T17:00:00.000Z");
  });
  it("handles PST (UTC-8) after the November DST change", () => {
    expect(parseBusinessDateTime("2026-11-10 09:30")?.toISOString()).toBe("2026-11-10T17:30:00.000Z");
  });
  it("keeps explicit offsets and Z untouched", () => {
    expect(parseBusinessDateTime("2026-10-23T17:00:00Z")?.toISOString()).toBe("2026-10-23T17:00:00.000Z");
    expect(parseBusinessDateTime("2026-10-23T10:00:00-07:00")?.toISOString()).toBe("2026-10-23T17:00:00.000Z");
  });
  it("reads written dates from booking tools as Vancouver time", () => {
    const want = "2026-10-23T17:00:00.000Z";
    for (const v of [
      "Thursday, October 23, 2026 10:00 AM",
      "Thursday, 23 October 2026 10:00",
      "23 October 2026 at 10:00 am",
      "Oct 23 2026 10am",
      "October 23rd, 2026 10:00 a.m.",
    ]) expect(parseBusinessDateTime(v)?.toISOString(), v).toBe(want);
    expect(parseBusinessDateTime("Thursday, November 5, 2026 2:30 PM")?.toISOString()).toBe("2026-11-05T22:30:00.000Z");
    expect(parseBusinessDateTime("Monday, December 1, 2026 12:00 PM")?.toISOString()).toBe("2026-12-01T20:00:00.000Z");
  });
  it("rejects garbage", () => {
    expect(parseBusinessDateTime("next tuesday-ish")).toBeNull();
    expect(parseBusinessDateTime("")).toBeNull();
  });
  it("computes the Vancouver month start and hour independent of server TZ", () => {
    // 2026-11-01 03:00 UTC is still Oct 31, 20:00 in Vancouver.
    const now = new Date("2026-11-01T03:00:00Z");
    expect(startOfBusinessMonth(now).toISOString()).toBe("2026-10-01T07:00:00.000Z");
    expect(businessHour(now)).toBe(20);
  });
});
