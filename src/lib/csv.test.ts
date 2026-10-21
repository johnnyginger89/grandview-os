import { describe, expect, it } from "vitest";
import { decodeCsvBytes, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads quoted fields with commas, quotes and line breaks", () => {
    const t = parseCsv('Name,Notes,Phone\r\n"Smith, Jane","Said ""hi""\nthen left",604-555-0100\r\n');
    expect(t.headers).toEqual(["Name", "Notes", "Phone"]);
    expect(t.rows).toEqual([["Smith, Jane", 'Said "hi"\nthen left', "604-555-0100"]]);
  });

  it("strips a BOM, skips blank lines and pads short rows", () => {
    const t = parseCsv("﻿a,b,c\n1,2\n\n,,\n4,5,6");
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([["1", "2", ""], ["4", "5", "6"]]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2").rows).toEqual([["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([["1", "2"]]);
  });

  it("names empty headers", () => {
    expect(parseCsv("a,,c\n1,2,3").headers).toEqual(["a", "Column 2", "c"]);
  });

  it("decodes Windows-1252 when the file isn't UTF-8", () => {
    expect(decodeCsvBytes(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
    expect(decodeCsvBytes(new TextEncoder().encode("Café"))).toBe("Café");
  });
});
