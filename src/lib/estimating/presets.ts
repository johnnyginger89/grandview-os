/**
 * Room presets for the "Add room" form: the room names you use, their usual height and
 * the surfaces normally painted in each. Owner-editable (Settings → Rates → Room presets),
 * stored in app_settings; surfaces refer to rates by code so a preset survives rate edits.
 */
import { z } from "zod";

export const ESTIMATING_PRESETS_KEY = "estimating_presets";

const sizeSource = z.enum(["walls", "ceiling", "floor", "perimeter"]);

export const presetSurfaceSchema = z.object({
  rateCode: z.string().trim().min(1).max(40),
  /** Starting count for things counted each (doors, windows). */
  quantity: z.string().regex(/^\d+(\.\d+)?$/).max(10).optional(),
  /** Fill from this part of the size, even if the rate itself is entered by hand (e.g. siding from a house's walls). */
  from: sizeSource.optional(),
});

export const roomPresetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** "inside" rooms show on interior jobs, "outside" areas on exterior and staining jobs. */
  group: z.enum(["inside", "outside", "cabinets"]),
  kind: z.enum(["room", "building", "elevation", "area"]).default("room"),
  height: z.string().regex(/^\d+(\.\d+)?$/).max(6).nullable().default(null),
  surfaces: z.array(presetSurfaceSchema).max(20),
});

export const estimatingPresetsSchema = z.object({
  rooms: z.array(roomPresetSchema).max(60),
  favouriteColours: z.array(z.string().trim().min(1).max(80)).max(40),
  sheens: z.array(z.string().trim().min(1).max(30)).max(12),
});

export type PresetSurface = z.infer<typeof presetSurfaceSchema>;
export type RoomPreset = z.infer<typeof roomPresetSchema>;
export type EstimatingPresets = z.infer<typeof estimatingPresetsSchema>;

const s = (rateCode: string, extra: Omit<PresetSurface, "rateCode"> = {}): PresetSurface => ({ rateCode, ...extra });
const BASIC = [s("INT-WALL"), s("INT-CEIL"), s("INT-BASE")];
const DOORWAY = [s("INT-DOOR", { quantity: "2" }), s("INT-DCAS", { quantity: "2" }), s("INT-JAMB", { quantity: "1" })];

/** Starter values; the owner changes them in Settings. */
export const DEFAULT_ESTIMATING_PRESETS: EstimatingPresets = {
  rooms: [
    { name: "Living room", group: "inside", kind: "room", height: "8", surfaces: [...BASIC, s("INT-WCAS", { quantity: "2" })] },
    { name: "Dining room", group: "inside", kind: "room", height: "8", surfaces: [...BASIC, s("INT-WCAS", { quantity: "1" })] },
    { name: "Kitchen", group: "inside", kind: "room", height: "8", surfaces: BASIC },
    { name: "Primary bedroom", group: "inside", kind: "room", height: "8", surfaces: [...BASIC, ...DOORWAY, s("INT-WCAS", { quantity: "1" })] },
    { name: "Bedroom", group: "inside", kind: "room", height: "8", surfaces: [...BASIC, ...DOORWAY, s("INT-WCAS", { quantity: "1" })] },
    { name: "Bathroom", group: "inside", kind: "room", height: "8", surfaces: [...BASIC, ...DOORWAY] },
    { name: "Hallway", group: "inside", kind: "room", height: "8", surfaces: BASIC },
    { name: "Entry", group: "inside", kind: "room", height: "8", surfaces: BASIC },
    { name: "Family room", group: "inside", kind: "room", height: "8", surfaces: [...BASIC, s("INT-WCAS", { quantity: "2" })] },
    { name: "Office", group: "inside", kind: "room", height: "8", surfaces: [...BASIC, ...DOORWAY, s("INT-WCAS", { quantity: "1" })] },
    { name: "Laundry", group: "inside", kind: "room", height: "8", surfaces: [...BASIC, ...DOORWAY] },
    { name: "Stairwell", group: "inside", kind: "room", height: "16", surfaces: [s("INT-WALL"), s("INT-CEIL"), s("INT-RAIL")] },
    { name: "Whole house", group: "outside", kind: "building", height: "18", surfaces: [s("EXT-SIDING", { from: "walls" }), s("EXT-FASCIA", { from: "perimeter" }), s("EXT-TRIM"), s("EXT-DOOR", { quantity: "2" })] },
    { name: "Front", group: "outside", kind: "elevation", height: null, surfaces: [s("EXT-SIDING"), s("EXT-TRIM")] },
    { name: "Back", group: "outside", kind: "elevation", height: null, surfaces: [s("EXT-SIDING"), s("EXT-TRIM")] },
    { name: "Left side", group: "outside", kind: "elevation", height: null, surfaces: [s("EXT-SIDING"), s("EXT-TRIM")] },
    { name: "Right side", group: "outside", kind: "elevation", height: null, surfaces: [s("EXT-SIDING"), s("EXT-TRIM")] },
    { name: "Garage", group: "outside", kind: "area", height: null, surfaces: [s("EXT-GARAGE", { quantity: "1" })] },
    { name: "Deck", group: "outside", kind: "area", height: null, surfaces: [s("STN-DECK")] },
    { name: "Fence", group: "outside", kind: "area", height: null, surfaces: [s("STN-FENCE")] },
    { name: "Kitchen cabinets", group: "cabinets", kind: "area", height: null, surfaces: [s("CAB-DOOR", { quantity: "20" }), s("CAB-BOX")] },
  ],
  favouriteColours: ["SW 7006 Extra White", "SW 7008 Alabaster", "SW 7005 Pure White", "BM OC-17 White Dove", "BM OC-65 Chantilly Lace", "BM HC-172 Revere Pewter"],
  sheens: ["Flat", "Matte", "Eggshell", "Satin", "Semi-gloss", "Gloss"],
};

/** Which preset group fits a job type: outside areas for exterior and staining, cabinets for cabinets. */
export function presetGroupFor(jobType: string): RoomPreset["group"] {
  if (jobType === "exterior" || jobType === "staining") return "outside";
  if (jobType === "cabinets") return "cabinets";
  return "inside";
}

/** Rate categories in the order a job type wants them: its own first, then prep and repairs. */
export function categoryOrder(jobType: string): string[] {
  const first = jobType === "exterior" ? ["Exterior"] : jobType === "staining" ? ["Staining", "Exterior"] : jobType === "cabinets" ? ["Cabinets"] : jobType === "interior_exterior" ? ["Interior", "Exterior"] : ["Interior"];
  return [...first, "Prep", "Repairs"];
}
