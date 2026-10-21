import { describe, expect, it } from "vitest";
import { DEFAULT_PROPOSAL_TEMPLATE } from "@/db/seed-proposal-template";
import { mergeWithDefaults } from "./merge";
import { appliesToScopes, clauseText, resolveJobType, scopeFromCategory } from "./resolve";

const D = DEFAULT_PROPOSAL_TEMPLATE;

describe("resolveJobType", () => {
  it("interior and exterior differ in headline, hero and portfolio", () => {
    const i = resolveJobType(D, "interior");
    const e = resolveJobType(D, "exterior");
    expect(i.cover.headline).toContain("it's what's inside that counts");
    expect(e.cover.headline).toBe("BRING BACK YOUR HOME'S CURB APPEAL");
    expect(i.cover.heroImage.src).toBe("/proposal/hero-interior.jpg");
    expect(e.cover.heroImage.src).toBe("/proposal/hero-exterior.jpg");
    expect(i.portfolio[0].src).toContain("portfolio-interior");
    expect(e.portfolio[0].src).toContain("portfolio-exterior");
    expect(i.warrantyMonths).toBe(24);
    expect(e.warrantyMonths).toBe(36);
  });
  it("cabinets inherit interior field by field; their own hero wins", () => {
    const hero = { src: "/proposal/portfolio-interior-03.jpg", alt: "Cabinets", focalX: 50, focalY: 50 };
    const { template } = mergeWithDefaults({ jobTypes: { cabinets: { cover: { heroImage: hero } } } }, D);
    const r = resolveJobType(template, "cabinets");
    expect(r.cover.heroImage.src).toBe(hero.src);
    expect(r.cover.headline).toBe(D.jobTypes.interior.cover!.headline);
    expect(r.label).toBe("cabinet");
    expect(r.chain).toEqual(["cabinets", "interior", "default"]);
    expect(r.source["cover.heroImage"]).toBe("cabinets");
    expect(r.source["cover.headline"]).toBe("interior");
    expect(r.source["servicesInclude"]).toBe("default");
  });
  it("unknown or empty job types use the default", () => {
    for (const k of ["", "nope", "default"]) {
      const r = resolveJobType(D, k);
      expect(r.chain).toEqual(["default"]);
      expect(r.label).toBe("painting");
      expect(r.preparation).toEqual([]);
    }
  });
  it("interior & exterior gives two preparation lines, exterior first", () => {
    const r = resolveJobType(D, "interior_exterior");
    expect(r.preparation.map((p) => p.title)).toEqual(["Exterior Preparation", "Interior Preparation"]);
    expect(r.scopes).toEqual(["interior", "exterior"]);
  });
  it("line scopes add exterior to an interior job", () => {
    const r = resolveJobType(D, "interior", ["exterior"]);
    expect(r.scopes).toEqual(["interior", "exterior"]);
    const clauses = D.contract.clauses.filter((c) => appliesToScopes(c.appliesTo, r.scopes)).map((c) => c.id);
    expect(clauses).toContain("neighbour-access");
    expect(clauses).toContain("interior-cleanup");
  });
  it("uses the exterior wording when exterior is in scope", () => {
    const clause = D.contract.clauses.find((c) => c.id === "clear-contents")!;
    expect(clauseText(clause, ["interior"])).toBe(clause.text);
    expect(clauseText(clause, ["exterior"])).toBe(clause.textExterior);
  });
  it("maps rate categories to scopes", () => {
    expect(scopeFromCategory("Interior")).toBe("interior");
    expect(scopeFromCategory("Cabinets")).toBe("interior");
    expect(scopeFromCategory("Staining")).toBe("exterior");
    expect(scopeFromCategory("Prep")).toBeNull();
    expect(scopeFromCategory(undefined)).toBeNull();
  });
});
