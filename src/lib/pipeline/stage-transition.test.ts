import { describe, expect, it } from "vitest";
import { stageTransitionPatch } from "./stage-transition";

const now = new Date("2026-10-21T17:00:00.000Z");
const earlier = new Date("2026-10-01T17:00:00.000Z");
const opp = { lostReason: "Price", lastContactedAt: earlier };

describe("stageTransitionPatch", () => {
  it("to won sets wonAt and closedAt", () => {
    const p = stageTransitionPatch(opp, { id: "w", key: "won", kind: "won" }, now);
    expect(p).toMatchObject({ stageId: "w", stageChangedAt: now, wonAt: now, closedAt: now, lostReason: null, updatedAt: now });
  });

  it("to an open stage clears wonAt and closedAt", () => {
    const p = stageTransitionPatch(opp, { id: "f", key: "follow_up", kind: "open" }, now);
    expect(p.wonAt).toBeNull();
    expect(p.closedAt).toBeNull();
  });

  it("to lost uses the given reason, else keeps the previous one", () => {
    const lost = { id: "l", key: "lost", kind: "lost" } as const;
    expect(stageTransitionPatch(opp, lost, now, "No response").lostReason).toBe("No response");
    expect(stageTransitionPatch(opp, lost, now).lostReason).toBe("Price");
    expect(stageTransitionPatch(opp, lost, now, null).lostReason).toBe("Price");
    expect(stageTransitionPatch(opp, lost, now).wonAt).toBeNull();
    expect(stageTransitionPatch(opp, lost, now).closedAt).toBe(now);
  });

  it("to a non-lost stage clears the lost reason", () => {
    expect(stageTransitionPatch(opp, { id: "c", key: "contacted", kind: "open" }, now, "ignored").lostReason).toBeNull();
  });

  it("to contacted sets lastContactedAt; other stages keep it", () => {
    expect(stageTransitionPatch(opp, { id: "c", key: "contacted", kind: "open" }, now).lastContactedAt).toBe(now);
    expect(stageTransitionPatch(opp, { id: "b", key: "estimate_booked", kind: "open" }, now).lastContactedAt).toBe(earlier);
    expect(stageTransitionPatch({ lostReason: null, lastContactedAt: null }, { id: "b", key: "estimate_booked", kind: "open" }, now).lastContactedAt).toBeNull();
  });
});
