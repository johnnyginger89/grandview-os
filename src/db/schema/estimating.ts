import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { RateSnapshot } from "@/lib/estimating/engine";
import { user } from "./auth";
import { customers, opportunities, properties } from "./crm";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const qty = (name: string) => numeric(name, { precision: 14, scale: 4 });

/** Paint and sundry products (Sherwin-Williams, Benjamin Moore, Cloverdale, …). */
export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  manufacturer: text("manufacturer").notNull(),
  name: text("name").notNull(),
  finish: text("finish"),
  category: text("category").notNull().default("paint"),
  containerGallons: qty("container_gallons").notNull().default("1"),
  pricePerGallon: money("price_per_gallon").notNull(),
  /** Square feet per gallon per coat. */
  coverage: qty("coverage").notNull().default("350"),
  supplier: text("supplier"),
  sku: text("sku"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const materialPriceHistory = pgTable("material_price_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull().references(() => materials.id, { onDelete: "cascade" }),
  pricePerGallon: money("price_per_gallon").notNull(),
  recordedBy: text("recorded_by").references(() => user.id),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export const FACTOR_KINDS = ["prep", "difficulty", "condition", "access"] as const;
export type FactorKind = (typeof FACTOR_KINDS)[number];

/** Editable pick-lists for multipliers, e.g. Access: "Ladder 2-storey" = 1.25. */
export const factorOptions = pgTable("factor_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<FactorKind>().notNull(),
  label: text("label").notNull(),
  value: numeric("value", { precision: 6, scale: 3 }).notNull(),
  position: integer("position").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
});

/** A production-rate identity. Values live in versions so history never changes. */
export const productionRates = pgTable(
  "production_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    customerLabel: text("customer_label"),
    category: text("category").notNull(),
    unit: text("unit").$type<RateSnapshot["unit"]>().notNull(),
    basis: text("basis").$type<RateSnapshot["basis"]>().notNull().default("units_per_hour"),
    /** Default quantity source when added to a room with dimensions. */
    dimensionSource: text("dimension_source").$type<"manual" | "walls" | "ceiling" | "floor" | "perimeter">().notNull().default("manual"),
    /** Proposal grouping, e.g. "Walls", "Trim", "Exterior Doors". Null = not listed as a paint line. */
    proposalGroup: text("proposal_group"),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => productionRateVersions.id),
    active: boolean("active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rates_code_idx").on(t.code)],
);

export const productionRateVersions = pgTable(
  "production_rate_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rateId: uuid("rate_id").notNull().references((): AnyPgColumn => productionRates.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    productionRate: qty("production_rate").notNull(),
    additionalCoatFactor: numeric("additional_coat_factor", { precision: 6, scale: 3 }).notNull().default("1"),
    defaultCoats: integer("default_coats").notNull().default(2),
    laborCostPerHour: money("labor_cost_per_hour"),
    billingRatePerHour: money("billing_rate_per_hour"),
    materialId: uuid("material_id").references(() => materials.id, { onDelete: "set null" }),
    coverageOverride: qty("coverage_override"),
    materialWastePct: numeric("material_waste_pct", { precision: 6, scale: 4 }).notNull().default("0.10"),
    otherCostPerUnit: qty("other_cost_per_unit").notNull().default("0"),
    prepNotes: text("prep_notes"),
    crewNotes: text("crew_notes"),
    changeNote: text("change_note"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rate_versions_idx").on(t.rateId, t.version)],
);

export const ESTIMATE_STATUSES = ["draft", "sent", "accepted", "declined", "expired", "archived"] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

export const estimates = pgTable(
  "estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").generatedAlwaysAsIdentity({ startWith: 5001 }),
    title: text("title").notNull(),
    customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "restrict" }),
    propertyId: uuid("property_id").references(() => properties.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    status: text("status").$type<EstimateStatus>().notNull().default("draft"),
    jobType: text("job_type").notNull().default("interior"),
    contractType: text("contract_type").$type<"fixed_price" | "time_and_materials">().notNull().default("fixed_price"),
    revision: integer("revision").notNull().default(0),
    // Pricing settings are copied from company defaults at creation so later default changes never alter this estimate.
    pricingMethod: text("pricing_method").$type<"target_margin" | "billing_rate">().notNull(),
    laborCostPerHour: money("labor_cost_per_hour").notNull(),
    billingRatePerHour: money("billing_rate_per_hour").notNull(),
    targetMargin: numeric("target_margin", { precision: 6, scale: 4 }).notNull(),
    materialMarkupPct: numeric("material_markup_pct", { precision: 6, scale: 4 }).notNull(),
    minimumJobPrice: money("minimum_job_price").notNull(),
    gstRate: numeric("gst_rate", { precision: 6, scale: 4 }).notNull(),
    depositPct: numeric("deposit_pct", { precision: 6, scale: 4 }).notNull(),
    discount: money("discount"),
    priceOverride: money("price_override"),
    /** Selected upgrades add to the hand-set final price. False only on estimates made before this rule. */
    finalPriceBeforeUpgrades: boolean("final_price_before_upgrades").notNull().default(false),
    // Cached totals for lists and dashboards; always recomputed by the engine on save.
    totalHours: qty("total_hours").notNull().default("0"),
    totalCost: money("total_cost").notNull().default("0"),
    totalPrice: money("total_price").notNull().default("0"),
    totalWithTax: money("total_with_tax").notNull().default("0"),
    internalNotes: text("internal_notes"),
    customerNotes: text("customer_notes"),
    poNumber: text("po_number"),
    /** One exclusion per line. NULL = job-type default; '' = none. */
    areasExcluded: text("areas_excluded"),
    /** NULL = job-type preparation text. */
    preparationOverride: text("preparation_override"),
    validUntil: ts("valid_until"),
    estimatorId: text("estimator_id").references(() => user.id),
    sentAt: ts("sent_at"),
    acceptedAt: ts("accepted_at"),
    createdBy: text("created_by").references(() => user.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("estimates_customer_idx").on(t.customerId),
    index("estimates_status_idx").on(t.status),
    index("estimates_opportunity_idx").on(t.opportunityId),
  ],
);

export const AREA_KINDS = ["room", "elevation", "building", "area", "phase"] as const;

export const estimateAreas = pgTable(
  "estimate_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    estimateId: uuid("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => estimateAreas.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<(typeof AREA_KINDS)[number]>().notNull().default("room"),
    length: qty("length"),
    width: qty("width"),
    height: qty("height"),
    position: integer("position").notNull().default(0),
    notes: text("notes"),
    customerDescription: text("customer_description"),
  },
  (t) => [index("areas_estimate_idx").on(t.estimateId)],
);

export const estimateLines = pgTable(
  "estimate_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    estimateId: uuid("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
    areaId: uuid("area_id").references(() => estimateAreas.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    description: text("description").notNull(),
    customerDescription: text("customer_description"),
    customerDetail: text("customer_detail"),
    rateSnapshot: jsonb("rate_snapshot").$type<RateSnapshot>().notNull(),
    quantity: qty("quantity").notNull().default("0"),
    quantitySource: text("quantity_source").$type<"manual" | "walls" | "ceiling" | "floor" | "perimeter">().notNull().default("manual"),
    coats: integer("coats").notNull().default(2),
    prepFactor: numeric("prep_factor", { precision: 6, scale: 3 }).notNull().default("1"),
    difficultyFactor: numeric("difficulty_factor", { precision: 6, scale: 3 }).notNull().default("1"),
    conditionFactor: numeric("condition_factor", { precision: 6, scale: 3 }).notNull().default("1"),
    accessFactor: numeric("access_factor", { precision: 6, scale: 3 }).notNull().default("1"),
    colour: text("colour"),
    sheen: text("sheen"),
    overrideHours: qty("override_hours"),
    overridePrice: money("override_price"),
    isOptional: boolean("is_optional").notNull().default(false),
    optionSelected: boolean("option_selected").notNull().default(false),
  },
  (t) => [index("lines_estimate_idx").on(t.estimateId)],
);

export const estimateCostItems = pgTable("estimate_cost_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  estimateId: uuid("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"subcontractor" | "equipment" | "material" | "other">().notNull(),
  description: text("description").notNull(),
  /** Shown on the proposal; empty keeps the item off the proposal (its price still counts). */
  customerDescription: text("customer_description"),
  cost: money("cost").notNull().default("0"),
  markupPct: numeric("markup_pct", { precision: 6, scale: 4 }),
  overridePrice: money("override_price"),
  isOptional: boolean("is_optional").notNull().default(false),
  optionSelected: boolean("option_selected").notNull().default(false),
  position: integer("position").notNull().default(0),
});

/** Frozen copy of an estimate each time it is sent or revised. */
export const estimateRevisions = pgTable(
  "estimate_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    estimateId: uuid("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    reason: text("reason"),
    snapshot: jsonb("snapshot").notNull(),
    totals: jsonb("totals").$type<Record<string, string>>().notNull(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("estimate_revision_idx").on(t.estimateId, t.revision)],
);

export const estimateTemplates = pgTable("estimate_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  jobType: text("job_type").notNull().default("interior"),
  /** Areas with line items referencing rate ids; resolved to current rates when applied. */
  payload: jsonb("payload").notNull(),
  createdBy: text("created_by").references(() => user.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});
