import { describe, expect, it } from "vitest";
import { fractionToPercent, percentToFraction, sumOf } from "./money";

describe("fractionToPercent", () => {
  it("shows a stored fraction as a clean percent", () => {
    expect(fractionToPercent("0.55")).toBe("55"); // Number("0.55") * 100 is 55.00000000000001
    expect(fractionToPercent("0.57")).toBe("57");
    expect(fractionToPercent("0.07")).toBe("7");
    expect(fractionToPercent("0.4500")).toBe("45");
    expect(fractionToPercent("0.1425")).toBe("14.25");
    expect(fractionToPercent("1")).toBe("100");
    expect(fractionToPercent("0")).toBe("0");
  });

  it("rounds to hundredths of a percent", () => {
    expect(fractionToPercent("0.142549")).toBe("14.25");
    expect(fractionToPercent("0.142550")).toBe("14.26");
  });
});

describe("percentToFraction", () => {
  it("turns what was typed into the stored fraction without float noise", () => {
    expect(percentToFraction("55")).toBe("0.55");
    expect(percentToFraction("14.3")).toBe("0.143"); // 14.3 / 100 is 0.14300000000000002
    expect(percentToFraction("28.6")).toBe("0.286");
    expect(percentToFraction("14.25")).toBe("0.1425");
    expect(percentToFraction(".5")).toBe("0.005");
  });

  it("rounds to hundredths of a percent", () => {
    expect(percentToFraction("14.255")).toBe("0.1426");
    expect(percentToFraction("14.254")).toBe("0.1425");
    expect(percentToFraction("0.001")).toBe("0");
  });

  it("keeps the value between 0 and the limit", () => {
    expect(percentToFraction("150")).toBe("1");
    expect(percentToFraction("100")).toBe("1");
    expect(percentToFraction("96", 95)).toBe("0.95");
    expect(percentToFraction("94.999", 95)).toBe("0.95");
    expect(percentToFraction("-5")).toBe("0");
    expect(percentToFraction("-0.001")).toBe("0");
  });

  it("treats blank as 0", () => {
    expect(percentToFraction("")).toBe("0");
    expect(percentToFraction(null)).toBe("0");
  });

  it("round-trips with fractionToPercent", () => {
    for (const pct of ["0", "5", "12.5", "14.25", "33.33", "45", "55", "95", "100"]) expect(fractionToPercent(percentToFraction(pct))).toBe(pct);
  });
});

describe("sumOf", () => {
  it("adds amounts exactly", () => {
    expect(sumOf(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
    expect(sumOf(["0.10", "0.20"]).eq("0.3")).toBe(true);
    expect(sumOf(["1234.56", "7890.12", "0.01"]).toFixed(2)).toBe("9124.69");
  });

  it("is 0 for nothing and skips blanks", () => {
    expect(sumOf([]).toFixed(2)).toBe("0.00");
    expect(sumOf(["5.00", null, "", undefined]).toFixed(2)).toBe("5.00");
  });
});
