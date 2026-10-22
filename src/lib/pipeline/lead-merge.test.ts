import { describe, expect, it } from "vitest";
import { PIPELINE_STAGES } from "@/db/seed-data";
import { appendText, BOOKING_CANCELLED_REASON, cancellationLosesLead, lostToCancellation, planContactMerge, planLeadMerge, type LeadOnFile, type NewLeadDetails } from "./lead-merge";

const onFile = (o: Partial<LeadOnFile> = {}): LeadOnFile => ({ source: null, projectTypes: [], timeline: null, description: null, propertyId: null, ...o });
const incoming = (o: Partial<NewLeadDetails> = {}): NewLeadDetails => ({ source: null, projectTypes: [], timeline: null, description: null, propertyId: null, address: null, ...o });
const HEADING = "From the website form, Oct 22, 2026";

describe("planLeadMerge: fill what's empty, never overwrite", () => {
  it("fills empty source, project types, timeline, address and description", () => {
    const m = planLeadMerge(onFile(), incoming({ source: "Google Search", projectTypes: ["Interior", "interior", "Cabinets"], timeline: "This month", propertyId: "p1", address: "1 Main St, Surrey", description: "Two bedrooms" }), HEADING);
    expect(m.patch).toEqual({ source: "Google Search", projectTypes: ["Interior", "Cabinets"], timeline: "This month", propertyId: "p1", description: "Two bedrooms" });
    expect(m.message).toBe("Two bedrooms");
    expect(m.mentions).toEqual([]);
  });

  it("keeps what's on file and lists what differs for staff to decide", () => {
    const m = planLeadMerge(
      onFile({ source: "Referral", projectTypes: ["Interior"], timeline: "Spring", propertyId: "p1" }),
      incoming({ source: "Google Search", projectTypes: ["interior", "Exterior"], timeline: "ASAP", propertyId: "p2", address: "9 Oak Ave, Langley" }),
      HEADING,
    );
    expect(m.patch).toEqual({});
    expect(m.mentions).toEqual(["Heard about us via: Google Search (on file: Referral)", "Also asked about: Exterior", "Timeline given: ASAP (on file: Spring)", "Address given: 9 Oak Ave, Langley"]);
  });

  it("says nothing when the details match what's on file", () => {
    const m = planLeadMerge(onFile({ source: "referral", projectTypes: ["Interior"], timeline: "Spring", propertyId: "p1", description: "Two bedrooms" }), incoming({ source: "Referral", projectTypes: ["INTERIOR"], timeline: "spring", propertyId: "p1", description: "Two  bedrooms" }), HEADING);
    expect(m).toEqual({ patch: {}, message: null, mentions: [] });
  });

  it("adds a new message under the existing description", () => {
    const m = planLeadMerge(onFile({ description: "Two bedrooms" }), incoming({ description: "Also the hallway, please." }), HEADING);
    expect(m.patch.description).toBe("Two bedrooms\n\nFrom the website form, Oct 22, 2026:\nAlso the hallway, please.");
    expect(m.message).toBe("Also the hallway, please.");
  });
});

describe("appendText", () => {
  it("skips empty additions and text that is already there", () => {
    expect(appendText("Hello", "  ", HEADING)).toBeNull();
    expect(appendText("Repaint the deck.\n\nAnd the fence", "and the   FENCE", HEADING)).toBeNull();
    expect(appendText(null, " New ", HEADING)).toBe("New");
  });
});

describe("planContactMerge: a matched customer's new email or phone", () => {
  const files = (o: { email?: string | null; phone?: string | null; primary?: { email: string | null; phone: string | null } | null; others?: string[] } = {}) => {
    const customer = { email: o.email ?? null, phone: o.phone ?? null };
    const primary = o.primary === undefined ? { email: customer.email, phone: customer.phone } : o.primary;
    return { customer, primary, emails: [customer.email, primary?.email ?? null, ...(o.others ?? [])], phones: [customer.phone, primary?.phone ?? null, ...(o.others ?? [])] };
  };

  it("fills an empty email or phone on the customer and their main contact", () => {
    const m = planContactMerge(files({ phone: "604-555-0100" }), { email: "ann@example.com", phone: "(604) 555-0100" });
    expect(m.customer).toEqual({ email: "ann@example.com" });
    expect(m.primary).toEqual({ email: "ann@example.com" });
    expect(m.mentions).toEqual(["Email added: ann@example.com"]);
  });

  it("never overwrites: a different one is mentioned instead", () => {
    const m = planContactMerge(files({ email: "ann@example.com", phone: "604-555-0100" }), { email: "ann.lee@example.com", phone: "1 778 555 0199" });
    expect(m.customer).toEqual({});
    expect(m.primary).toEqual({});
    expect(m.mentions).toEqual(["New email given: ann.lee@example.com (on file: ann@example.com)", "New phone number given: 1 778 555 0199 (on file: 604-555-0100)"]);
  });

  it("knows the same phone written differently, and details on another contact", () => {
    expect(planContactMerge(files({ email: "ann@example.com", phone: "604-555-0100" }), { email: "ANN@example.com", phone: "+1 604 555 0100" }).mentions).toEqual([]);
    expect(planContactMerge(files({ email: "ann@example.com", others: ["bob@example.com"] }), { email: "bob@example.com", phone: null }).mentions).toEqual([]);
  });

  it("fills the customer when there is no contact, and shows the contact's value first", () => {
    expect(planContactMerge(files({ primary: null }), { email: "ann@example.com", phone: null })).toEqual({ customer: { email: "ann@example.com" }, primary: {}, mentions: ["Email added: ann@example.com"] });
    const m = planContactMerge(files({ email: null, primary: { email: "kim@example.com", phone: null } }), { email: "ann@example.com", phone: null });
    expect(m.customer).toEqual({});
    expect(m.mentions).toEqual(["New email given: ann@example.com (on file: kim@example.com)"]);
  });
});

describe("cancelled bookings", () => {
  const stage = (key: string) => PIPELINE_STAGES.find((s) => s.key === key)!;

  it("lose the lead only before the estimate visit", () => {
    const lost = PIPELINE_STAGES.filter((s) => cancellationLosesLead(s)).map((s) => s.key);
    expect(lost).toEqual(["new_lead", "contacted", "estimate_booked"]);
    for (const key of ["estimate_completed", "proposal_sent", "follow_up", "on_hold", "won", "lost"]) expect(cancellationLosesLead(stage(key)), key).toBe(false);
  });

  it("only a cancellation's Lost counts as reopenable", () => {
    expect(lostToCancellation({ lostReason: BOOKING_CANCELLED_REASON }, stage("lost"))).toBe(true);
    expect(lostToCancellation({ lostReason: "Price" }, stage("lost"))).toBe(false);
    expect(lostToCancellation({ lostReason: BOOKING_CANCELLED_REASON }, stage("contacted"))).toBe(false);
  });
});
