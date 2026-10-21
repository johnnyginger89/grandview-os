import { describe, expect, it } from "vitest";
import { parseProse, splitLines } from "./prose";

describe("parseProse", () => {
  it("splits paragraphs on blank lines", () => {
    expect(parseProse("One\n\nTwo")).toEqual([{ type: "p", text: "One" }, { type: "p", text: "Two" }]);
  });
  it("keeps single line breaks inside a paragraph", () => {
    expect(parseProse("Line a\nLine b")).toEqual([{ type: "p", text: "Line a\nLine b" }]);
  });
  it("reads '- ' and '• ' as bullets", () => {
    expect(parseProse("- a\n• b")).toEqual([{ type: "ul", items: ["a", "b"] }]);
  });
  it("mixes paragraphs and lists", () => {
    expect(parseProse("Lead in:\n- one\n- two\nAfter")).toEqual([
      { type: "p", text: "Lead in:" },
      { type: "ul", items: ["one", "two"] },
      { type: "p", text: "After" },
    ]);
  });
  it("handles CRLF and trailing spaces", () => {
    expect(parseProse("A  \r\n\r\n- b  \r\n")).toEqual([{ type: "p", text: "A" }, { type: "ul", items: ["b"] }]);
  });
  it("returns nothing for empty input and keeps HTML as text", () => {
    expect(parseProse("")).toEqual([]);
    expect(parseProse(null)).toEqual([]);
    expect(parseProse("<b>x</b>")).toEqual([{ type: "p", text: "<b>x</b>" }]);
  });
  it("splitLines drops bullets and blanks", () => {
    expect(splitLines("- Garage\n\nShed\r\n• Fence")).toEqual(["Garage", "Shed", "Fence"]);
  });
});
