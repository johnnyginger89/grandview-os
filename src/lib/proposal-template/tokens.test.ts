import { describe, expect, it } from "vitest";
import { tokenProblems } from "./schema";
import { cleanupHeadline, fillTokens, statementSegments } from "./tokens";

describe("tokens", () => {
  it("fills {firstName}", () => {
    expect(cleanupHeadline("{firstName}, it's what's inside that counts", "Sam")).toBe("Sam, it's what's inside that counts");
  });
  it("drops a leading {firstName}, and capitalises when there is no first name", () => {
    expect(cleanupHeadline("{firstName}, it's what's inside that counts", null)).toBe("It's what's inside that counts");
    expect(cleanupHeadline("BRING BACK YOUR HOME'S CURB APPEAL", null)).toBe("BRING BACK YOUR HOME'S CURB APPEAL");
    expect(cleanupHeadline("Thanks {firstName}!", "")).toBe("Thanks!");
  });
  it("leaves unknown tokens in place and fills known ones", () => {
    expect(fillTokens("A {depositPct}% deposit, {nope}", { depositPct: "20" })).toBe("A 20% deposit, {nope}");
  });
  it("reports unknown and misplaced tokens when saving", () => {
    expect(tokenProblems({ default: { cover: { headline: "{firstname}, hi" } } }, "jobTypes")[0]).toBe("{firstname} isn't a placeholder we know. Did you mean {firstName}?");
    expect(tokenProblems({ intro: "{firstName}" }, "about")[0]).toBe("{firstName} can't be used in this field.");
    expect(tokenProblems({ defaultMessage: "{depositPct}% and {companyName}" }, "estimateDocument")).toEqual([]);
    expect(tokenProblems({ clauses: [{ text: "{colourConsultFee}" }] }, "contract")).toEqual([]);
  });
  it("splits a statement into dark and teal segments", () => {
    expect(statementSegments("A *B* C")).toEqual([
      { text: "A ", tone: "dark" },
      { text: "B", tone: "teal" },
      { text: " C", tone: "dark" },
    ]);
    expect(statementSegments("No *highlight")).toEqual([{ text: "No *highlight", tone: "dark" }]);
  });
  it("never produces markup: text stays text", () => {
    const segs = statementSegments("<script>alert(1)</script> *<b>x</b>*");
    expect(segs.map((s) => s.text).join("")).toBe("<script>alert(1)</script> <b>x</b>");
    expect(fillTokens("{companyName}", { companyName: "<img src=x>" })).toBe("<img src=x>");
  });
});
