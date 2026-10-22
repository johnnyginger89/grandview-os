import { describe, expect, it } from "vitest";
import { DEFAULT_PRICING } from "@/db/seed-data";
import { safeErrorMessage } from "@/lib/action-error";
import { percentToFraction } from "@/lib/money";
import { SAMPLE_DOC } from "@/lib/proposal-template/sample";
import { docLineSchema, docSettingsSchema, estimateDocSchema } from "./document";

type Settings = Record<string, string | null | undefined>;

/** What loadEstimate hands the editor: Postgres numeric text, percents as numeric(6,4), money as numeric(14,2). */
const STORED: Settings = {
  pricingMethod: "billing_rate",
  laborCostPerHour: "45.00",
  billingRatePerHour: "80.00",
  targetMargin: "0.4500",
  materialMarkupPct: "0.2000",
  minimumJobPrice: "2000.00",
  gstRate: "0.0500",
  depositPct: "0.2000",
  discount: null,
  priceOverride: null,
};

const problem = (patch: Record<string, unknown>) => {
  const r = docSettingsSchema.safeParse({ ...STORED, ...patch });
  return r.success ? null : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
};

describe("estimate settings: existing documents still parse", () => {
  it("accepts what the database stores and the starter pricing", () => {
    expect(problem({})).toBeNull();
    // New estimates copy these (plus two settings the document doesn't carry).
    expect(problem(DEFAULT_PRICING)).toBeNull();
  });

  it("accepts the sample proposal and the shapes used in other tests", () => {
    expect(estimateDocSchema.safeParse(SAMPLE_DOC).success).toBe(true);
    expect(problem({ pricingMethod: "target_margin", laborCostPerHour: "987.65", billingRatePerHour: "123.45", targetMargin: "0.45", materialMarkupPct: "0.2", minimumJobPrice: "0", gstRate: "0.05", depositPct: "0.2", discount: "0", priceOverride: "6543.21" })).toBeNull();
    expect(problem({ laborCostPerHour: "45", billingRatePerHour: "75", discount: "9.75", priceOverride: undefined })).toBeNull();
    expect(problem({ discount: undefined, priceOverride: undefined })).toBeNull();
  });

  it("accepts the edges and trailing zeros", () => {
    expect(problem({ targetMargin: "0", materialMarkupPct: "1", gstRate: "1.0000", depositPct: "0.12340" })).toBeNull();
    expect(problem({ laborCostPerHour: "0", minimumJobPrice: "999999999999.99", discount: "12.500" })).toBeNull();
  });

  it("accepts every percent the Price tab can send", () => {
    for (const typed of ["0", "0.01", "5", "14.255", "33.333", "95", "100", "150", "-3"]) {
      const fraction = percentToFraction(typed);
      expect(problem({ materialMarkupPct: fraction, depositPct: fraction }), typed).toBeNull();
    }
  });
});

describe("estimate settings: percents", () => {
  it("must be between 0% and 100%", () => {
    expect(problem({ depositPct: "1.5" })).toBe("depositPct: Deposit must be between 0% and 100%");
    expect(problem({ materialMarkupPct: "1.0001" })).toBe("materialMarkupPct: Paint markup must be between 0% and 100%");
    expect(problem({ targetMargin: "-0.1" })).toBe("targetMargin: Target margin must be between 0% and 100%");
    expect(problem({ gstRate: "5" })).toBe("gstRate: GST must be between 0% and 100%");
  });

  it("are kept to hundredths of a percent", () => {
    expect(problem({ materialMarkupPct: "0.14300000000000002" })).toBe("materialMarkupPct: Paint markup can have at most 2 decimal places");
    expect(problem({ depositPct: "0.12345" })).toBe("depositPct: Deposit can have at most 2 decimal places");
  });

  it("must be numbers", () => {
    for (const bad of ["", "-", "abc", "1e-2", "0.2%", "NaN"]) expect(problem({ targetMargin: bad }), bad).toBe("targetMargin: Target margin must be a number");
  });
});

describe("estimate settings: money", () => {
  it("is never negative", () => {
    expect(problem({ laborCostPerHour: "-1" })).toBe("laborCostPerHour: Labour cost can't be negative");
    expect(problem({ discount: "-50" })).toBe("discount: Discount can't be negative");
  });

  it("is dollars and cents", () => {
    expect(problem({ billingRatePerHour: "80.555" })).toBe("billingRatePerHour: Billing rate can have at most 2 decimal places");
    expect(problem({ priceOverride: "3000.001" })).toBe("priceOverride: Final price can have at most 2 decimal places");
  });

  it("fits the column", () => {
    expect(problem({ minimumJobPrice: "1000000000000" })).toBe("minimumJobPrice: Minimum job price is too large");
  });

  it("must be numbers; discount and final price may be left blank", () => {
    expect(problem({ minimumJobPrice: "" })).toBe("minimumJobPrice: Minimum job price must be a number");
    expect(problem({ laborCostPerHour: "$45" })).toBe("laborCostPerHour: Labour cost must be a number");
    expect(problem({ discount: "ten" })).toBe("discount: Discount must be a number");
    const blank = docSettingsSchema.parse({ ...STORED, discount: "", priceOverride: undefined });
    expect(blank.discount).toBeNull();
    expect(blank.priceOverride).toBeNull();
  });

  it("reads clearly where the editor shows a failed save", () => {
    const r = estimateDocSchema.safeParse({ ...SAMPLE_DOC, settings: { ...SAMPLE_DOC.settings, depositPct: "2" } });
    expect(r.success).toBe(false);
    expect(safeErrorMessage(r.error)).toBe("settings.depositPct: Deposit must be between 0% and 100%");
  });
});

describe("quantities and factors keep their looser rule", () => {
  it("still accept more decimals than money", () => {
    const line = { ...SAMPLE_DOC.lines[0], quantity: "123.4567", prepFactor: "1.125", overrideHours: "2.3333" };
    expect(docLineSchema.safeParse(line).success).toBe(true);
  });
});
