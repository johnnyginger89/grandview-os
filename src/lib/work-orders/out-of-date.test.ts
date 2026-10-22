import { describe, expect, it } from "vitest";
import { outOfDateReasons, outOfDateText } from "./out-of-date";

const ISSUED = new Date("2026-10-20T18:00:00Z");
const before = new Date("2026-10-20T17:59:59Z");
const after = new Date("2026-10-21T16:30:00Z");

describe("outOfDateReasons", () => {
  it("flags colours signed or bookings changed after the current version was issued", () => {
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: after, bookingsChangedAt: null }, null)).toEqual(["colours"]);
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: null, bookingsChangedAt: after }, null)).toEqual(["bookings"]);
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: after, bookingsChangedAt: after }, null)).toEqual(["colours", "bookings"]);
  });

  it("doesn't flag changes made before it was issued, or a work order never issued", () => {
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: before, bookingsChangedAt: ISSUED }, null)).toEqual([]);
    expect(outOfDateReasons(null, { coloursSignedAt: after, bookingsChangedAt: after }, null)).toEqual([]);
  });

  it("when a new version is known, only counts changes that would show on it", () => {
    // Another crew's booking moved: this crew's work order wouldn't change.
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: null, bookingsChangedAt: after }, [])).toEqual([]);
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: null, bookingsChangedAt: after }, ["specialInstructions"])).toEqual([]);
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: null, bookingsChangedAt: after }, ["bookings"])).toEqual(["bookings"]);
    // Signed colours can change the colours list, the scope lines or the paint to order.
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: after, bookingsChangedAt: null }, ["scope"])).toEqual(["colours"]);
    expect(outOfDateReasons(ISSUED, { coloursSignedAt: after, bookingsChangedAt: after }, ["colours", "paint"])).toEqual(["colours"]);
  });
});

describe("outOfDateText", () => {
  it("says what happened since the version crews see", () => {
    expect(outOfDateText(["colours"], 2)).toBe("The customer signed colours after version 2 was issued.");
    expect(outOfDateText(["bookings"], 1)).toBe("Bookings changed after version 1 was issued.");
    expect(outOfDateText(["colours", "bookings"], 3)).toBe("The customer signed colours and bookings changed after version 3 was issued.");
  });
});
