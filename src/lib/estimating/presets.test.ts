import { describe, expect, it } from "vitest";
import { RATES } from "@/db/seed-data";
import { categoryOrder, DEFAULT_ESTIMATING_PRESETS, estimatingPresetsSchema, presetGroupFor } from "./presets";

describe("starter room presets", () => {
  it("are valid and only use rates the starter data has", () => {
    expect(estimatingPresetsSchema.parse(DEFAULT_ESTIMATING_PRESETS)).toEqual(DEFAULT_ESTIMATING_PRESETS);
    const codes = new Set(RATES.map((r) => r.code));
    for (const room of DEFAULT_ESTIMATING_PRESETS.rooms) for (const s of room.surfaces) expect(codes.has(s.rateCode), `${room.name}: ${s.rateCode}`).toBe(true);
  });

  it("have unique names in each group", () => {
    for (const g of ["inside", "outside", "cabinets"] as const) {
      const names = DEFAULT_ESTIMATING_PRESETS.rooms.filter((r) => r.group === g).map((r) => r.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe("job type order", () => {
  it("puts the job's own rooms and rates first", () => {
    expect(presetGroupFor("exterior")).toBe("outside");
    expect(presetGroupFor("staining")).toBe("outside");
    expect(presetGroupFor("cabinets")).toBe("cabinets");
    expect(presetGroupFor("strata")).toBe("inside");
    expect(categoryOrder("exterior")[0]).toBe("Exterior");
    expect(categoryOrder("interior")).toEqual(["Interior", "Prep", "Repairs"]);
  });
});
