import { describe, expect, it } from "vitest";
import { sectionFor, tabsFor, type SectionTabs } from "./nav";

describe("sectionFor", () => {
  it("gives leads, estimates and sold jobs their own sections", () => {
    expect(sectionFor("/leads")).toBe("leads");
    expect(sectionFor("/leads/new")).toBe("leads");
    expect(sectionFor("/estimates/1f0c")).toBe("estimates");
    expect(sectionFor("/projects")).toBe("jobs");
    expect(sectionFor("/projects/abc")).toBe("jobs");
    expect(sectionFor("/work-orders")).toBe("work-orders");
  });

  it("knows the other sections, with Rates under Settings", () => {
    expect(sectionFor("/")).toBe("home");
    expect(sectionFor("/performance")).toBe("home");
    expect(sectionFor("/schedule/setup")).toBe("schedule");
    expect(sectionFor("/customers/new")).toBe("customers");
    expect(sectionFor("/rates")).toBe("settings");
    expect(sectionFor("/my-jobs/work-orders/x")).toBe("my-jobs");
    expect(sectionFor("/settings/proposals")).toBe("settings");
    expect(sectionFor("/account/security")).toBe("settings");
  });

  it("doesn't match look-alike paths", () => {
    expect(sectionFor("/leadsx")).toBeNull();
    expect(sectionFor("/search")).toBeNull();
  });
});

const SECTIONS: SectionTabs[] = [{ key: "home", tabs: [{ href: "/", label: "Today" }, { href: "/performance", label: "Performance" }] }];

describe("tabsFor", () => {
  it("shows the tabs on a section's main pages only", () => {
    expect(tabsFor("/performance", SECTIONS)?.active).toBe("/performance");
    expect(tabsFor("/", SECTIONS)?.key).toBe("home");
    expect(tabsFor("/customers", SECTIONS)).toBeNull();
  });

  it("hides a strip with a single tab", () => {
    expect(tabsFor("/", [{ key: "home", tabs: [{ href: "/", label: "Today" }] }])).toBeNull();
  });
});
