import { describe, expect, it } from "vitest";
import { highlightParts, likePattern, parseSearchQuery } from "./query";

describe("parseSearchQuery", () => {
  it("ignores empty and one-letter searches", () => {
    expect(parseSearchQuery("")).toBeNull();
    expect(parseSearchQuery("   ")).toBeNull();
    expect(parseSearchQuery("a")).toBeNull();
    expect(parseSearchQuery("ab")?.tokens).toEqual(["ab"]);
  });

  it("splits words and tidies spaces", () => {
    const q = parseSearchQuery("  jordan   surrey ");
    expect(q?.text).toBe("jordan surrey");
    expect(q?.tokens).toEqual(["jordan", "surrey"]);
    expect(q?.number).toBeNull();
    expect(q?.phoneDigits).toBeNull();
  });

  it("caps the length and the number of words", () => {
    const q = parseSearchQuery("a ".repeat(200));
    expect(q!.text.length).toBeLessThanOrEqual(100);
    expect(q!.tokens.length).toBeLessThanOrEqual(6);
  });

  it("recognises job, estimate and work order numbers", () => {
    expect(parseSearchQuery("#3033")?.number).toEqual({ kind: "job", value: 3033 });
    expect(parseSearchQuery("# 3033")?.number).toEqual({ kind: "job", value: 3033 });
    expect(parseSearchQuery("job 3033")?.number).toEqual({ kind: "job", value: 3033 });
    expect(parseSearchQuery("EST-5001")?.number).toEqual({ kind: "estimate", value: 5001 });
    expect(parseSearchQuery("est5001")?.number).toEqual({ kind: "estimate", value: 5001 });
    expect(parseSearchQuery("WO-7001")?.number).toEqual({ kind: "work_order", value: 7001 });
    expect(parseSearchQuery("wo 7001")?.number).toEqual({ kind: "work_order", value: 7001 });
    expect(parseSearchQuery("3033")?.number).toEqual({ kind: "any", value: 3033 });
    expect(parseSearchQuery("33")?.number).toBeNull();
  });

  it("uses the company's own estimate prefix", () => {
    expect(parseSearchQuery("GV-5001", { estimatePrefix: "GV-" })?.number).toEqual({ kind: "estimate", value: 5001 });
    expect(parseSearchQuery("GV-5001")?.number).toBeNull();
    expect(parseSearchQuery("Q.5001", { estimatePrefix: "Q." })?.number).toEqual({ kind: "estimate", value: 5001 });
  });

  it("keeps the words of a numbered search so street numbers still match", () => {
    expect(parseSearchQuery("#3033")?.tokens).toEqual(["3033"]);
    expect(parseSearchQuery("1234 ex")?.tokens).toEqual(["1234", "ex"]);
  });

  it("reads phone numbers in any format", () => {
    expect(parseSearchQuery("604-555-0142")?.phoneDigits).toBe("6045550142");
    expect(parseSearchQuery("(604) 555 0142")?.phoneDigits).toBe("6045550142");
    expect(parseSearchQuery("+1 604 555 0142")?.phoneDigits).toBe("6045550142");
    expect(parseSearchQuery("0142")?.phoneDigits).toBe("0142");
    expect(parseSearchQuery("555")?.phoneDigits).toBeNull();
    expect(parseSearchQuery("604 Main St")?.phoneDigits).toBeNull();
  });
});

describe("likePattern", () => {
  it("wraps the word and makes wildcards literal", () => {
    expect(likePattern("smith")).toBe("%smith%");
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("back\\slash")).toBe("%back\\\\slash%");
  });
});

describe("highlightParts", () => {
  it("marks every matched word, ignoring case", () => {
    expect(highlightParts("1234 Example Rd, Surrey", ["ex", "surrey"])).toEqual([
      { text: "1234 ", match: false },
      { text: "Ex", match: true },
      { text: "ample Rd, ", match: false },
      { text: "Surrey", match: true },
    ]);
  });

  it("prefers the longer word when words overlap", () => {
    expect(highlightParts("Example", ["ex", "example"])).toEqual([{ text: "Example", match: true }]);
  });

  it("treats regex characters in the search as plain text", () => {
    expect(highlightParts("Unit (B) – 12", ["(b)"])).toEqual([
      { text: "Unit ", match: false },
      { text: "(B)", match: true },
      { text: " – 12", match: false },
    ]);
  });

  it("returns the text unchanged when nothing matches", () => {
    expect(highlightParts("Jordan", ["zz"])).toEqual([{ text: "Jordan", match: false }]);
    expect(highlightParts("", ["a"])).toEqual([]);
  });
});
