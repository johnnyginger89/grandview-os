import { describe, expect, it } from "vitest";
import { allowedKinds, kindRefusal, planAutoStatus } from "./status-plan";

describe("planAutoStatus", () => {
  it("schedules a job when its first work booking appears and unschedules it when the last goes", () => {
    expect(planAutoStatus("need_to_schedule", 1, { confirmOnHold: false })).toBe("scheduled");
    expect(planAutoStatus("scheduled", 0, { confirmOnHold: false })).toBe("need_to_schedule");
    expect(planAutoStatus("scheduled", 2, { confirmOnHold: false })).toBeNull();
  });

  it("leaves later statuses alone", () => {
    expect(planAutoStatus("in_progress", 0, { confirmOnHold: false })).toBeNull();
    expect(planAutoStatus("complete", 0, { confirmOnHold: true })).toBeNull();
    expect(planAutoStatus("need_to_schedule", 0, { confirmOnHold: false })).toBeNull();
  });

  it("moves an on-hold job only when the user confirmed", () => {
    expect(planAutoStatus("on_hold", 1, { confirmOnHold: false })).toBeNull();
    expect(planAutoStatus("on_hold", 1, { confirmOnHold: true })).toBe("scheduled");
  });
});

describe("allowedKinds", () => {
  it("limits finished and cancelled jobs", () => {
    expect(allowedKinds("complete")).toEqual(["touch_up", "walk_through"]);
    expect(allowedKinds("invoiced")).toEqual(["touch_up", "walk_through"]);
    expect(allowedKinds("cancelled")).toEqual([]);
    expect(allowedKinds("closed")).toEqual([]);
    expect(allowedKinds("need_to_schedule")).toContain("work");
    expect(kindRefusal("complete", "work")).toMatch(/touch-up/);
    expect(kindRefusal("cancelled", "touch_up")).toBe("This job is cancelled.");
    expect(kindRefusal("scheduled", "work")).toBeNull();
  });
});
