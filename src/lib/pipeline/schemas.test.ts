import { describe, expect, it } from "vitest";
import { assignEstimatorInput, bulkMoveStageInput, followUpInput, idsSchema, lostReasonSchema } from "./schemas";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("idsSchema", () => {
  it("dedupes", () => {
    expect(idsSchema.parse([id(1), id(1), id(2)])).toEqual([id(1), id(2)]);
  });

  it("rejects 201 ids, an empty list and non-UUIDs", () => {
    expect(idsSchema.safeParse(Array.from({ length: 200 }, (_, i) => id(i))).success).toBe(true);
    expect(idsSchema.safeParse(Array.from({ length: 201 }, (_, i) => id(i))).success).toBe(false);
    expect(idsSchema.safeParse([]).success).toBe(false);
    expect(idsSchema.safeParse(["1; drop table opportunities"]).success).toBe(false);
  });
});

describe("action inputs", () => {
  it("are strict about extra keys", () => {
    expect(bulkMoveStageInput.safeParse({ ids: [id(1)], stageId: id(2), role: "owner" }).success).toBe(false);
    expect(followUpInput.safeParse({ ids: [id(1)], date: null, at: "x" }).success).toBe(false);
    expect(assignEstimatorInput.safeParse({ ids: [id(1)], estimatorId: null, extra: 1 }).success).toBe(false);
  });

  it("bulk move needs a UUID stage and a bounded reason", () => {
    expect(bulkMoveStageInput.parse({ ids: [id(1)], stageId: id(2), lostReason: "  Price " }).lostReason).toBe("Price");
    expect(bulkMoveStageInput.safeParse({ ids: [id(1)], stageId: "won" }).success).toBe(false);
    expect(bulkMoveStageInput.safeParse({ ids: [id(1)], stageId: id(2), lostReason: "x".repeat(201) }).success).toBe(false);
    expect(bulkMoveStageInput.safeParse({ ids: [id(1)], stageId: id(2), lostReason: "  " }).success).toBe(false);
  });

  it("follow-up dates must be real calendar days in range", () => {
    expect(followUpInput.parse({ ids: [id(1)], date: "2026-10-24" }).date).toBe("2026-10-24");
    expect(followUpInput.parse({ ids: [id(1)], date: null }).date).toBeNull();
    for (const bad of ["2026-02-30", "1999-12-31", "2101-01-01", "2026-10-24T09:00", "tomorrow"])
      expect(followUpInput.safeParse({ ids: [id(1)], date: bad }).success, bad).toBe(false);
  });

  it("estimator id may be null; a 65-character id is rejected", () => {
    expect(assignEstimatorInput.parse({ ids: [id(1)], estimatorId: null }).estimatorId).toBeNull();
    expect(assignEstimatorInput.parse({ ids: [id(1)], estimatorId: "abc123" }).estimatorId).toBe("abc123");
    expect(assignEstimatorInput.safeParse({ ids: [id(1)], estimatorId: "x".repeat(65) }).success).toBe(false);
    expect(assignEstimatorInput.safeParse({ ids: [id(1)], estimatorId: "" }).success).toBe(false);
  });

  it("single-move lost reasons are trimmed and bounded", () => {
    expect(lostReasonSchema.parse(" Price ")).toBe("Price");
    expect(lostReasonSchema.parse("")).toBeUndefined();
    expect(lostReasonSchema.parse(undefined)).toBeUndefined();
    expect(lostReasonSchema.safeParse("x".repeat(201)).success).toBe(false);
    expect(lostReasonSchema.safeParse(42).success).toBe(false);
  });
});
