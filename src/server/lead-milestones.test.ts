import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { milestoneUpdates } = await import("./lead-milestones");

const now = new Date("2026-10-21T17:00:00.000Z");
const past = new Date("2026-10-20T18:00:00.000Z");
const future = new Date("2026-10-25T18:00:00.000Z");
const blank = { estimateVisitAt: null, visitBookedAt: null, visitCompletedAt: null };

describe("milestoneUpdates", () => {
  it("the first booking sets visitBookedAt", () => {
    expect(milestoneUpdates(blank, { newVisitAt: future }, now)).toEqual({ visitBookedAt: now });
  });

  it("a reschedule keeps the first booking time", () => {
    const booked = { ...blank, estimateVisitAt: future, visitBookedAt: past };
    expect(milestoneUpdates(booked, { newVisitAt: new Date("2026-10-26T18:00:00.000Z") }, now)).toEqual({});
  });

  it("no visit time means no booking milestone", () => {
    expect(milestoneUpdates(blank, { newVisitAt: null }, now)).toEqual({});
    expect(milestoneUpdates(blank, {}, now)).toEqual({});
  });

  it("estimate_completed uses a past visit time, else now", () => {
    expect(milestoneUpdates({ ...blank, estimateVisitAt: past }, { toStageKey: "estimate_completed" }, now)).toEqual({ visitCompletedAt: past });
    expect(milestoneUpdates({ ...blank, estimateVisitAt: future }, { toStageKey: "estimate_completed" }, now)).toEqual({ visitCompletedAt: now });
    expect(milestoneUpdates(blank, { toStageKey: "estimate_completed" }, now)).toEqual({ visitCompletedAt: now });
  });

  it("proposal_sent and won use a past visit time only", () => {
    expect(milestoneUpdates({ ...blank, estimateVisitAt: past }, { toStageKey: "proposal_sent" }, now)).toEqual({ visitCompletedAt: past });
    expect(milestoneUpdates({ ...blank, estimateVisitAt: past }, { toStageKey: "won" }, now)).toEqual({ visitCompletedAt: past });
    expect(milestoneUpdates({ ...blank, estimateVisitAt: future }, { toStageKey: "proposal_sent" }, now)).toEqual({});
    expect(milestoneUpdates(blank, { toStageKey: "won" }, now)).toEqual({});
  });

  it("never overwrites a recorded completion", () => {
    expect(milestoneUpdates({ ...blank, estimateVisitAt: past, visitCompletedAt: past }, { toStageKey: "estimate_completed" }, now)).toEqual({});
  });

  it("follow_up and other stages are ignored", () => {
    for (const k of ["follow_up", "contacted", "new_lead", "estimate_booked", "on_hold", "lost"])
      expect(milestoneUpdates({ ...blank, estimateVisitAt: past }, { toStageKey: k }, now), k).toEqual({});
  });

  it("a booking straight into a post-visit stage sets both", () => {
    expect(milestoneUpdates(blank, { newVisitAt: past, toStageKey: "estimate_completed" }, now)).toEqual({ visitBookedAt: now, visitCompletedAt: past });
  });
});
