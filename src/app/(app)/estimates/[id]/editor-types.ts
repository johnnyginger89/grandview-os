import type { DocLine } from "@/lib/estimating/document";
import type { MaterialSnapshot, RateSnapshot } from "@/lib/estimating/engine";

export interface RateOption {
  id: string;
  code: string;
  category: string;
  dimensionSource: string;
  snapshot: RateSnapshot;
}

export interface FactorOption {
  kind: string;
  label: string;
  value: string;
  isDefault: boolean;
}

export interface Revision {
  revision: number;
  reason: string | null;
  totals: Record<string, string>;
  createdAt: string;
}

/** A paint product to swap onto a line (only sent to logins that may see costs). */
export interface MaterialOption {
  id: string;
  label: string;
  finish: string | null;
  snapshot: MaterialSnapshot;
}

export type SizeSource = Exclude<DocLine["quantitySource"], "manual">;

export const FACTOR_KINDS = [
  { kind: "prep", label: "Prep" },
  { kind: "difficulty", label: "Difficulty" },
  { kind: "condition", label: "Surface" },
  { kind: "access", label: "Height / access" },
] as const;

export const FACTOR_FIELD = { prep: "prepFactor", difficulty: "difficultyFactor", condition: "conditionFactor", access: "accessFactor" } as const;
