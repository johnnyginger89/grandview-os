/**
 * Which starter materials and rates the baseline seed inserts. Pure, so it is tested without
 * a database (seed-starters.test.ts); seed.ts reads the rows and applies the plan.
 *
 * Each starter is inserted at most once per database. The `seeded_starters` setting lists the
 * material keys and rate codes already seeded, so a starter the owner renamed, recoded or
 * deleted is never put back by a later deploy.
 */
import { z } from "zod";

export const SEEDED_STARTERS_KEY = "seeded_starters";

const seededStartersSchema = z.object({
  /** Starter material keys (seed-data MATERIALS[].key). */
  materials: z.array(z.string()),
  /** Starter rate codes (seed-data RATES[].code). */
  rates: z.array(z.string()),
});
export type SeededStarters = z.infer<typeof seededStartersSchema>;

/** The stored record, or null when there is none or it can't be read (both mean "not recorded yet"). */
export function readSeededStarters(value: unknown): SeededStarters | null {
  const parsed = seededStartersSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface StarterMaterial {
  key: string;
  manufacturer: string;
  name: string;
}

export interface StarterRate {
  code: string;
  proposalGroup?: string;
}

/** What the database holds now, archived rows included. */
export interface ExistingRows {
  materials: readonly { manufacturer: string; name: string }[];
  rates: readonly { code: string; proposalGroup: string | null }[];
}

export interface StarterSeedPlan {
  /** Starter material keys to insert, in starter order. */
  materials: string[];
  /** Starter rate codes to insert, in starter order. */
  rates: string[];
  /** Existing rates with a starter code and no proposal group: they get the starter's group. */
  proposalGroups: { code: string; proposalGroup: string }[];
  /** The record to store once the inserts are done. */
  seeded: SeededStarters;
  /** False when the stored record is already up to date, so it needn't be written. */
  recordChanged: boolean;
}

/** `recorded` is the stored record, or null when there is none (or it can't be read). */
export function planStarterSeed(
  starters: { materials: readonly StarterMaterial[]; rates: readonly StarterRate[] },
  existing: ExistingRows,
  recorded: SeededStarters | null,
): StarterSeedPlan {
  const nameOf = (m: { manufacturer: string; name: string }) => JSON.stringify([m.manufacturer, m.name]);
  const names = new Set(existing.materials.map(nameOf));
  const groups = new Map(existing.rates.map((r) => [r.code, r.proposalGroup]));

  const materials = planTable(
    starters.materials.map((m) => m.key),
    new Set(starters.materials.filter((m) => names.has(nameOf(m))).map((m) => m.key)),
    existing.materials.length > 0,
    recorded?.materials ?? null,
  );
  const rates = planTable(
    starters.rates.map((r) => r.code),
    new Set(starters.rates.filter((r) => groups.has(r.code)).map((r) => r.code)),
    existing.rates.length > 0,
    recorded?.rates ?? null,
  );
  const seeded = { materials: materials.seeded, rates: rates.seeded };

  return {
    materials: materials.insert,
    rates: rates.insert,
    proposalGroups: starters.rates.flatMap((r) => (r.proposalGroup && groups.get(r.code) === null ? [{ code: r.code, proposalGroup: r.proposalGroup }] : [])),
    seeded,
    recordChanged: JSON.stringify([seeded.materials, seeded.rates]) !== JSON.stringify([recorded?.materials, recorded?.rates]),
  };
}

/**
 * One table. `present` holds the starters whose name (material) or code (rate) is already in
 * the table: they are recorded without inserting a duplicate.
 */
function planTable(starters: readonly string[], present: ReadonlySet<string>, hasRows: boolean, recorded: readonly string[] | null) {
  // No record yet but the table has rows: an earlier deploy seeded it before the record existed,
  // and the owner may have renamed starters since, so nothing more is added to it.
  const done = new Set(recorded ?? (hasRows ? starters : []));
  return {
    insert: starters.filter((id) => !done.has(id) && !present.has(id)),
    // Entries no longer in the starter list stay recorded, so one put back in the code later isn't re-added.
    seeded: [...new Set([...(recorded ?? []), ...starters])],
  };
}
