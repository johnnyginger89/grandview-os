import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, contacts, customers, estimates, importBatches, importRows, opportunities, projects, properties } from "@/db/schema";
import { decodeCsvBytes, parseCsv, type CsvTable } from "@/lib/csv";
import { guessMapping, IMPORT_FIELD_KEYS, planCustomerImport, planSummary, type ExistingCustomer, type ImportField } from "@/lib/import/customers";
import { audit } from "./audit";

export class ImportError extends Error {
  readonly expose = true;
}

export const IMPORT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 20_000;
const SOURCES = { markate: "Markate" } as const;
export type ImportSource = keyof typeof SOURCES;

/** Store an uploaded export as a preview batch. Nothing touches customers until runImport. */
export async function createImportBatch(file: { name: string; bytes: Uint8Array }, source: ImportSource, userId: string) {
  const name = file.name.replace(/[^\w .()-]/g, "_").slice(0, 120) || "upload.csv";
  if (/\.(xlsx?|numbers)$/i.test(name)) throw new ImportError("That's a spreadsheet file. Open it in Excel and use File → Save As → CSV, then upload the CSV.");
  if (!/\.(csv|txt)$/i.test(name)) throw new ImportError("Please upload the export as a CSV file.");
  if (file.bytes.length > IMPORT_MAX_BYTES) throw new ImportError("This file is larger than 4 MB. Export fewer columns or split it into two files.");
  const table = parseCsv(decodeCsvBytes(file.bytes), { maxRows: MAX_ROWS + 1 });
  if (!table.rows.length) throw new ImportError("The file has a header row but no customers under it.");
  if (table.rows.length > MAX_ROWS) throw new ImportError(`The file has more than ${MAX_ROWS.toLocaleString()} rows. Please split it.`);
  if (table.headers.length > 120) throw new ImportError("The file has more than 120 columns. Please export fewer columns.");

  const mapping = guessMapping(table);
  const batch = await db.transaction(async (tx) => {
    const [b] = await tx
      .insert(importBatches)
      .values({ source, filename: name, headers: table.headers, mapping, rowCount: table.rows.length, createdBy: userId })
      .returning({ id: importBatches.id });
    for (let i = 0; i < table.rows.length; i += 1000) {
      await tx.insert(importRows).values(table.rows.slice(i, i + 1000).map((cells, k) => ({ batchId: b.id, rowNumber: i + k + 2, cells })));
    }
    await audit({ actorId: userId, action: "import.upload", entityType: "import_batch", entityId: b.id, after: { source, filename: name, rows: table.rows.length } }, tx);
    return b;
  });
  return batch.id;
}

async function loadBatch(batchId: string) {
  if (!z.string().uuid().safeParse(batchId).success) return null;
  const batch = await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) });
  if (!batch) return null;
  const rows = await db.select({ cells: importRows.cells }).from(importRows).where(eq(importRows.batchId, batchId)).orderBy(asc(importRows.rowNumber));
  const table: CsvTable = { headers: batch.headers, rows: rows.map((r) => r.cells), delimiter: "," };
  return { batch, table };
}

/** Every current customer with their contacts' emails/phones and property streets, for duplicate checks. */
async function existingCustomers(): Promise<ExistingCustomer[]> {
  const [cs, cts, ps] = await Promise.all([
    db
      .select({ id: customers.id, displayName: customers.displayName, email: customers.email, phone: customers.phone, source: customers.source, notes: customers.notes })
      .from(customers)
      .where(isNull(customers.archivedAt)),
    db.select({ customerId: contacts.customerId, email: contacts.email, phone: contacts.phone, phone2: contacts.phone2 }).from(contacts),
    db.select({ customerId: properties.customerId, street: properties.street }).from(properties),
  ]);
  const byId = new Map<string, ExistingCustomer>(cs.map((c) => [c.id, { ...c, contactEmails: [], contactPhones: [], streets: [] }]));
  for (const c of cts) {
    const x = c.customerId ? byId.get(c.customerId) : undefined;
    if (!x) continue;
    if (c.email) x.contactEmails.push(c.email);
    for (const p of [c.phone, c.phone2]) if (p) x.contactPhones.push(p);
  }
  for (const p of ps) byId.get(p.customerId)?.streets.push(p.street);
  return [...byId.values()];
}

export async function previewImport(batchId: string) {
  const loaded = await loadBatch(batchId);
  if (!loaded) return null;
  const mapping = loaded.batch.mapping as ImportField[];
  // Once imported, the recorded results are the truth; re-planning would match the new customers to themselves.
  const plan = loaded.batch.status === "preview" ? planCustomerImport(loaded.table, mapping, await existingCustomers(), loaded.batch.source) : { customers: [], skipped: [] };
  return { batch: loaded.batch, table: loaded.table, mapping, plan, summary: planSummary(plan) };
}

const mappingSchema = z.array(z.enum(IMPORT_FIELD_KEYS));

export async function saveImportMapping(batchId: string, raw: unknown, userId: string) {
  const loaded = await loadBatch(batchId);
  if (!loaded) throw new ImportError("Import not found.");
  if (loaded.batch.status !== "preview") throw new ImportError("This file has already been imported.");
  const mapping = mappingSchema.parse(raw);
  if (mapping.length !== loaded.batch.headers.length) throw new ImportError("The column list changed. Reload the page.");
  await db.update(importBatches).set({ mapping }).where(eq(importBatches.id, batchId));
  await audit({ actorId: userId, action: "import.mapping", entityType: "import_batch", entityId: batchId, after: { mapping } });
}

/** Create and merge customers as previewed, recording everything needed to undo it. */
export async function runImport(batchId: string, userId: string) {
  const preview = await previewImport(batchId);
  if (!preview) throw new ImportError("Import not found.");
  const { batch, plan, summary } = preview;
  if (batch.status !== "preview") throw new ImportError("This file has already been imported.");
  const label = SOURCES[batch.source as ImportSource] ?? batch.source;
  const now = new Date();

  await db.transaction(async (tx) => {
    // Claim the batch first so a double click can't import twice.
    const claimed = await tx
      .update(importBatches)
      .set({ status: "imported", importedAt: now, importedBy: userId, stats: summary })
      .where(and(eq(importBatches.id, batchId), eq(importBatches.status, "preview")))
      .returning({ id: importBatches.id });
    if (!claimed.length) throw new ImportError("This file has already been imported.");

    const creates = plan.customers.filter((c) => c.action === "create");
    for (let i = 0; i < creates.length; i += 200) {
      const chunk = creates.slice(i, i + 200).map((p) => ({ p, id: randomUUID() }));
      await tx.insert(customers).values(
        chunk.map(({ p, id }) => ({
          id,
          type: p.customer.type,
          displayName: p.customer.displayName,
          email: p.customer.email,
          phone: p.customer.phone,
          source: p.customer.source,
          tags: p.customer.tags,
          notes: p.customer.notes,
          customFields: p.customer.customFields,
          importSource: batch.source,
          importRef: p.customer.importRef,
          createdBy: userId,
        })),
      );
      const contactRows = chunk.flatMap(({ p, id }) => p.contacts.map((c) => ({ ...c, id: randomUUID(), customerId: id })));
      const propertyRows = chunk.flatMap(({ p, id }) => p.properties.map((a) => ({ ...a, id: randomUUID(), customerId: id })));
      if (contactRows.length) await tx.insert(contacts).values(contactRows);
      if (propertyRows.length) await tx.insert(properties).values(propertyRows);
      await tx.insert(activities).values(chunk.map(({ id }) => ({ customerId: id, type: "system" as const, body: `Imported from ${label} (${batch.filename})`, createdBy: userId })));
      for (const { p, id } of chunk) {
        await recordRows(tx, batchId, p.rowNumbers, {
          action: "create",
          customerId: id,
          customerCreated: true,
          createdContactIds: contactRows.filter((c) => c.customerId === id).map((c) => c.id),
          createdPropertyIds: propertyRows.filter((a) => a.customerId === id).map((a) => a.id),
          message: p.warnings.join(" ") || null,
        });
      }
    }

    for (const p of plan.customers.filter((c) => c.action === "merge")) {
      const id = p.existingId!;
      const current = await tx.query.customers.findFirst({ where: eq(customers.id, id), columns: { email: true, phone: true, source: true, notes: true } });
      if (!current) continue;
      const set: Record<string, string> = {};
      if (p.fill.email && !current.email) set.email = p.fill.email;
      if (p.fill.phone && !current.phone) set.phone = p.fill.phone;
      if (p.fill.source && !current.source) set.source = p.fill.source;
      if (p.fill.notes) set.notes = [current.notes, `From ${label}:\n${p.fill.notes}`].filter(Boolean).join("\n\n");
      const filledBefore = Object.fromEntries(Object.entries(set).map(([k, after]) => [k, { before: current[k as keyof typeof current], after }]));
      if (Object.keys(set).length) await tx.update(customers).set({ ...set, updatedAt: now }).where(eq(customers.id, id));
      const contactRows = p.contacts.map((c) => ({ ...c, id: randomUUID(), customerId: id }));
      const propertyRows = p.properties.map((a) => ({ ...a, id: randomUUID(), customerId: id }));
      if (contactRows.length) await tx.insert(contacts).values(contactRows);
      if (propertyRows.length) await tx.insert(properties).values(propertyRows);
      const changed = Object.keys(set).length + contactRows.length + propertyRows.length > 0;
      if (changed) await tx.insert(activities).values({ customerId: id, type: "system", body: `Details added from ${label} import (${batch.filename})`, createdBy: userId });
      await recordRows(tx, batchId, p.rowNumbers, {
        action: "merge",
        customerId: id,
        customerCreated: false,
        createdContactIds: contactRows.map((c) => c.id),
        createdPropertyIds: propertyRows.map((a) => a.id),
        filledBefore: Object.keys(filledBefore).length ? filledBefore : null,
        message: [`Matched existing customer by ${p.matchedBy}.`, changed ? "" : "Nothing new to add.", ...p.warnings].filter(Boolean).join(" "),
      });
    }

    for (const s of plan.skipped) {
      await tx.update(importRows).set({ action: "skip", message: s.reason }).where(and(eq(importRows.batchId, batchId), eq(importRows.rowNumber, s.rowNumber)));
    }
    await audit({ actorId: userId, action: "import.run", entityType: "import_batch", entityId: batchId, after: summary }, tx);
  });
  return summary;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The first row of a customer holds what was created; later rows of the same customer point at it. */
async function recordRows(
  tx: Tx,
  batchId: string,
  rowNumbers: number[],
  r: {
    action: "create" | "merge";
    customerId: string;
    customerCreated: boolean;
    createdContactIds: string[];
    createdPropertyIds: string[];
    filledBefore?: Record<string, { before: string | null; after: string }> | null;
    message: string | null;
  },
) {
  const [first, ...rest] = rowNumbers;
  await tx.update(importRows).set(r).where(and(eq(importRows.batchId, batchId), eq(importRows.rowNumber, first)));
  if (rest.length) {
    await tx
      .update(importRows)
      .set({ action: r.action, customerId: r.customerId, message: `Same customer as row ${first}.` })
      .where(and(eq(importRows.batchId, batchId), inArray(importRows.rowNumber, rest)));
  }
}

/**
 * Undo an import: delete the customers it created (unless they've since been used for a lead,
 * estimate or project), remove contacts/addresses it added, and restore fields it filled in
 * if nobody has changed them since.
 */
export async function rollbackImport(batchId: string, userId: string) {
  if (!z.string().uuid().safeParse(batchId).success) throw new ImportError("Import not found.");
  const batch = await db.query.importBatches.findFirst({ where: eq(importBatches.id, batchId) });
  if (!batch) throw new ImportError("Import not found.");
  if (batch.status !== "imported") throw new ImportError("Only a completed import can be undone.");
  const rows = await db.select().from(importRows).where(and(eq(importRows.batchId, batchId), inArray(importRows.action, ["create", "merge"])));
  const kept: { name: string; reason: string }[] = [];
  let removed = 0;

  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(importBatches)
      .set({ status: "rolled_back", rolledBackAt: new Date(), rolledBackBy: userId })
      .where(and(eq(importBatches.id, batchId), eq(importBatches.status, "imported")))
      .returning({ id: importBatches.id });
    if (!claimed.length) throw new ImportError("This import has already been undone.");

    const inUse = async (customerId: string) => {
      const [[o], [e], [p]] = await Promise.all([
        tx.select({ n: count() }).from(opportunities).where(eq(opportunities.customerId, customerId)),
        tx.select({ n: count() }).from(estimates).where(eq(estimates.customerId, customerId)),
        tx.select({ n: count() }).from(projects).where(eq(projects.customerId, customerId)),
      ]);
      return o.n + e.n + p.n > 0;
    };
    const propertyInUse = async (ids: string[]) => {
      if (!ids.length) return new Set<string>();
      const [o, e, p] = await Promise.all([
        tx.select({ id: opportunities.propertyId }).from(opportunities).where(inArray(opportunities.propertyId, ids)),
        tx.select({ id: estimates.propertyId }).from(estimates).where(inArray(estimates.propertyId, ids)),
        tx.select({ id: projects.propertyId }).from(projects).where(inArray(projects.propertyId, ids)),
      ]);
      return new Set([...o, ...e, ...p].map((r) => r.id).filter(Boolean) as string[]);
    };

    for (const r of rows.filter((x) => x.customerCreated && x.customerId)) {
      const c = await tx.query.customers.findFirst({ where: eq(customers.id, r.customerId!), columns: { displayName: true } });
      if (!c) continue;
      if (await inUse(r.customerId!)) {
        kept.push({ name: c.displayName, reason: "now has a lead, estimate or project" });
        continue;
      }
      await tx.delete(customers).where(eq(customers.id, r.customerId!));
      removed++;
    }

    for (const r of rows.filter((x) => !x.customerCreated && x.customerId)) {
      const used = await propertyInUse(r.createdPropertyIds);
      const removable = r.createdPropertyIds.filter((id) => !used.has(id));
      if (removable.length) await tx.delete(properties).where(inArray(properties.id, removable));
      if (r.createdContactIds.length) await tx.delete(contacts).where(inArray(contacts.id, r.createdContactIds));
      if (used.size) kept.push({ name: `Address on row ${r.rowNumber}`, reason: "is used by a lead, estimate or project" });
      if (r.filledBefore) {
        const now = await tx.query.customers.findFirst({ where: eq(customers.id, r.customerId!), columns: { notes: true, email: true, phone: true, source: true } });
        if (!now) continue;
        const restore = Object.fromEntries(
          Object.entries(r.filledBefore)
            .filter(([k, v]) => now[k as keyof typeof now] === v.after)
            .map(([k, v]) => [k, v.before]),
        );
        if (Object.keys(restore).length) await tx.update(customers).set(restore).where(eq(customers.id, r.customerId!));
        if (Object.keys(restore).length < Object.keys(r.filledBefore).length) kept.push({ name: `Details on row ${r.rowNumber}`, reason: "were edited after the import, so they were left as they are" });
      }
    }
    await audit({ actorId: userId, action: "import.rollback", entityType: "import_batch", entityId: batchId, after: { removed, kept } }, tx);
  });
  return { removed, kept };
}

export async function deleteImportBatch(batchId: string, userId: string) {
  if (!z.string().uuid().safeParse(batchId).success) throw new ImportError("Import not found.");
  const res = await db.delete(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.status, "preview"))).returning({ id: importBatches.id });
  if (!res.length) throw new ImportError("Only an upload that hasn't been imported can be deleted.");
  await audit({ actorId: userId, action: "import.delete", entityType: "import_batch", entityId: batchId });
}

export async function listImportBatches() {
  return db.select().from(importBatches).orderBy(desc(importBatches.createdAt)).limit(50);
}

/** What each row of a finished import did, with the customer's current name (null once deleted). */
export async function importResults(batchId: string) {
  return db
    .select({
      rowNumber: importRows.rowNumber,
      action: importRows.action,
      message: importRows.message,
      customerId: importRows.customerId,
      customerCreated: importRows.customerCreated,
      contacts: importRows.createdContactIds,
      addresses: importRows.createdPropertyIds,
      customerName: customers.displayName,
    })
    .from(importRows)
    .leftJoin(customers, eq(customers.id, importRows.customerId))
    .where(eq(importRows.batchId, batchId))
    .orderBy(asc(importRows.rowNumber));
}
