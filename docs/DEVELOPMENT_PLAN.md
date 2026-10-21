# Grandview OS – development plan

Living document. Updated at the end of every working session.
Status key: ✅ done and tested · 🟡 partly done · ⬜ not started

## Decisions made

| Decision | Choice | Why |
|---|---|---|
| App framework | Next.js 16 + TypeScript | One codebase for desktop and phone; mature; server-side rendering keeps data on the server |
| Database | PostgreSQL (Drizzle ORM, SQL migrations) | Relational data, `numeric` money, row-level security available later |
| Hosting (proposed) | Vercel + Supabase Postgres in Canada (ca-central-1) | Managed backups, HTTPS, low maintenance. **Needs owner approval and accounts before any spend.** |
| Auth | Better Auth, stored in our own Postgres | TOTP two-factor, rate limiting, no vendor lock-in; works the same in dev and production |
| Accounting | Keep QuickBooks Online as the ledger | Grandview OS creates invoices and syncs them to QBO; we won't rebuild payroll, GST filing or a general ledger |
| Markate | Replace | Its scheduling, invoicing and field functions move into Grandview OS |
| monday.com | Replace for CRM and job scheduling | Current boards analysed (see below) and their workflows mapped into the pipeline and project stages |
| Default pricing | Billing-rate × hours + marked-up materials (PaintScout style), with true costs tracked separately | Matches how rates are built today, while still showing real margin |
| Branding | Website palette (logo blue #100599, navy #103362, teal #009ABB), official logo, Roboto/Roboto Condensed (same as the website) | Not a rebrand: the app should look like Grandview's website. Source: Elementor global colours on grandviewpainting.ca |
| Customer messages | Human-initiated only (button + preview) | Brief requires human approval for customer communication |
| File storage (proposal pictures, insurance documents) | Postgres `media` table (`bytea`), served from our own origin (`/api/media/<id>`, `/share/p/<token>/documents/<purpose>`) | Small, owner-managed files; no extra vendor, CSP stays `img-src 'self'`. Uploads go in 3 MiB chunks through server actions because Vercel caps a request body at 4.5 MB (documents may be 10 MB). Images are re-encoded with sharp (metadata stripped); SVG is never accepted |

## What we learned from the current setup (Oct 2026)

- **monday.com, "Main workspace":** the *Deals* board (≈1,040 items) is the real sales history, and the *Job Schedule* board (≈83 items) runs production.
  - Job stages: Need to Schedule → Start Week INT/EXT Sent → Start Week Confirm → Start Date Sent → Start Date Confirm → Scheduled → In Progress → Walk Thru → Complete → Invoiced → Job Costed.
  - Readiness checks: pressure washing booked, colours/paint ordered, colour consult done, deposit received.
  - Crews: Niko, Tia, Farhad, Darryn, Johnny.
  - The deposit is 20%, calculated as total ÷ 5, rounded up.
- **monday.com, new "CRM" workspace:** a richer Leads board set up for YouCanBook.me. It has lead source, inquiry channel, property type, built before 1990 (an asbestos flag), strata approval, a Ruby (answering service) setter, a confirmation call and drip control. It's mostly empty so far.
- **Leads:** come in from YouCanBook.me (booked visits) and the website form (need contacting). Most of the service area is Surrey, White Rock and Langley.
- **Subcontractors:** about 20, paid per job. A job's labour cost is therefore the sub's contract price, and hours are still tracked to measure production rates.
- **Accounting:** QuickBooks Online, currently synced from Markate. (Read access needs the QuickBooks connector re-authorized.)
- **PaintScout research:** see `docs/research/competitive-research.md`.

## Phase status

### Phase 4 – foundation
- ✅ Authentication: login, TOTP two-factor, backup codes, password reset, rate limiting, no public sign-up, deactivated users blocked
- ✅ Roles and permission matrix enforced on the server, with e2e tests for field roles
- ✅ Database schema and migrations; idempotent seed
- ✅ App shell: sidebar, mobile menu, design tokens
- ✅ CRM: customers, contacts, properties (multiple per customer), organizations table, tags, timeline
- ✅ Pipeline: customizable stages, drag-and-drop board, stale-lead flags, lost reasons, unviewed-lead indicator
- ✅ Lead intake: YouCanBook.me webhook → Estimate Booked (with dedupe and promotion), website form → New Lead, manual entry
- ✅ One-click booking-link email, with preview and timeline log; auto-moves New Lead → Contacted
- ✅ Production-rate library: versions, change notes, history, archive; materials with price history; editable multipliers
- ✅ Estimating engine: production rates, coats, multipliers, labour/material/other costs, two pricing methods, minimum job, discount, override, GST, deposit, options, margin vs markup (19 unit tests)
- ✅ Estimate editor: rooms with dimensions → auto quantities, line items, overrides that keep the calculated value, duplicate/delete with undo, autosave, cost items (subs/equipment), target-margin calculator, materials list, crew-duration estimate, templates, revisions with restore
- ✅ Settings: company, booking link, pricing defaults, pick lists, email templates, user management

### Phase 5 – core operations (next)
- ✅ Customer proposal: branded web page (print/save as PDF), scope by area, products & colours, optional upgrades with live totals, preparation/included/excluded/warranty/payment/terms (editable in Settings → Proposals), drawn + typed e-signature with IP, timestamp and document fingerprint, decline, expiry, withdraw, view tracking
- ✅ Acceptance → estimate locked to exactly what was signed, project created automatically, lead moved to Won
- ✅ Proposal presentation matching the owner's Markate proposal: cover per job type, About, Why us, Reviews, Portfolio (lightbox), Insurance & FAQ, the estimate document (FROM/TO, numbered service lines, upgrades, totals), full terms and warranty, Next step with signing; sticky section menu, phone layout with a sticky "Review & sign" bar, print/PDF of estimate + terms
- ✅ Settings → Proposals editor: every picture and all wording editable without code, per-job-type covers/photos/warranty with inheritance, picture uploads and library, insurance documents with expiry (dashboard reminder 30 days ahead, hidden from customers once expired, proposals already sent always link the newest), sample preview per job type
- ✅ Estimate editor: job type, PO number, custom preparation and exclusions per job, customer descriptions for areas, lines and cost items, "Preview proposal" (draft, not sent)
- 🟡 Projects: list and detail pages (contract, deposit, signed copy, status, schedule card, work orders); invoicing next
- ✅ Readiness checks per job (pressure washing, colours & paint, colour consult, deposit; editable in Schedule → Setup), shown on the job and the calendar
- ⬜ Projects: tasks, buildings/units for strata
- ✅ Schedule: crews and subs on a timeline (1/2/4 weeks) and month view, drag a sold job from "To schedule" onto a crew and day, move/resize, undo, booking types (painting, pressure washing, prep, touch-ups…), durations suggested from estimated hours and crew size, BC holidays and closed days, double-booking and "not before" warnings, tentative vs confirmed; phone agenda with a "Schedule…" sheet; estimators read-only
- ✅ Customer start notices (the monday "Start Week Sent / Confirm / Start Date Sent / Confirm" stages): Send start week… and Send start date… with preview, interior/exterior wording, Mark confirmed (phone/text/email), and a "customer was told" warning when a booking moves afterwards; the project becomes Scheduled automatically when it's booked
- ✅ My Jobs for crew logins: each booked job with dates, address, Open in Maps, office notes, lead sees the customer's phone; no prices, hours or contract details
- ✅ Work orders: generated from the signed estimate (scope by area, coats, products, colours, preparation, exclusions), special instructions, equipment, safety, access, checklist; versioned (crews see what changed), print/save as PDF, opened from My Jobs or by a secure expiring share link for subs without a login (stored hashed, revocable, open tracking); never prices (labour hours and paint added Oct 2026, see below)
- ⬜ Time tracking: mobile clock in/out per job, approval
- ⬜ Job costing: estimated vs actual dashboard, sub contract costs, material purchases

### UX overhaul (Oct 2026, owner's request: "one place, easy to find")
Feature work is paused while the app is simplified, one workflow at a time, with the owner approving each step. Concept sketch: claude.ai artifact "Grandview OS – one place concept".
- ✅ Step 1 – look, menu and search: lighter design (white menu, softer cards, navy headings); menu cut from 10 items to Home · Jobs · Schedule · Customers · Rates (+ Settings); Leads, Estimates and Sold jobs are tabs under Jobs (Jobs reopens the last tab used); Today/Performance tabs under Home; one search box on every page (customers, addresses, phone numbers, sold jobs, estimates, leads, work orders; `/` or Ctrl+K; full results at /search; no money in results; field roles have none); "+ New" menu; phone bottom bar (Home · Jobs · Schedule · Search · More)
- ✅ Owner feedback round 1: navy menu with the white Grandview logo; menu is Home · Leads · Estimates · Jobs · Schedule · Work orders · Customers (+ Settings, with Rates as a Settings tab; estimators see only Rates); search moved to the phone header; phone bottom bar Home · Leads · Estimates · Schedule · More; schedule opens on the month (desktop and phone, compact on phones) with "By crew" and List as other views; crews drawn as solid colours (tentative shown with a clock, no dashes); Work orders page listing every work order; "opened/seen" indicators removed
- ✅ Owner feedback round 2: "Mark as accepted" for proposals accepted by phone, email, in person or on paper (creates the job, office note stays internal); proposal email written from an editable "Sending a proposal" template; Estimates back in the menu, Rates under Settings; surfaces follow the room size even when it's typed later
- ✅ Notifications: a bell on every page and optional phone/desktop notifications (Web Push; on iPhone after "Add to Home Screen") when a customer opens a proposal, comes back to it after 12 hours, accepts or declines. Sent to the owner, admins, operations managers and whoever prepared the estimate; amounts only for people who see financials. A visit counts only once someone is looking at the page, so link previews (iMessage, WhatsApp) and email scanners don't trigger "opened"
- ✅ Work orders, owner's round: every sold job gets a draft work order for all crews automatically (online signature or "Mark as accepted"); crews see estimated labour hours (per item, per room, prep and job total, from the signed estimate's own hours) and "Paint to order" (gallons/quarts by product, colour and sheen, from measurements, coats and coverage), never prices; "Assign someone" on the work order books the colour consultant, pressure washer, carpenter or painters on their own days, and everyone booked can open the issued work order; new booking types Carpentry and Other work; Settings → Work orders switches for all three
- ⬜ Step 2 – one page per job (customer, quote, schedule, work order, photos, files, messages) replacing separate lead/estimate/project pages
- ⬜ Step 3 – home screen built around "what needs me today"
- ⬜ Step 4 – painter's phone screen
- ⬜ Step 5 – estimating, after an interview about how PaintScout is used today

### Batch 1 (Oct 2026): sales tracking and everyday screens
- ✅ Performance dashboard: sales (signed), produced (finished jobs), backlog, leads by source/channel, visits, proposals, close rate, sales cycle, funnel, lost reasons, per salesperson, 12-month chart, period picker with comparisons, goals with pace; money only for owner/operations, counts for other office roles
- ✅ Settings → Goals (owner only); project Status card with finish date and status history (single status writer; sold/finished/cancelled dates)
- ✅ Leads & Pipeline list view (monday-style): grouped by stage, inline stage and follow-up edits with undo, bulk moves, search, filters, columns; phone cards with Call/Email
- ✅ Estimates list grouped by month with "viewed" indicator; phone home screen with tiles, "$ (N jobs today)", Share booking link and a "+" quick-add; installable on the phone home screen
- ⬜ Next: Gmail (send, replies into the OS), Slack, Google Calendar, CompanyCam. Job and history import comes from the owner's Markate data (monday is being replaced, not imported)

### Phase 6 – advanced
- ⬜ Change orders · ⬜ invoices (deposit/progress/final) + QBO sync · ⬜ reporting dashboard
- ⬜ Automations (follow-up reminders, tasks) · ⬜ purchasing · ⬜ project messaging and photos
- ✅ Import: Markate customer export (CSV) → Settings → Import, with column matching, preview, duplicate matching by email/phone (fills in missing details only), several addresses/contacts per customer, extra columns kept as customer details, and one-click undo
- ⬜ Imports: Markate jobs/estimates/history (owner to send the export), PaintScout rates (API or CSV), QBO customers – same preview/undo pipeline

### Deployment readiness (owner approved Vercel Pro + Supabase, Oct 2026)
- ✅ vercel.json: Montréal region (yul1), only `main` deploys, build runs migrations + baseline seed (production builds only)
- ✅ Supabase session-pooler connection with SSL, small serverless pool
- ✅ Data API lock-down migration (RLS on every table, anon/authenticated revoked)
- ✅ First-run owner setup at /setup (setup token, race-safe, audited) + `pnpm create-owner` CLI
- ✅ Production config check at startup; MFA cannot be disabled on the live site; dev logins blocked and refused on non-local databases
- ✅ Health check `/api/health`; safe error messages (no database errors shown to users)
- ✅ Vancouver time-zone handling for visit times on UTC servers
- ✅ Per-source webhook secrets (YouCanBook.me, website form), header or ?key=
- ✅ Owner guide: docs/DEPLOYMENT.md
- ⬜ Owner creates accounts and first deploy · ⬜ Resend email domain · ⬜ Supabase Pro before real data

### Phase 7–9 – hardening, documentation
- ⬜ Backup and restore drill · ⬜ monitoring (Sentry) · ⬜ force password change for temporary passwords · ⬜ user guides

## Known gaps and technical debt
- The production rates and material prices that have been seeded are starter values. They need to be replaced with Grandview's real numbers.
- Email delivery is only logged until `RESEND_API_KEY` and the domain's DNS (SPF/DKIM) are set up.
- Choosing a customer when starting a new estimate uses a plain dropdown; it should become a search box once there are thousands of customers.
- PaintScout stores a separate rate for each number of coats. Our model is a first-coat rate plus an extra-coat factor, so the import step will need to convert between them.
- File storage exists for proposal pictures and insurance documents (Postgres `media`). Per-estimate site photos still need their own storage (planned; an object store if volume grows).
- The `organizations` table exists, but there's no screen for strata management companies yet.

## Open questions for the owner
0a. Proposal wording: the "3 Year Warranty" tile vs the 24-month interior / 36-month exterior warranty clause, and whether some portfolio photos and the six icons are yours to use (see public/proposal/README.md).
0. Email and texting via Bird (account exists): approve domain setup and a 604 number (US$0.95/month, billed yearly), or use the existing business number?
1. What are your burdened labour cost per hour, your billing rate, and your target margin?
2. How do you set subcontractor pay for a job? Is it estimated hours × an agreed rate, or a negotiated price?
3. Do you approve hosting at roughly US$50–125/month, and which domain should it use?
4. Can you share a PaintScout export (production rates and one sample estimate), or turn on PaintScout API access?
5. What are your brand colours and logo, for the proposals?
