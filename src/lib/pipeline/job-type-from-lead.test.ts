import { describe, expect, it } from "vitest";
import { PROJECT_TYPES } from "@/db/seed-data";
import { jobTypeForProjectTypes } from "./job-type-from-lead";

describe("jobTypeForProjectTypes", () => {
  it("maps each starter project type", () => {
    const mapped = Object.fromEntries(PROJECT_TYPES.map((t) => [t, jobTypeForProjectTypes([t])]));
    expect(mapped).toEqual({
      Interior: "interior",
      Exterior: "exterior",
      Cabinets: "cabinets",
      "Deck / Fence Staining": "staining",
      // Usually part of an exterior job; on its own the estimator decides.
      "Pressure Washing": null,
      "Carpentry / Repairs": "repairs",
      "Drywall / Popcorn Removal": "repairs",
      Commercial: "commercial",
      Strata: "strata",
    });
  });

  it("covers inside and out together, and the main scope wins over smaller extras", () => {
    expect(jobTypeForProjectTypes(["Exterior", "Interior"])).toBe("interior_exterior");
    expect(jobTypeForProjectTypes(["Interior", "Cabinets"])).toBe("interior");
    expect(jobTypeForProjectTypes(["Pressure Washing", "Exterior", "Deck / Fence Staining"])).toBe("exterior");
    expect(jobTypeForProjectTypes(["Strata", "Exterior"])).toBe("strata");
    expect(jobTypeForProjectTypes(["Interior", "Commercial"])).toBe("commercial");
  });

  it("follows renamed types by keyword and leaves unknown ones to the estimator", () => {
    expect(jobTypeForProjectTypes(["kitchen cabinets"])).toBe("cabinets");
    expect(jobTypeForProjectTypes(["Fence"])).toBe("staining");
    expect(jobTypeForProjectTypes(["Wallpaper"])).toBeNull();
    expect(jobTypeForProjectTypes([])).toBeNull();
  });
});
