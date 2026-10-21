/** What the staff work-orders card receives. No money anywhere. */
import type { WorkOrderStatus } from "@/db/schema/work-orders";
import type { WorkOrderSection } from "@/server/work-order-view";
import type { LinkStatus } from "./links";

export type { WorkOrderSection };

export const SECTION_LABEL: Record<WorkOrderSection, string> = {
  details: "Job details",
  bookings: "Schedule",
  access: "Address and access",
  scope: "Scope of work",
  colours: "Colours",
  paint: "Paint to order",
  preparation: "Preparation",
  excluded: "Not included",
  specialInstructions: "Special instructions",
  equipment: "Equipment",
  safety: "Safety",
  checklist: "Checklist",
};

export const STATUS_LABEL: Record<WorkOrderStatus, string> = { draft: "Draft", issued: "Issued", cancelled: "Cancelled" };

export interface ChecklistItemDTO {
  id: string;
  text: string;
}

/** The editable fields, as the edit form shows them. */
export interface WorkOrderFieldsDTO {
  title: string;
  crewId: string | null;
  specialInstructions: string;
  equipment: string;
  safetyNotes: string;
  /** The work order's own access notes, else the property's (what the crew would see). */
  accessNotes: string;
  showCustomerPhone: boolean;
  checklist: ChecklistItemDTO[];
}

export interface WorkOrderLinkDTO {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  status: LinkStatus;
  openCount: number;
  lastOpenedAt: string | null;
  lastOpenedVersion: number | null;
}

export interface WorkOrderVersionDTO {
  version: number;
  issuedAt: string;
  issuedByName: string | null;
  changeNote: string | null;
}

export interface WorkOrderDTO {
  id: string;
  /** "WO-7001". */
  number: string;
  title: string;
  status: WorkOrderStatus;
  currentVersion: number;
  crewId: string | null;
  /** Null = all crews. */
  crewName: string | null;
  /** When the current version was issued (ISO). */
  issuedAt: string | null;
  fields: WorkOrderFieldsDTO;
  /** Who the work order reaches: the job's bookings (only its crew's when it is for one crew), by date. */
  assigned: { what: string; who: string | null; dates: string }[];
  versions: WorkOrderVersionDTO[];
  links: WorkOrderLinkDTO[];
  /**
   * Sections that differ between the issued version and what would be issued now
   * (instructions edited, bookings moved). Null when it can't be worked out.
   */
  pendingChanges: WorkOrderSection[] | null;
}

export interface NewWorkOrderDefaults {
  /** False for jobs brought over without a signed estimate: the work order then has no scope list. */
  hasSignedEstimate: boolean;
  title: string;
  accessNotes: string;
  checklist: ChecklistItemDTO[];
  linkDays: number;
}
