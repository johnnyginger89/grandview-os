import { describe, expect, it } from "vitest";
import { jobsHref, sectionFor, tabsFor, type SectionTabs } from "./nav";

describe("sectionFor", () => {
  it("puts leads, estimates and sold jobs under Jobs", () => {
    expect(sectionFor("/leads")).toBe("jobs");
    expect(sectionFor("/leads/new")).toBe("jobs");
    expect(sectionFor("/estimates/1f0c")).toBe("jobs");
    expect(sectionFor("/projects/abc")).toBe("jobs");
  });

  it("knows the other sections", () => {
    expect(sectionFor("/")).toBe("home");
    expect(sectionFor("/performance")).toBe("home");
    expect(sectionFor("/schedule/setup")).toBe("schedule");
    expect(sectionFor("/customers/new")).toBe("customers");
    expect(sectionFor("/rates")).toBe("rates");
    expect(sectionFor("/my-jobs/work-orders/x")).toBe("my-jobs");
    expect(sectionFor("/settings/proposals")).toBe("settings");
    expect(sectionFor("/account/security")).toBe("settings");
  });

  it("doesn't match look-alike paths", () => {
    expect(sectionFor("/leadsx")).toBeNull();
    expect(sectionFor("/search")).toBeNull();
  });
});

const SECTIONS: SectionTabs[] = [
  { key: "home", tabs: [{ href: "/", label: "Today" }, { href: "/performance", label: "Performance" }] },
  { key: "jobs", tabs: [{ href: "/leads", label: "Leads" }, { href: "/estimates", label: "Estimates" }, { href: "/projects", label: "Sold jobs" }] },
];

describe("tabsFor", () => {
  it("shows the tabs on a section's main pages only", () => {
    expect(tabsFor("/estimates", SECTIONS)?.active).toBe("/estimates");
    expect(tabsFor("/estimates", SECTIONS)?.key).toBe("jobs");
    expect(tabsFor("/", SECTIONS)?.key).toBe("home");
    expect(tabsFor("/estimates/123", SECTIONS)).toBeNull();
    expect(tabsFor("/customers", SECTIONS)).toBeNull();
  });

  it("hides a strip with a single tab", () => {
    expect(tabsFor("/leads", [{ key: "jobs", tabs: [{ href: "/leads", label: "Leads" }] }])).toBeNull();
  });
});

describe("jobsHref", () => {
  const tabs = SECTIONS[1].tabs;
  it("returns to the tab used last", () => {
    expect(jobsHref("/projects", tabs, "/leads")).toBe("/projects");
  });
  it("ignores a saved tab this person can't open, or junk", () => {
    expect(jobsHref("/projects", tabs.slice(0, 2), "/leads")).toBe("/leads");
    expect(jobsHref("javascript:alert(1)", tabs, "/leads")).toBe("/leads");
    expect(jobsHref(null, tabs, "/leads")).toBe("/leads");
  });
});
