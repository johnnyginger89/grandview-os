import { describe, expect, it, vi } from "vitest";
import { clampPage, firstParam, loadPage, PAGE_SIZE, pageHref, parsePage } from "./paging";

describe("parsePage", () => {
  it("reads the page number from the URL", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(" 12 ")).toBe(12);
    expect(parsePage(["2", "5"])).toBe(2);
  });

  it("falls back to page 1 for anything else", () => {
    for (const bad of [undefined, "", "0", "-2", "1.5", "two", "3abc", "1e3", []]) expect(parsePage(bad as string | string[] | undefined), String(bad)).toBe(1);
  });

  it("caps silly page numbers", () => {
    expect(parsePage("999999999")).toBe(10_000);
  });
});

describe("firstParam", () => {
  it("takes the first of a repeated param", () => {
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam("a")).toBe("a");
    expect(firstParam(undefined)).toBe("");
    expect(firstParam([])).toBe("");
  });
});

describe("clampPage", () => {
  it("works out the pages and the offset", () => {
    expect(clampPage(1, 1240)).toEqual({ page: 1, pages: 13, offset: 0 });
    expect(clampPage(2, 1240)).toEqual({ page: 2, pages: 13, offset: 100 });
    expect(clampPage(13, 1240)).toEqual({ page: 13, pages: 13, offset: 1200 });
  });

  it("keeps the page inside the list", () => {
    expect(clampPage(14, 1240)).toEqual({ page: 13, pages: 13, offset: 1200 });
    expect(clampPage(5, 0)).toEqual({ page: 1, pages: 1, offset: 0 });
    expect(clampPage(0, 50)).toEqual({ page: 1, pages: 1, offset: 0 });
    expect(clampPage(2, 100)).toEqual({ page: 1, pages: 1, offset: 0 });
    expect(clampPage(2, 101)).toEqual({ page: 2, pages: 2, offset: 100 });
  });
});

const fakeList = (total: number) => {
  const all = Array.from({ length: total }, (_, i) => i + 1);
  return {
    count: vi.fn(async () => total),
    rows: vi.fn(async (limit: number, offset: number) => all.slice(offset, offset + limit)),
  };
};

describe("loadPage", () => {
  it("fetches one page and says where it sits in the whole list", async () => {
    const list = fakeList(1240);
    const p = await loadPage(2, list.count, list.rows);
    expect(p).toMatchObject({ page: 2, pages: 13, total: 1240, from: 101, to: 200 });
    expect(p.rows).toHaveLength(PAGE_SIZE);
    expect(p.rows[0]).toBe(101);
    expect(list.rows).toHaveBeenCalledTimes(1);
    expect(list.rows).toHaveBeenCalledWith(100, 100);
  });

  it("shows the short last page", async () => {
    const list = fakeList(1240);
    expect(await loadPage(13, list.count, list.rows)).toMatchObject({ page: 13, from: 1201, to: 1240, total: 1240 });
  });

  it("shows the last page for a page past the end", async () => {
    const list = fakeList(205);
    const p = await loadPage(9, list.count, list.rows);
    expect(p).toMatchObject({ page: 3, pages: 3, from: 201, to: 205 });
    expect(list.rows).toHaveBeenLastCalledWith(100, 200);
  });

  it("is empty, on page 1, when nothing matches", async () => {
    const list = fakeList(0);
    expect(await loadPage(1, list.count, list.rows)).toEqual({ rows: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
    expect(await loadPage(4, list.count, list.rows)).toMatchObject({ page: 1, total: 0 });
  });

  it("takes a smaller page size", async () => {
    const list = fakeList(7);
    expect(await loadPage(2, list.count, list.rows, 5)).toMatchObject({ page: 2, pages: 2, from: 6, to: 7, rows: [6, 7] });
  });
});

describe("pageHref", () => {
  it("keeps the search and filters", () => {
    expect(pageHref("/customers", { q: "main st", type: "strata" }, 2)).toBe("/customers?q=main+st&type=strata&page=2");
  });

  it("leaves page 1 and blank filters out of the URL", () => {
    expect(pageHref("/customers", { q: "", type: undefined }, 1)).toBe("/customers");
    expect(pageHref("/estimates", { status: "sent", q: "" }, 1)).toBe("/estimates?status=sent");
  });

  it("encodes what was typed", () => {
    expect(pageHref("/estimates", { q: "50% & more" }, 3)).toBe("/estimates?q=50%25+%26+more&page=3");
  });
});
