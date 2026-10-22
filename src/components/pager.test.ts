import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PageInfo } from "@/lib/paging";

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { href: string; children: ReactNode }) => createElement("a", rest, children),
}));

const { Pager } = await import("./pager");

const render = (info: PageInfo, params: Record<string, string | undefined> = {}) =>
  renderToStaticMarkup(createElement(Pager, { info, path: "/customers", params }));
const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*([A-Za-z]+)/g)].map((m) => `${m[2]} ${m[1].replace(/&amp;/g, "&")}`);

describe("Pager", () => {
  it("says which rows are shown, out of how many", () => {
    const html = render({ page: 1, pages: 13, total: 1240, from: 1, to: 100 });
    expect(html).toContain("Showing 1–100 of 1,240");
    expect(html).toContain('aria-label="Pages"');
  });

  it("links to the next page with the search and filters kept", () => {
    const html = render({ page: 1, pages: 13, total: 1240, from: 1, to: 100 }, { q: "main st", type: "strata" });
    expect(links(html)).toEqual(["Next /customers?q=main+st&type=strata&page=2"]);
    expect(html).toMatch(/<span aria-disabled="true"[^>]*>.*Previous<\/span>/);
  });

  it("goes back to the plain URL for page 1", () => {
    const html = render({ page: 2, pages: 13, total: 1240, from: 101, to: 200 }, { q: "main st" });
    expect(links(html)).toEqual(["Previous /customers?q=main+st", "Next /customers?q=main+st&page=3"]);
  });

  it("has no Next on the last page", () => {
    const html = render({ page: 13, pages: 13, total: 1240, from: 1201, to: 1240 });
    expect(html).toContain("Showing 1,201–1,240 of 1,240");
    expect(links(html)).toEqual(["Previous /customers?page=12"]);
    expect(html).toMatch(/<span aria-disabled="true"[^>]*>Next/);
  });

  it("shows only the count when everything fits on one page", () => {
    const html = render({ page: 1, pages: 1, total: 37, from: 1, to: 37 });
    expect(html).toContain("Showing 1–37 of 37");
    expect(html).not.toContain("Previous");
    expect(html).not.toContain("Next");
    expect(render({ page: 1, pages: 1, total: 1, from: 1, to: 1 })).toContain("Showing 1 of 1");
  });

  it("shows nothing for an empty list", () => {
    expect(render({ page: 1, pages: 1, total: 0, from: 0, to: 0 })).toBe("");
  });
});
