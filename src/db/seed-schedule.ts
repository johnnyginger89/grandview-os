/**
 * Customer start-notice emails (spec-schedule §2.4). STARTING TEXT ONLY: the owner
 * should review them in Settings → Email templates. Inserted once by the baseline
 * seed; an owner's edits are never overwritten.
 *
 * Variables: first_name, project_name, start_week, start_date, end_date, duration,
 * previous_start_date, company_phone, sender_name (filled by src/server/start-notices.ts).
 */

const WEEK_SUBJECT = "Your painting project – planned for the week of {{start_week}}";

function weekBody(extra: string | null) {
  return `Hi {{first_name}},

Good news – we've pencilled in your {{project_name}} project for the week of {{start_week}}.
${extra ? `\n${extra}\n` : ""}
We'll confirm the exact start day closer to the date. Could you reply to let us know that week works for you?

Questions? Just reply to this email or call us at {{company_phone}}.

Thanks,
{{sender_name}}
Grandview Painting Ltd.`;
}

export const SCHEDULE_MESSAGE_TEMPLATES = [
  {
    key: "project_start_week_interior",
    name: "Project – start week (interior)",
    channel: "email" as const,
    subject: WEEK_SUBJECT,
    body: weekBody(null),
  },
  {
    key: "project_start_week_exterior",
    name: "Project – start week (exterior)",
    channel: "email" as const,
    subject: WEEK_SUBJECT,
    body: weekBody(
      "Exterior painting depends on the weather. If it's raining or too cold for the paint to cure, we'll move the start and let you know right away.",
    ),
  },
  {
    key: "project_start_date",
    name: "Project – start date",
    channel: "email" as const,
    subject: "Your painting project starts {{start_date}}",
    body: `Hi {{first_name}},

Your {{project_name}} project is booked to start on {{start_date}}. We expect to take about {{duration}} and finish around {{end_date}}.

Before we arrive, please:
- clear small items, valuables and breakables from the work areas
- let us know about parking and how we can get in
- tell us about pets or alarm codes

Please reply to confirm this date works for you.

Thanks,
{{sender_name}}
Grandview Painting Ltd.`,
  },
  {
    key: "project_start_date_changed",
    name: "Project – updated start date",
    channel: "email" as const,
    subject: "Updated start date for your painting project: {{start_date}}",
    body: `Hi {{first_name}},

A quick update: your {{project_name}} project now starts on {{start_date}} (we previously said {{previous_start_date}}). We expect to finish around {{end_date}}.

Please reply to confirm the new date works for you.

Thanks,
{{sender_name}}
Grandview Painting Ltd.`,
  },
];
