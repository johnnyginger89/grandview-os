import { afterEach, describe, expect, it } from "vitest";
import { businessHour, businessZone, parseBusinessDateTime, setStaleBcDataForTests, startOfBusinessMonth } from "./time";

describe("business time zone", () => {
  it("reads bare wall-clock input as Vancouver time (PDT, UTC-7)", () => {
    expect(parseBusinessDateTime("2026-10-23T10:00")?.toISOString()).toBe("2026-10-23T17:00:00.000Z");
  });
  it("handles PST (UTC-8) in the winter before British Columbia's change", () => {
    expect(parseBusinessDateTime("2025-12-10 09:30")?.toISOString()).toBe("2025-12-10T17:30:00.000Z");
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
    expect(parseBusinessDateTime("Thursday, November 5, 2026 2:30 PM")?.toISOString()).toBe("2026-11-05T21:30:00.000Z");
    expect(parseBusinessDateTime("Tuesday, December 1, 2026 12:00 PM")?.toISOString()).toBe("2026-12-01T19:00:00.000Z");
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

// tz 2026b: British Columbia stays on UTC−7 and doesn't fall back on 2026-11-01. Runtimes with
// older zone data still believe in the fall-back; the helpers must give the same answer on both.
describe("British Columbia's permanent UTC−7", () => {
  afterEach(() => setStaleBcDataForTests(undefined));

  for (const [label, stale] of [["zone data detected", undefined], ["outdated zone data", true]] as const) {
    it(`keeps Vancouver on UTC−7 after 2026-11-01 (${label})`, () => {
      setStaleBcDataForTests(stale);
      expect(parseBusinessDateTime("2026-11-10 09:30")?.toISOString()).toBe("2026-11-10T16:30:00.000Z");
      expect(parseBusinessDateTime("2027-01-15T16:00")?.toISOString()).toBe("2027-01-15T23:00:00.000Z");
      expect(businessHour(new Date("2026-12-01T23:00:00Z"))).toBe(16);
      expect(startOfBusinessMonth(new Date("2026-12-15T12:00:00Z")).toISOString()).toBe("2026-12-01T07:00:00.000Z");
      // Before the change nothing moves.
      expect(parseBusinessDateTime("2026-10-23T10:00")?.toISOString()).toBe("2026-10-23T17:00:00.000Z");
      expect(parseBusinessDateTime("2025-12-10 09:30")?.toISOString()).toBe("2025-12-10T17:30:00.000Z");
    });
  }

  it("only swaps in the fixed zone after the change, and only on outdated zone data", () => {
    setStaleBcDataForTests(true);
    expect(businessZone(new Date("2026-11-01T08:59:59Z"))).toBe("America/Vancouver");
    expect(businessZone(new Date("2026-11-01T09:00:00Z"))).toBe("Etc/GMT+7");
    expect(businessZone("2027-06-01T12:00:00Z")).toBe("Etc/GMT+7");
    setStaleBcDataForTests(false);
    expect(businessZone(new Date("2027-06-01T12:00:00Z"))).toBe("America/Vancouver");
  });
});
