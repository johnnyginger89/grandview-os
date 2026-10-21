import { describe, expect, it } from "vitest";
import { afterConfirmed, afterNoticeSent, availableActions, isTentative, needsUpdate, noticeKindFor } from "./confirmation";

describe("start confirmation", () => {
  it("moves through monday's stages", () => {
    expect(afterNoticeSent("none", "start_week")).toBe("week_sent");
    expect(afterConfirmed("week_sent", "start_week")).toBe("week_confirmed");
    expect(afterNoticeSent("week_confirmed", "start_date")).toBe("date_sent");
    expect(afterConfirmed("date_sent", "start_date")).toBe("date_confirmed");
    // A phone confirmation without a notice.
    expect(afterConfirmed("none", "start_date")).toBe("date_confirmed");
    // An updated date notice asks the customer again.
    expect(afterNoticeSent("date_confirmed", "start_date")).toBe("date_sent");
  });

  it("flags a moved start once the customer has been told", () => {
    expect(needsUpdate({ confirmation: "date_confirmed", communicatedStart: "2026-10-26" }, "2026-10-28")).toBe(true);
    expect(needsUpdate({ confirmation: "date_confirmed", communicatedStart: "2026-10-26" }, "2026-10-26")).toBe(false);
    expect(needsUpdate({ confirmation: "none", communicatedStart: null }, "2026-10-28")).toBe(false);
    expect(needsUpdate({ confirmation: "date_sent", communicatedStart: "2026-10-26" }, null)).toBe(false);
  });

  it("only cares about the week after a week notice", () => {
    expect(needsUpdate({ confirmation: "week_sent", communicatedStart: "2026-10-26" }, "2026-10-28")).toBe(false);
    expect(needsUpdate({ confirmation: "week_confirmed", communicatedStart: "2026-10-26" }, "2026-11-02")).toBe(true);
  });

  it("offers the buttons per state", () => {
    const s = (confirmation: Parameters<typeof availableActions>[0]["confirmation"], communicatedStart: string | null = "2026-10-26") => ({ confirmation, communicatedStart });
    expect(availableActions(s("none", null), "2026-10-26")).toEqual(["send_week", "send_date"]);
    expect(availableActions(s("week_sent"), "2026-10-26")).toEqual(["confirm_week", "send_date"]);
    expect(availableActions(s("week_sent"), "2026-11-02")).toEqual(["send_week", "confirm_week", "send_date"]);
    expect(availableActions(s("week_confirmed"), "2026-10-27")).toEqual(["send_date"]);
    expect(availableActions(s("date_sent"), "2026-10-26")).toEqual(["confirm_date", "send_date"]);
    expect(availableActions(s("date_sent"), "2026-10-27")).toEqual(["send_update", "confirm_date"]);
    expect(availableActions(s("date_confirmed"), "2026-10-26")).toEqual([]);
    expect(availableActions(s("date_confirmed"), "2026-10-28")).toEqual(["send_update"]);
    expect(noticeKindFor("send_update")).toBe("start_date");
    expect(noticeKindFor("send_week")).toBe("start_week");
  });

  it("is tentative only for work bookings without a confirmed date", () => {
    expect(isTentative("work", "week_confirmed")).toBe(true);
    expect(isTentative("work", "date_confirmed")).toBe(false);
    expect(isTentative("pressure_wash", "none")).toBe(false);
  });
});
