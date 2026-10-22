/**
 * The Markate customer import on a real database (`pnpm test:db`), through the service
 * calls Settings → Import makes: upload (preview), import, and Undo.
 */
import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { contacts, customers, importBatches, properties } from "@/db/schema";
import { createTestUser, uniqueTag } from "@/test/db/fixtures";
import { createCustomer } from "./customers";
import { createEstimate } from "./estimates";
import { createImportBatch, importResults, previewImport, rollbackImport, runImport } from "./imports";

let ownerId: string;

beforeAll(async () => {
  ownerId = (await createTestUser("owner", "Import owner")).id;
});

const HEADER = "Customer ID,Display Name,First Name,Last Name,Email,Phone,Street,City,Province,Postal Code,Lead Source,Notes,Created Date";

/** Upload a CSV as the Import page does and return the batch id. */
async function upload(tag: string, rows: string[]) {
  const csv = [HEADER, ...rows].join("\n");
  return createImportBatch({ name: `markate-${tag}.csv`, bytes: new TextEncoder().encode(csv) }, "markate", ownerId);
}

/** Fictional 555-01xx numbers with a per-run extension, so other tests' customers won't match them by phone. */
const phone = (line: string, tag: string) => `604-555-${line} x${parseInt(tag, 16) % 9000 + 1000}`;

/** Every customer, contact and address id: Undo must bring these back exactly. */
async function everything() {
  const ids = async (t: typeof customers | typeof contacts | typeof properties) => (await db.select({ id: t.id }).from(t)).map((r) => r.id).sort();
  return { customers: await ids(customers), contacts: await ids(contacts), properties: await ids(properties) };
}

const customerById = (id: string) => db.query.customers.findFirst({ where: eq(customers.id, id) });
/** A customer's details; Undo restores these, while updatedAt keeps the time of the last change. */
const detailsOf = async (id: string) => ({ ...(await customerById(id))!, updatedAt: undefined });
const streetsOf = async (customerId: string) => (await db.select({ street: properties.street }).from(properties).where(eq(properties.customerId, customerId))).map((p) => p.street).sort();
const contactCount = async (customerId: string) => (await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.customerId, customerId))).length;

describe("importing a Markate customer export", () => {
  it("creates new customers, adds to the ones already here instead of duplicating them, and Undo removes exactly what it added", async () => {
    const tag = uniqueTag();
    // Already in Grandview: one customer the file matches by email, one by phone.
    const byEmail = await createCustomer(
      { displayName: `[TEST DATA] Existing Email ${tag}`, email: `existing-${tag}@example.com`, notes: "[TEST DATA] Prefers mornings" },
      { firstName: "Erin", lastName: "Existing", email: `existing-${tag}@example.com` },
      { street: "5 Known Road", city: "Surrey" },
      ownerId,
    );
    const byPhone = await createCustomer(
      { displayName: `[TEST DATA] Existing Phone ${tag}`, phone: phone("0142", tag) },
      { firstName: "Pat", lastName: "Phone", phone: phone("0142", tag) },
      null,
      ownerId,
    );
    const start = await everything();
    const byEmailBefore = await detailsOf(byEmail.id);

    const batchId = await upload(tag, [
      // One customer on two rows (two service addresses).
      `A${tag},Import Person ${tag} [TEST DATA],Imp,Person,imp-${tag}@example.com,${phone("0111", tag)},1 Import St,Surrey,BC,V3S3M1,Referral,,2024-01-01`,
      `A${tag},Import Person ${tag} [TEST DATA],Imp,Person,imp-${tag}@example.com,${phone("0111", tag)},2 Second Ave,Langley,BC,,Referral,,2024-01-01`,
      `B${tag},Import Strata BCS1234 ${tag} [TEST DATA],,,,${phone("0112", tag)},9 Strata Way,White Rock,BC,,,,2024-02-01`,
      // Same email as an existing customer (in capitals), and "Rd" for her "Road".
      `C${tag},Existing Email ${tag} [TEST DATA],,,EXISTING-${tag}@example.com,${phone("0113", tag)},5 Known Rd,Surrey,BC,,Google Search,Gate code 1234,2024-03-01`,
      // Same phone as an existing customer, written differently, with a new address.
      `D${tag},Phone Match ${tag} [TEST DATA],,,,${phone("0142", tag).replace(/-/g, ".")},12 New Rd,Burnaby,BC,,,,2024-04-01`,
      // Nobody to import: skipped.
      ",,,,,,,,,,,[TEST DATA] Nothing useful here,",
    ]);
    // Uploading only stores the file for the preview.
    expect(await everything()).toEqual(start);

    const preview = (await previewImport(batchId))!;
    expect(preview.summary).toEqual({ create: 2, merge: 2, skipped: 1, contacts: 2, properties: 4, warnings: 0, rows: 6 });
    const planned = (ref: string) => preview.plan.customers.find((c) => c.customer.importRef === ref)!;
    expect(planned(`A${tag}`)).toMatchObject({ action: "create", rowNumbers: [2, 3] });
    expect(planned(`B${tag}`).customer.type).toBe("strata");
    expect(planned(`C${tag}`)).toMatchObject({ action: "merge", existingId: byEmail.id, matchedBy: "email", properties: [], contacts: [] });
    expect(planned(`D${tag}`)).toMatchObject({ action: "merge", existingId: byPhone.id, matchedBy: "phone", contacts: [] });
    expect(preview.plan.skipped).toEqual([{ rowNumber: 7, reason: "No name, email or phone" }]);

    expect(await runImport(batchId, ownerId)).toEqual(preview.summary);

    // The two new customers, with their contacts and addresses.
    const created = await db.select().from(customers).where(inArray(customers.importRef, [`A${tag}`, `B${tag}`]));
    expect(created).toHaveLength(2);
    const person = created.find((c) => c.importRef === `A${tag}`)!;
    expect(person).toMatchObject({
      displayName: `Import Person ${tag} [TEST DATA]`,
      type: "residential",
      email: `imp-${tag}@example.com`,
      phone: phone("0111", tag),
      source: "Referral",
      tags: ["markate-import"],
      customFields: { "Created Date": "2024-01-01" },
      importSource: "markate",
      createdBy: ownerId,
    });
    expect(await streetsOf(person.id)).toEqual(["1 Import St", "2 Second Ave"]);
    expect(await db.query.contacts.findFirst({ where: eq(contacts.customerId, person.id) })).toMatchObject({ firstName: "Imp", lastName: "Person", isPrimary: true });
    const strata = created.find((c) => c.importRef === `B${tag}`)!;
    expect(strata.type).toBe("strata");
    expect(await streetsOf(strata.id)).toEqual(["9 Strata Way"]);

    // Matched by email: only the empty fields were filled and the notes were added to; nothing duplicated.
    expect(await customerById(byEmail.id)).toMatchObject({
      email: `existing-${tag}@example.com`,
      phone: phone("0113", tag),
      source: "Google Search",
      notes: "[TEST DATA] Prefers mornings\n\nFrom Markate:\nGate code 1234",
    });
    expect(await streetsOf(byEmail.id)).toEqual(["5 Known Road"]);
    expect(await contactCount(byEmail.id)).toBe(1);
    // Matched by phone: the new address was added.
    expect(await streetsOf(byPhone.id)).toEqual(["12 New Rd"]);
    expect(await contactCount(byPhone.id)).toBe(1);

    expect((await importResults(batchId)).map((r) => [r.rowNumber, r.action])).toEqual([
      [2, "create"],
      [3, "create"],
      [4, "create"],
      [5, "merge"],
      [6, "merge"],
      [7, "skip"],
    ]);
    await expect(runImport(batchId, ownerId)).rejects.toThrow("already been imported");

    expect(await rollbackImport(batchId, ownerId)).toEqual({ removed: 2, kept: [] });
    expect(await everything()).toEqual(start);
    expect(await detailsOf(byEmail.id)).toEqual(byEmailBefore);
    expect((await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) }))!.status).toBe("rolled_back");
    await expect(rollbackImport(batchId, ownerId)).rejects.toThrow("Only a completed import can be undone.");
  });

  it("Undo keeps a new customer who has been given an estimate since, and says why", async () => {
    const tag = uniqueTag();
    const batchId = await upload(tag, [
      `K${tag},Kept Customer ${tag} [TEST DATA],Kim,Kept,kept-${tag}@example.com,${phone("0121", tag)},3 Kept St,Surrey,BC,,,,2024-05-01`,
      `R${tag},Removed Customer ${tag} [TEST DATA],Rae,Removed,removed-${tag}@example.com,${phone("0122", tag)},4 Gone St,Surrey,BC,,,,2024-05-01`,
    ]);
    await runImport(batchId, ownerId);
    const [kept] = await db.select().from(customers).where(eq(customers.importRef, `K${tag}`));
    await createEstimate({ customerId: kept.id, title: `[TEST DATA] Estimate for ${tag}` }, ownerId);

    expect(await rollbackImport(batchId, ownerId)).toEqual({ removed: 1, kept: [{ name: `Kept Customer ${tag} [TEST DATA]`, reason: "now has a lead, estimate or project" }] });
    expect(await customerById(kept.id)).toBeDefined();
    expect(await streetsOf(kept.id)).toEqual(["3 Kept St"]);
    expect(await db.select().from(customers).where(eq(customers.importRef, `R${tag}`))).toEqual([]);
  });

  it("Undo restores a customer's notes when two rows of the file added notes to it", async () => {
    const tag = uniqueTag();
    const existing = await createCustomer({ displayName: `[TEST DATA] Twice Matched ${tag}`, email: `twice-${tag}@example.com`, notes: "[TEST DATA] Original note" }, null, null, ownerId);
    const before = await detailsOf(existing.id);
    // Markate held this customer twice (two customer IDs, same email), each with a note.
    const batchId = await upload(tag, [
      `X${tag},Twice Matched ${tag} [TEST DATA],,,twice-${tag}@example.com,,,,,,,Gate code 1234,2024-06-01`,
      `Y${tag},Twice Matched ${tag} [TEST DATA],,,twice-${tag}@example.com,,,,,,,Dog in the yard,2024-06-02`,
    ]);
    await runImport(batchId, ownerId);
    expect((await customerById(existing.id))!.notes).toBe("[TEST DATA] Original note\n\nFrom Markate:\nGate code 1234\n\nFrom Markate:\nDog in the yard");

    expect(await rollbackImport(batchId, ownerId)).toEqual({ removed: 0, kept: [] });
    expect(await detailsOf(existing.id)).toEqual(before);
  });
});
