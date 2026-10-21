import { describe, expect, it } from "vitest";
import { DEFAULT_PROPOSAL_TEMPLATE } from "@/db/seed-proposal-template";
import { markRemovedOverrides, mergeWithDefaults } from "./merge";
import { proposalTemplateSchema } from "./schema";

const D = DEFAULT_PROPOSAL_TEMPLATE;

describe("mergeWithDefaults", () => {
  it("the shipped defaults parse", () => {
    expect(proposalTemplateSchema.safeParse(D).success).toBe(true);
    expect(mergeWithDefaults(D, D).invalidSections).toEqual([]);
  });
  it("stored owner edits win and missing keys come from the defaults", () => {
    const { template } = mergeWithDefaults({ version: 1, nav: { about: "Who we are" }, cover: { ctaLabel: "See my quote" } }, D);
    expect(template.nav.about).toBe("Who we are");
    expect(template.nav.whyUs).toBe(D.nav.whyUs);
    expect(template.cover.ctaLabel).toBe("See my quote");
    expect(template.cover.statement).toBe(D.cover.statement);
  });
  it("replaces arrays whole instead of merging by index", () => {
    const tiles = [{ id: "only-one", title: "Only one", text: "Just this", icon: D.whyUs.tiles[0].icon }];
    const { template } = mergeWithDefaults({ whyUs: { tiles } }, D);
    expect(template.whyUs.tiles).toHaveLength(1);
    expect(template.whyUs.tiles[0].title).toBe("Only one");
  });
  it("adds job types that exist only in code, and keeps the owner's own", () => {
    const { template } = mergeWithDefaults({ jobTypes: { interior: { label: "inside", cover: { headline: "Hi {firstName}" } }, popcorn: { label: "popcorn ceiling" } } }, D);
    expect(template.jobTypes.cabinets.label).toBe("cabinet");
    expect(template.jobTypes.popcorn.label).toBe("popcorn ceiling");
    expect(template.jobTypes.interior.label).toBe("inside");
    expect(template.jobTypes.interior.cover?.headline).toBe("Hi {firstName}");
    expect(template.jobTypes.interior.cover?.heroImage?.src).toBe("/proposal/hero-interior.jpg");
  });
  it("a stored null removes an override", () => {
    const { template } = mergeWithDefaults({ jobTypes: { interior: { cover: { headline: null }, warrantyMonths: null } } }, D);
    expect(template.jobTypes.interior.cover?.headline).toBeUndefined();
    expect(template.jobTypes.interior.warrantyMonths).toBeUndefined();
    expect(template.jobTypes.interior.cover?.heroImage).toBeDefined();
  });
  it("an invalid section falls back to its default while other edits are kept", () => {
    const { template, invalidSections } = mergeWithDefaults({ nav: { about: "" }, links: { learnMore: { label: "More", href: "javascript:alert(1)" } }, cover: { ctaLabel: "Open" } }, D);
    expect(invalidSections.sort()).toEqual(["links", "nav"]);
    expect(template.nav).toEqual(D.nav);
    expect(template.links).toEqual(D.links);
    expect(template.cover.ctaLabel).toBe("Open");
  });
  it("garbage input gives the defaults", () => {
    expect(mergeWithDefaults("nonsense", D).template).toEqual(D);
    expect(mergeWithDefaults(null, D).template).toEqual(D);
  });
  it("markRemovedOverrides stores removed fields as null so they stay removed", () => {
    const jt = { ...D.jobTypes, interior: { label: "interior", inherits: "default", scopes: ["interior"], cover: { intro: "x" } } };
    const stored = markRemovedOverrides(jt, D.jobTypes as Record<string, unknown>) as Record<string, Record<string, unknown>>;
    expect((stored.interior.cover as Record<string, unknown>).headline).toBeNull();
    expect(stored.interior.portfolio).toBeNull();
    const { template } = mergeWithDefaults({ jobTypes: stored }, D);
    expect(template.jobTypes.interior.cover?.headline).toBeUndefined();
    expect(template.jobTypes.interior.portfolio).toBeUndefined();
    expect(template.jobTypes.interior.cover?.intro).toBe("x");
  });
});
