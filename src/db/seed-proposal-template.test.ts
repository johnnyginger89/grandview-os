import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { proposalTemplateSchema, SECTION_KEYS, tokenProblems } from "@/lib/proposal-template/schema";
import { DEFAULT_PROPOSAL_TEMPLATE } from "./seed-proposal-template";

const json = JSON.stringify(DEFAULT_PROPOSAL_TEMPLATE);

describe("DEFAULT_PROPOSAL_TEMPLATE", () => {
  it("parses", () => {
    const r = proposalTemplateSchema.safeParse(DEFAULT_PROPOSAL_TEMPLATE);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3))).toBe(true);
  });
  it("every shipped image exists in public/", () => {
    const srcs = [...json.matchAll(/"src":"(\/(?:proposal|brand)\/[^"]+)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(20);
    for (const s of new Set(srcs)) expect(existsSync(path.join(process.cwd(), "public", s)), s).toBe(true);
  });
  it("contains no Markate, CompanyCam or blob-storage references", () => {
    expect(json.toLowerCase()).not.toMatch(/markate|companycam|blob\.core\.windows\.net/);
  });
  it("uses only placeholders allowed in each field", () => {
    for (const k of SECTION_KEYS) expect(tokenProblems(DEFAULT_PROPOSAL_TEMPLATE[k], k), k).toEqual([]);
  });
  it("the reviews link carries no tracking parameters", () => {
    const u = new URL(DEFAULT_PROPOSAL_TEMPLATE.links.reviews.href);
    for (const p of ["oq", "aqs", "rlz", "gs_ssp", "sourceid", "ie"]) expect(u.searchParams.has(p), p).toBe(false);
    expect(u.searchParams.get("q")).toBe("grandview painting");
  });
});
