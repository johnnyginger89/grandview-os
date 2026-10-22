# Grandview OS – master roadmap

Living document: the single list of what gets built next and why. It replaces the phase lists in
`DEVELOPMENT_PLAN.md` (which stays as the history of decisions). Findings referenced as `A-…` are in
`docs/AUDIT-2026-10.md`. Sizes: S ≤ 1 day · M 2–4 days · L 1–2 weeks. Timings are estimates.

**Rules for using this file**
- A phase starts only after the owner approves it; each phase ends at its gate.
- Every new request from the owner gets the impact check (bottom of this file) and is slotted into a
  phase here before any code is written. Small fixes may go straight into the current phase.
- Tick items as they go live, and add the matching line to `CHANGELOG.md`.

## Phase 0 – Make it safe (this week) · status: waiting for owner approval

Owner actions (Vercel, ~10 min):
- [ ] Delete `OWNER_RECOVERY_CODE` and redeploy (the `/recover` page is live and has no guess limit). A-SEC-1
- [ ] Set `CRON_SECRET` (Production) and redeploy. A-SEC-8

Safeguards (see "Release process" in `docs/AUDIT-2026-10.md`):
- [ ] GitHub Actions CI on every push and pull request: typecheck, lint, unit tests, end-to-end tests against a Postgres service. S
- [ ] Work on branches; pull requests get a Vercel preview link; `main` protected and deployable only when CI is green. S (+ owner clicks)
- [ ] `CHANGELOG.md` entry required in every pull request. S
- [ ] Database backup check before any migration; additive-migration test already exists (`architecture.test.ts`). S

Bugs that lose sales or money:
- [ ] Proposal validity counts from the send date; expired proposals flagged and excluded from follow-ups. A-EST-1 · S
- [ ] Never drop an inbound lead for one bad field; failed imports listed with Retry and the office alerted. A-SAL-2 · S–M
- [ ] Hand-set final price and the minimum job price must not make selected upgrades free (engine rule + tests). A-EST-2 · S
- [ ] "Sign now on this device" must render the customer signing mode for a staff-opened device. A-EST-3 · S–M
- [ ] "Mark as accepted": pre-tick recommended upgrades, show the total, flush autosave first. A-EST-4 · S
- [ ] "Hide costs" also hides costs in line details and the paint picker. A-EST-10 · S

Gate: owner approves the audit plan and the release process.

## Phase 1 – Stop the leaks (~2 weeks)

Sales:
- [ ] Link every estimate to the customer's open lead (auto or ask); same at "Mark as accepted". A-SAL-3 · S
- [ ] Merge, don't discard, details when a booking or note promotes an existing lead; keep a returning customer's new email/phone. A-SAL-4 · S
- [ ] YouCanBook.me cancellation only cancels leads at "Estimate booked"; rebook reopens. A-SAL-5 · S
- [ ] Contacts and addresses editable (incl. access notes); one place for email/phone. A-SAL-8 · S–M
- [ ] One follow-up list per person; any logged contact snoozes it; respects Lost and expired. A-SAL-6 · M
- [ ] Proposal outcomes flow back to the lead (decline, withdraw, Lost closes proposals); remove "Mark as sent without emailing" or make it create the link. A-SAL-10, A-EST-7 · S–M
- [ ] Bell/push alert for new web leads, bookings and cancellations. A-SAL-11 · S
- [ ] "Book / reschedule visit" on the lead. A-SAL-12 · S
- [ ] Lead summary in the estimate editor; job type preselected from the lead. A-SAL-14, A-EST-12 · S
- [ ] Close sibling quotes when one estimate on a lead is accepted. A-EST-8 · S
- [ ] Address picker on the estimate, required before sending. A-EST-14 · S
- [ ] Block or confirm sending when included surfaces are unmeasured ($0). A-EST-9 · S
- [ ] Acceptance in one transaction with a row lock; status changes conditional. A-EST-6, A-SEC-11 · S

Production:
- [ ] Project manager picker on the job (defaults sensibly). A-PRD-5 · S
- [ ] Work order always current for crews (auto new version on colours/bookings), crews notified; correct the misleading messages now. A-PRD-6 · S then M
- [ ] On-hold jobs leave crew phones and reminders. A-PRD-7 · S
- [ ] Readiness recalculated from current bookings; pressure wash done after its date. A-PRD-16 · S
- [ ] Field access window: one "is this person on this job" rule for chat, work orders, colour form. A-PRD-9 · M
- [ ] Share links expire after the job; CompanyCam photos off share links by default. A-PRD-8 · S–M
- [ ] Estimators are not sent to a job page they can't open. A-PRD-25 · S
- [ ] Home "$ (N jobs today)" counts by Vancouver calendar day. A-PRD-24 · S
- [ ] "Built before 1990" flag on the address → safety banner on the work order. A-PRD-13 · S

Security and recovery:
- [ ] Security emails through a backup sender (Resend) when Gmail fails; banner when email delivery is broken. A-SEC-1 · M
- [ ] Owner can reset a staff member's password and two-step sign-in; "New backup codes"; second owner account. A-SEC-1 · M
- [ ] Gmail connect owner-only and info@ only. A-SEC-2 · S
- [ ] Withdrawn/expired proposals show "no longer available"; proposal tokens stored hashed. A-SEC-4 · S–M
- [ ] Security log (sign-ins, two-step changes, resets) with IP; owner-only Security activity page; uptime monitor. A-SEC-5 · M
- [ ] Forced password change on first sign-in. A-SEC-7 · S
- [ ] Recovery page: single-use, expiring, rate-limited, emails the owner. A-SEC-3 · S

Gate: one normal office week with no workarounds.

## Phase 2 – One job page, one Today (~3 weeks)

- [ ] One job page from first call to paid (header, stage track, one Next-step button, tabs: Overview, Estimate, Schedule, Work order & colours, Messages, Photos & files). A-UX-1, A-UX-6
- [ ] One job number shown everywhere. A-UX-1
- [ ] Today: one "needs you today" list per person (sales, jobs, messages); phone tiles removed. A-UX-5
- [ ] Menus per role; Work orders becomes a Jobs filter; My Jobs only for crew members. A-UX-10
- [ ] Settings regrouped into 7 tabs by task (users and crews together). A-UX-16
- [ ] Glossary applied (Jobs, Proposal, Call back on, Send to crew, one Job type list). A-UX-11
- [ ] Job status worked out from bookings and updates; manual only for exceptions. A-PRD-10, A-UX-17
- [ ] Two note fields per job ("For the crew", "Office only"); rate crew notes reach the work order. A-PRD-18
- [ ] In-app email from the customer and job pages (sends from info@ or the sender's own Gmail), Reply on incoming emails, emails linked to the job. A-UX-8, A-SAL-13
- [ ] One booking form and one set of booking actions. A-PRD-17
- [ ] One job-types setting used everywhere. A-EST-12

Gate: owner and Malcolm use it on a preview for a week; answers to the invoicing and sub-pay questions.

## Phase 3 – Get paid (~4 weeks)

- [ ] Change orders: priced by the engine, signed or office-approved, adjust contract/deposit/hours, append to the work order. A-EST-5, A-PRD-4 · L
- [ ] Billing card: deposit, progress, final invoices; record sent/paid; "Ready to invoice" list. A-PRD-1 · M
- [ ] QuickBooks Online: create invoices and customers, sync payments. A-PRD-1 · L
- [ ] Job costing: sub agreed price per booking, material receipts, optional crew hours, estimated vs actual. A-PRD-2 · L
- [ ] Sub records: contact, WorkSafeBC clearance and insurance expiry with reminders. A-PRD-2 · M

Gate: a month of invoices that match QuickBooks.

## Phase 4 – Close the loop (~2 weeks)

- [ ] Walk-through checklist with punch items, photos and customer sign-off. A-PRD-11 · M
- [ ] On Complete: tasks for invoice, review request, one-year warranty check; share links expire. A-PRD-11 · S–M
- [ ] "Add existing job" and import of live monday jobs (kept out of sales figures). A-PRD-3 · M
- [ ] Customer merge and archive. A-SAL-7 · M–L

Gate: monday and Markate switched off.

## Phase 5 – Polish (ongoing)

- [ ] Painter's phone screen: one Today card, big "Post update" (camera first), tickable checklist. A-UX-15
- [ ] One home for job photos (owner decision: CompanyCam or the app). A-PRD-15
- [ ] Estimator extras: multi-select toolbar, by-surface view, offline copy, keyboard shortcuts.
- [ ] Google Calendar, SMS (Bird), notification settings per person, morning summary. A-UX-22
- [ ] Hardening: database certificate check, nonce-based CSP, push endpoint allow-list, separate integrations key. A-SEC-12..15

## Impact check for every new request

1. Restate the goal in the owner's words.
2. What it touches: screens, people (office, crews, customers), data, and anything that already does the job.
3. Simplest fit: change or reuse before adding; never a second way to do the same thing.
4. Risks: money, customer messages (rule 8), what crews can see (rule 2), existing work.
5. Size and phase.
6. Build on a branch with tests, preview link for the owner, change-log line.
