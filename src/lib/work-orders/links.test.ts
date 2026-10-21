import { describe, expect, it } from "vitest";
import { DEFAULT_WORK_ORDER_SETTINGS } from "@/db/seed-data";
import { daysLeft, linkExpiresAt, linkStatus } from "./links";
import { createLinkSchema, defaultWorkOrderSettings, updateWorkOrderSchema, workOrderSettingsSchema } from "./schemas";

const NOW = new Date("2026-10-22T18:00:00Z");
const DAY = 86_400_000;

describe("link expiry", () => {
  it("expires exactly the chosen number of days after creation", () => {
    expect(linkExpiresAt(NOW, 60).toISOString()).toBe("2026-12-21T18:00:00.000Z");
    expect(linkExpiresAt(NOW, 1).getTime() - NOW.getTime()).toBe(DAY);
    expect(linkExpiresAt(NOW, 365).getTime() - NOW.getTime()).toBe(365 * DAY);
  });

  it("refuses fewer than 1, more than 365 or part days", () => {
    for (const bad of [0, -1, 366, 1.5, Number.NaN]) expect(() => linkExpiresAt(NOW, bad), String(bad)).toThrow(RangeError);
  });

  it("is active until the expiry instant, and revoked wins", () => {
    const expiresAt = linkExpiresAt(NOW, 30);
    expect(linkStatus({ expiresAt, revokedAt: null }, NOW)).toBe("active");
    expect(linkStatus({ expiresAt, revokedAt: null }, new Date(expiresAt.getTime() - 1))).toBe("active");
    expect(linkStatus({ expiresAt, revokedAt: null }, expiresAt)).toBe("expired");
    expect(linkStatus({ expiresAt: expiresAt.toISOString(), revokedAt: null }, new Date(expiresAt.getTime() + DAY))).toBe("expired");
    expect(linkStatus({ expiresAt, revokedAt: NOW }, NOW)).toBe("revoked");
    expect(linkStatus({ expiresAt: new Date(0), revokedAt: NOW.toISOString() }, NOW)).toBe("revoked");
  });

  it("counts part days as days left", () => {
    expect(daysLeft(linkExpiresAt(NOW, 60), NOW)).toBe(60);
    expect(daysLeft(new Date(NOW.getTime() + DAY / 2), NOW)).toBe(1);
    expect(daysLeft(NOW, NOW)).toBe(0);
    expect(daysLeft(new Date(NOW.getTime() - DAY), NOW)).toBe(0);
  });
});

describe("work order inputs", () => {
  const fields = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "  Interior repaint ",
    crewId: null,
    specialInstructions: " Start upstairs\r\n- Dog in the yard ",
    equipment: "",
    safetyNotes: null,
    accessNotes: undefined,
    showCustomerPhone: false,
    checklist: [{ id: "c1", text: " Take before photos " }],
  };

  it("trims text, normalises line breaks and turns blanks into null", () => {
    expect(updateWorkOrderSchema.parse(fields)).toMatchObject({
      title: "Interior repaint",
      specialInstructions: "Start upstairs\n- Dog in the yard",
      equipment: null,
      safetyNotes: null,
      accessNotes: null,
      checklist: [{ id: "c1", text: "Take before photos" }],
    });
  });

  it("caps the checklist at 30 unique, non-blank items", () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ id: `c${i}`, text: `Item ${i}` }));
    expect(() => updateWorkOrderSchema.parse({ ...fields, checklist: many })).toThrow(/at most 30/);
    expect(() => updateWorkOrderSchema.parse({ ...fields, checklist: [{ id: "a", text: "x" }, { id: "a", text: "y" }] })).toThrow(/listed twice/);
    expect(() => updateWorkOrderSchema.parse({ ...fields, checklist: [{ id: "a", text: "  " }] })).toThrow(/can't be blank/);
    expect(() => updateWorkOrderSchema.parse({ ...fields, checklist: [{ id: "<script>", text: "x" }] })).toThrow();
  });

  it("limits share links to 1–365 whole days and needs a label", () => {
    const ok = { workOrderId: fields.id, label: " Niko's crew ", days: "60" };
    expect(createLinkSchema.parse(ok)).toEqual({ workOrderId: fields.id, label: "Niko's crew", days: 60 });
    expect(() => createLinkSchema.parse({ ...ok, days: 366 })).toThrow(/at most 365/);
    expect(() => createLinkSchema.parse({ ...ok, days: 0 })).toThrow(/at least 1/);
    expect(() => createLinkSchema.parse({ ...ok, days: 2.5 })).toThrow(/whole number/);
    expect(() => createLinkSchema.parse({ ...ok, label: " " })).toThrow(/who the link is for/);
  });
});

describe("work_orders setting", () => {
  it("defaults to the spec's checklist and 60-day links", () => {
    expect(defaultWorkOrderSettings()).toEqual({
      defaultChecklist: [
        "Walk the job with the crew lead before starting",
        "Protect floors, furniture and landscaping",
        "Take before photos",
        "Confirm colours on site before painting",
        "Clean up daily",
        "Take after photos",
        "Final walk-through with the customer",
      ],
      defaultLinkDays: 60,
    });
    // A fresh copy each time, so editing one result can't change the defaults.
    expect(defaultWorkOrderSettings().defaultChecklist).not.toBe(DEFAULT_WORK_ORDER_SETTINGS.defaultChecklist);
  });

  it("keeps saved values and validates them", () => {
    expect(workOrderSettingsSchema.parse({ defaultChecklist: [" A "], defaultLinkDays: 30 })).toEqual({ defaultChecklist: ["A"], defaultLinkDays: 30 });
    expect(workOrderSettingsSchema.parse({ defaultLinkDays: 90 }).defaultChecklist).toHaveLength(7);
    expect(() => workOrderSettingsSchema.parse({ defaultLinkDays: 400 })).toThrow();
    expect(() => workOrderSettingsSchema.parse({ defaultChecklist: Array(31).fill("x") })).toThrow();
  });
});
