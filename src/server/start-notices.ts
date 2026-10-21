import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { activities, contacts, crews, customers, estimates, messageTemplates, opportunities, outboundMessages, projects, projectScheduling, scheduleEntries } from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { addDays, todayIso, type IsoDate } from "@/lib/calendar-date";
import { afterConfirmed, afterNoticeSent } from "@/lib/schedule/confirmation";
import type { NoticeKind, NoticeVariant } from "@/lib/schedule/constants";
import { mondayOf } from "@/lib/schedule/dates";
import { jobTitle, longDay, shortDay, workingDaysLabel } from "@/lib/schedule/format";
import { confirmSchema, noticeSendSchema } from "@/lib/schedule/schemas";
import type { NoticePreview } from "@/lib/schedule/types";
import { calendarsFor, isWorkingDay } from "@/lib/schedule/working-days";
import { renderTemplate } from "@/lib/utils";
import { audit } from "./audit";
import type { Tx } from "./project-status";
import { ScheduleError } from "./schedule";
import { getScheduleSettings } from "./schedule-settings";
import { getCompany } from "./settings";

/*
 * Customer start notices ("Send start week…" / "Send start date…"). Human-initiated
 * only (CLAUDE.md rule 8): sendStartNotice runs from a server action after the user
 * saw the preview and pressed Send, and sends the text they approved. The recipient
 * and the dates are always derived here, never taken from the client.
 */

export type { NoticePreview };

type DbOrTx = Tx | typeof db;

export const NOTICE_TEMPLATE_KEYS = {
  weekInterior: "project_start_week_interior",
  weekExterior: "project_start_week_exterior",
  date: "project_start_date",
  dateChanged: "project_start_date_changed",
} as const;

const DUPLICATE_WINDOW_MS = 60_000;
const NOTICE_LABEL: Record<NoticeKind, string> = { start_week: "Start week", start_date: "Start date" };

/** Interior or exterior wording: the explicit choice, else the job type, else the lead's project types. */
export function chooseVariant(explicit: NoticeVariant | undefined, jobType: string | null, projectTypes: readonly string[], exteriorJobTypes: readonly string[]): NoticeVariant {
  if (explicit) return explicit;
  if (jobType && exteriorJobTypes.includes(jobType.toLowerCase())) return "exterior";
  return projectTypes.some((t) => /exterior|staining/i.test(t)) ? "exterior" : "interior";
}

/** A start-date notice after the customer was told another day uses the "updated" wording. */
export function noticeTemplateKey(kind: NoticeKind, variant: NoticeVariant, communicatedStart: IsoDate | null, startDate: IsoDate | null): string {
  if (kind === "start_week") return variant === "exterior" ? NOTICE_TEMPLATE_KEYS.weekExterior : NOTICE_TEMPLATE_KEYS.weekInterior;
  return communicatedStart && startDate && communicatedStart !== startDate ? NOTICE_TEMPLATE_KEYS.dateChanged : NOTICE_TEMPLATE_KEYS.date;
}

interface NoticeContext {
  projectId: string;
  customerId: string;
  opportunityId: string | null;
  confirmation: (typeof projectScheduling.$inferSelect)["confirmation"];
  communicatedStart: IsoDate | null;
}

async function composeWith(
  t: DbOrTx,
  projectId: string,
  kind: NoticeKind,
  sender: { name: string },
  opts: { variant?: NoticeVariant; now?: Date },
): Promise<{ preview: NoticePreview; ctx: NoticeContext }> {
  const [p] = await t
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      customerId: projects.customerId,
      opportunityId: projects.opportunityId,
      estimateTitle: estimates.title,
      jobType: estimates.jobType,
      customerName: customers.displayName,
      customerEmail: customers.email,
      projectTypes: opportunities.projectTypes,
    })
    .from(projects)
    .innerJoin(customers, eq(customers.id, projects.customerId))
    .leftJoin(estimates, eq(estimates.id, projects.estimateId))
    .leftJoin(opportunities, eq(opportunities.id, projects.opportunityId))
    .where(eq(projects.id, projectId));
  if (!p) throw new ScheduleError("Project not found.", "not_found");

  // `t` may be a transaction (one connection), so its queries run one after another.
  const [contact] = await t
    .select({ firstName: contacts.firstName, email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.customerId, p.customerId), eq(contacts.isPrimary, true)))
    .limit(1);
  const [scheduling] = await t
    .select({ confirmation: projectScheduling.confirmation, communicatedStart: projectScheduling.communicatedStart })
    .from(projectScheduling)
    .where(eq(projectScheduling.projectId, projectId));
  const work = await t
    .select({ startDate: scheduleEntries.startDate, endDate: scheduleEntries.endDate, worksSaturdays: crews.worksSaturdays })
    .from(scheduleEntries)
    .leftJoin(crews, eq(crews.id, scheduleEntries.crewId))
    .where(and(eq(scheduleEntries.projectId, projectId), eq(scheduleEntries.kind, "work"), isNull(scheduleEntries.deletedAt)));
  const [settings, company] = await Promise.all([getScheduleSettings(), getCompany()]);

  const startDate = work.length ? work.map((w) => w.startDate).sort()[0] : null;
  const endDate = work.length ? work.map((w) => w.endDate).sort().at(-1)! : null;
  // Distinct working days: two crews on the same days still means "about 3 days" for the customer.
  const days = new Set<IsoDate>();
  if (startDate && endDate) {
    const { calFor } = calendarsFor(settings, startDate, endDate);
    for (const w of work) {
      const cal = calFor({ worksSaturdays: !!w.worksSaturdays });
      for (let d = w.startDate; d <= w.endDate; d = addDays(d, 1)) if (isWorkingDay(d, cal)) days.add(d);
    }
  }
  const variant = chooseVariant(opts.variant, p.jobType ?? null, p.projectTypes ?? [], settings.exteriorJobTypes);
  const communicatedStart = scheduling?.communicatedStart ?? null;
  const templateKey = noticeTemplateKey(kind, variant, communicatedStart, startDate);
  const [template] = await t.select({ subject: messageTemplates.subject, body: messageTemplates.body }).from(messageTemplates).where(eq(messageTemplates.key, templateKey));
  if (!template) throw new ScheduleError("The start notice email template is missing. Ask the owner to check Settings → Email templates.");

  const to = contact?.email?.trim() || p.customerEmail?.trim() || null;
  const weekOf = startDate ? mondayOf(startDate) : null;
  const vars = {
    first_name: contact?.firstName?.trim() || p.customerName.split(" ")[0] || "there",
    project_name: jobTitle(p.name, p.estimateTitle),
    start_week: weekOf ? longDay(weekOf) : "",
    start_date: startDate ? longDay(startDate) : "",
    end_date: endDate ? longDay(endDate) : "",
    duration: workingDaysLabel(days.size),
    previous_start_date: communicatedStart ? longDay(communicatedStart) : "",
    company_phone: company.phone,
    sender_name: sender.name,
  };

  const problems: string[] = [];
  let blocked = false;
  if (p.status === "cancelled" || p.status === "closed") {
    problems.push(p.status === "cancelled" ? "This job is cancelled." : "This job is closed.");
    blocked = true;
  }
  if (!to) {
    problems.push("No email address on file. Add an email to the customer first.");
    blocked = true;
  }
  if (!startDate) {
    problems.push("Not on the schedule yet. Book the work first.");
    blocked = true;
  }
  const pastStart = !!startDate && startDate < todayIso(opts.now);
  if (pastStart) problems.push("The start date is in the past.");

  return {
    preview: {
      to,
      subject: renderTemplate(template.subject ?? "", vars),
      body: renderTemplate(template.body, vars),
      templateKey,
      variant,
      startDate,
      endDate,
      weekOf,
      workingDays: days.size,
      problems,
      blocked,
      pastStart,
    },
    ctx: { projectId: p.id, customerId: p.customerId, opportunityId: p.opportunityId, confirmation: scheduling?.confirmation ?? "none", communicatedStart },
  };
}

/** The server-composed preview for the notice dialog. Callers check schedule.write and messages.send. */
export async function composeStartNotice(projectId: string, kind: NoticeKind, sender: { name: string }, opts: { variant?: NoticeVariant } = {}): Promise<NoticePreview> {
  return (await composeWith(db, projectId, kind, sender, opts)).preview;
}

interface DeliverInput {
  to: string;
  subject: string;
  text: string;
  customerId: string;
  opportunityId: string | null;
  projectId: string;
  templateKey: string;
  sentBy: string;
}

/**
 * THE swap point for the Gmail spec: only this body changes when customer email
 * moves to the company mailbox. Today it sends like sendBookingLink does and logs
 * the message in outbound_messages (outside the caller's transaction, so the record
 * survives even if the caller fails afterwards).
 */
async function deliverCustomerEmail(m: DeliverInput): Promise<{ status: "sent" | "logged" | "failed"; error?: string; outboundMessageId: string }> {
  const result = await sendEmail({ to: m.to, subject: m.subject, text: m.text, replyTo: process.env.EMAIL_REPLY_TO });
  const [row] = await db
    .insert(outboundMessages)
    .values({
      channel: "email",
      toAddress: m.to,
      subject: m.subject,
      body: m.text,
      status: result.status,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      error: result.error,
      customerId: m.customerId,
      opportunityId: m.opportunityId,
      templateKey: m.templateKey,
      sentBy: m.sentBy,
      sentAt: result.status === "failed" ? null : new Date(),
    })
    .returning({ id: outboundMessages.id });
  return { status: result.status, error: result.error, outboundMessageId: row.id };
}

/**
 * Send the start notice the user previewed and edited. Runs with the project row
 * locked, so a concurrent schedule change or a second click waits and then sees the
 * new state. Callers check schedule.write and messages.send.
 */
export async function sendStartNotice(raw: unknown, actor: { id: string; name: string }): Promise<{ status: "sent" | "logged" }> {
  const input = noticeSendSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId)).for("update");
    if (!locked) throw new ScheduleError("Project not found.", "not_found");
    const { preview, ctx } = await composeWith(tx, input.projectId, input.kind, actor, { variant: input.variant });
    if (preview.startDate !== input.expectedStart) throw new ScheduleError("The schedule changed while you were writing – check the dates and send again.", "stale");
    if (preview.blocked || !preview.to || !preview.startDate) throw new ScheduleError(preview.problems[0] ?? "This notice can't be sent.");
    if (preview.pastStart && !input.sendAnyway) throw new ScheduleError("The start date is in the past. Tick “Send anyway” to send it.");

    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
    const [recent] = await tx
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.customerId, ctx.customerId), gt(activities.createdAt, since), sql`${activities.meta}->>'projectId' = ${ctx.projectId}`, sql`${activities.meta}->>'notice' = ${input.kind}`))
      .limit(1);
    if (recent) throw new ScheduleError("That email was just sent.");

    const delivery = await deliverCustomerEmail({
      to: preview.to,
      subject: input.subject,
      text: input.body,
      customerId: ctx.customerId,
      opportunityId: ctx.opportunityId,
      projectId: ctx.projectId,
      templateKey: preview.templateKey,
      sentBy: actor.id,
    });
    if (delivery.status === "failed") throw new Error(`Email failed: ${delivery.error ?? "unknown error"}`);

    const now = new Date();
    const confirmation = afterNoticeSent(ctx.confirmation, input.kind);
    const sentAt = input.kind === "start_week" ? { weekSentAt: now } : { dateSentAt: now };
    const values = {
      confirmation,
      ...sentAt,
      noticeVariant: preview.variant,
      communicatedStart: preview.startDate,
      communicatedEnd: preview.endDate,
      updatedBy: actor.id,
      updatedAt: now,
    };
    await tx
      .insert(projectScheduling)
      .values({ projectId: ctx.projectId, ...values })
      .onConflictDoUpdate({ target: projectScheduling.projectId, set: { ...values, version: sql`${projectScheduling.version} + 1` } });
    const what = input.kind === "start_week" ? `week of ${shortDay(preview.weekOf!)}` : shortDay(preview.startDate);
    await tx.insert(activities).values({
      customerId: ctx.customerId,
      opportunityId: ctx.opportunityId,
      type: "email",
      body: `${NOTICE_LABEL[input.kind]} email sent to ${preview.to} – ${what}${delivery.status === "logged" ? " (development – not actually delivered)" : ""}`,
      meta: { projectId: ctx.projectId, notice: input.kind, startDate: preview.startDate, outboundMessageId: delivery.outboundMessageId },
      createdBy: actor.id,
    });
    await audit(
      {
        actorId: actor.id,
        action: "schedule.notice.send",
        entityType: "project",
        entityId: ctx.projectId,
        before: { confirmation: ctx.confirmation, communicatedStart: ctx.communicatedStart },
        after: { kind: input.kind, to: preview.to, startDate: preview.startDate, endDate: preview.endDate, status: delivery.status, confirmation },
      },
      tx,
    );
    return { status: delivery.status };
  });
}

const VIA_LABEL = { email: "email reply", phone: "phone", text: "text", in_person: "in person" } as const;

/**
 * The customer confirmed the week or the date (reply, phone, text, in person).
 * Allowed without a prior notice (phone bookings): the current dates are then
 * recorded as what the customer agreed to. Callers check schedule.write and messages.send.
 */
export async function markStartConfirmed(raw: unknown, actor: { id: string }): Promise<void> {
  const input = confirmSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: projects.id, customerId: projects.customerId, opportunityId: projects.opportunityId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for("update");
    if (!p) throw new ScheduleError("Project not found.", "not_found");
    const [cur] = await tx.select().from(projectScheduling).where(eq(projectScheduling.projectId, p.id));
    const [agg] = await tx
      .select({ first: sql<string | null>`min(${scheduleEntries.startDate})`, last: sql<string | null>`max(${scheduleEntries.endDate})` })
      .from(scheduleEntries)
      .where(and(eq(scheduleEntries.projectId, p.id), eq(scheduleEntries.kind, "work"), isNull(scheduleEntries.deletedAt)));
    const now = new Date();
    const confirmation = afterConfirmed(cur?.confirmation ?? "none", input.kind);
    const confirmedAt = input.kind === "start_week" ? { weekConfirmedAt: now } : { dateConfirmedAt: now };
    const told = cur?.communicatedStart ? {} : { communicatedStart: agg?.first ?? null, communicatedEnd: agg?.last ?? null };
    const values = { confirmation, ...confirmedAt, ...told, confirmedVia: input.via, updatedBy: actor.id, updatedAt: now };
    await tx
      .insert(projectScheduling)
      .values({ projectId: p.id, ...values })
      .onConflictDoUpdate({ target: projectScheduling.projectId, set: { ...values, version: sql`${projectScheduling.version} + 1` } });
    const what = input.kind === "start_week" ? "start week" : "start date";
    await tx.insert(activities).values({
      customerId: p.customerId,
      opportunityId: p.opportunityId,
      type: "system",
      body: `Customer confirmed the ${what} (${VIA_LABEL[input.via]})${input.note ? `: ${input.note}` : ""}`,
      meta: { projectId: p.id, confirmed: input.kind, via: input.via },
      createdBy: actor.id,
    });
    await audit(
      {
        actorId: actor.id,
        action: "schedule.notice.confirm",
        entityType: "project",
        entityId: p.id,
        before: { confirmation: cur?.confirmation ?? "none" },
        after: { confirmation, kind: input.kind, via: input.via, note: input.note },
      },
      tx,
    );
  });
}
