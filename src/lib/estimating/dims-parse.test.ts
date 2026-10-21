import { describe, expect, it } from "vitest";
import { evalQuantity, parseSize } from "./dims-parse";

describe("parseSize", () => {
  it("reads length, width and height in one box", () => {
    expect(parseSize("15 12 8")).toEqual({ length: "15", width: "12", height: "8" });
    expect(parseSize("15x12x8")).toEqual({ length: "15", width: "12", height: "8" });
    expect(parseSize("15 × 12.5")).toEqual({ length: "15", width: "12.5", height: null });
    expect(parseSize(" 15,12, 9 ")).toEqual({ length: "15", width: "12", height: "9" });
  });

  it("ignores a single number or words", () => {
    expect(parseSize("15")).toBeNull();
    expect(parseSize("15 by 12")).toBeNull();
    expect(parseSize("15 12 8 4")).toBeNull();
  });
});

describe("evalQuantity", () => {
  it("adds up simple measurements", () => {
    expect(evalQuantity("432")).toBe("432");
    expect(evalQuantity("12*8+10*8")).toBe("176");
    expect(evalQuantity("40x18 + 6")).toBe("726");
    expect(evalQuantity("0.1+0.2")).toBe("0.3");
  });

  it("refuses anything that isn't a plain sum", () => {
    expect(evalQuantity("")).toBeNull();
    expect(evalQuantity("12/2")).toBeNull();
    expect(evalQuantity("(1+2)")).toBeNull();
    expect(evalQuantity("-5")).toBeNull();
    expect(evalQuantity("abc")).toBeNull();
  });
});
