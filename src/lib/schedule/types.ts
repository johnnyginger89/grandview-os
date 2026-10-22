/**
 * Data shapes the schedule services return to pages and client components. None of
 * them carries money; hours appear only in office (schedule.read) DTOs, never in
 * FieldJobView.
 */
import type { ProjectStatus } from "@/db/schema/projects";
import type { IsoDate } from "@/lib/calendar-date";
import type {
  ConfirmVia,
  CrewColor,
  CrewKind,
  CrewTrade,
  NoticeVariant,
  ScheduleEntryKind,
  StartConfirmation,
} from "./constants";
import type { ReadinessItem, ReadinessSummary } from "./readiness";

export type { ReadinessItem, ReadinessSummary } from "./readiness";
export type ReadinessItemDTO = ReadinessItem;

export interface CrewDTO {
  id: string;
  name: string;
  kind: CrewKind;
  trade: CrewTrade;
  subCompany: string | null;
  color: CrewColor;
  crewSize: number;
  /** numeric(4,2) as a string, e.g. "8.00". */
  hoursPerDay: string;
  worksSaturdays: boolean;
  active: boolean;
  sortOrder: number;
  memberCount: number;
}

export interface CrewMemberDTO {
  userId: string;
  name: string;
  role: string;
  active: boolean;
  isLead: boolean;
}

export interface CrewWithMembersDTO extends CrewDTO {
  notes: string | null;
  members: CrewMemberDTO[];
}

export interface EntryDTO {
  id: string;
  version: number;
  projectId: string;
  projectNumber: number;
  jobTitle: string;
  /** estimates.job_type, e.g. "exterior" (for the Int/Ext tag). */
  jobType: string | null;
  customerName: string;
  city: string | null;
  projectStatus: ProjectStatus;
  confirmation: StartConfirmation;
  communicatedStart: IsoDate | null;
  crewId: string | null;
  crewName: string | null;
  kind: ScheduleEntryKind;
  phaseLabel: string | null;
  startDate: IsoDate;
  endDate: IsoDate;
  plannedHours: string | null;
  /** Internal (office only). */
  notes: string | null;
  /** Shown to the crew on /my-jobs. */
  crewNotes: string | null;
}

export interface EntryChangeDTO extends EntryDTO {
  deletedAt: string | null;
  updatedAt: string;
}

export interface UnscheduledJobDTO {
  projectId: string;
  number: number;
  jobTitle: string;
  customerName: string;
  city: string | null;
  jobType: string | null;
  /** ISO instant of the sale. */
  soldAt: string;
  status: ProjectStatus;
  estimatedHours: string;
  scheduledHours: string;
  remainingHours: string;
  notBefore: IsoDate | null;
  readiness: { total: number; ready: number; missing: string[] };
  group: "need_to_schedule" | "partly_scheduled" | "on_hold";
}

export interface ProjectSchedulingDTO {
  projectId: string;
  confirmation: StartConfirmation;
  noticeVariant: NoticeVariant | null;
  weekSentAt: string | null;
  weekConfirmedAt: string | null;
  dateSentAt: string | null;
  dateConfirmedAt: string | null;
  confirmedVia: ConfirmVia | null;
  communicatedStart: IsoDate | null;
  communicatedEnd: IsoDate | null;
  notBefore: IsoDate | null;
  schedulingNotes: string | null;
  /** 0 = no row yet (pass it back to saveSchedulingPrefs). */
  version: number;
}

export interface ProjectScheduleDTO {
  projectId: string;
  projectNumber: number;
  projectStatus: ProjectStatus;
  entries: EntryDTO[];
  scheduling: ProjectSchedulingDTO;
  readiness: ReadinessItemDTO[];
  readinessSummary: ReadinessSummary;
  /** Shown only to schedule.write users. */
  hours: { estimated: string; scheduled: string };
  /** First and last work day, if any. */
  firstWorkDay: IsoDate | null;
  lastWorkDay: IsoDate | null;
}

export interface ScheduleWindowDTO {
  entries: EntryDTO[];
  crews: CrewDTO[];
  /** By project id. */
  readiness: Record<string, ReadinessSummary>;
}

export type ScheduleWarning =
  | { type: "double_booked"; crewName: string; dates: IsoDate[]; otherProjectNumbers: number[] }
  | { type: "person_double_booked"; userName: string; dates: IsoDate[] }
  | { type: "non_working"; days: { date: IsoDate; label: string }[] }
  | { type: "not_ready"; missing: string[] }
  | { type: "before_not_before"; notBefore: IsoDate }
  | { type: "in_past" }
  | { type: "customer_told"; communicatedStart: IsoDate; newStart: IsoDate };

/** Jobs whose last work booking ended two or more working days ago but aren't marked finished (feasibility review F15). */
export interface FinishCandidateDTO {
  projectId: string;
  number: number;
  jobTitle: string;
  customerName: string;
  status: ProjectStatus;
  lastWorkDay: IsoDate;
}

export interface NoticePreview {
  /** Derived on the server from the customer; the client can't choose it. */
  to: string | null;
  subject: string;
  body: string;
  templateKey: string;
  variant: NoticeVariant;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  weekOf: IsoDate | null;
  workingDays: number;
  /** Everything worth telling the sender, in plain words. */
  problems: string[];
  /** No email, no booking or a cancelled job: Send must stay disabled. */
  blocked: boolean;
  /** The start date is in the past: Send needs "Send anyway". */
  pastStart: boolean;
}

/** What a crew member sees on /my-jobs. Built field by field; no money, no hours, no internal notes. */
export interface FieldJobView {
  entryId: string;
  projectId: string;
  kind: ScheduleEntryKind;
  kindLabel: string;
  phaseLabel: string | null;
  startDate: IsoDate;
  endDate: IsoDate;
  workingDays: number;
  /** "Day 2 of 5" when the booking is on today. */
  dayNumber: number | null;
  section: "today" | "this_week" | "upcoming" | "recent";
  crewName: string;
  tentative: boolean;
  /** The office put the job on hold: still listed, with a "don't go to site" warning. */
  onHold: boolean;
  projectNumber: number;
  jobTitle: string;
  customerName: string;
  projectTypes: string[];
  address: string | null;
  mapsUrl: string | null;
  accessNotes: string | null;
  crewNotes: string | null;
  /** Crew lead only. */
  contact: { name: string; phone: string } | null;
}
