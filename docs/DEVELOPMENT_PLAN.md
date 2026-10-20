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
- ⬜ Customer proposal: branded web page and PDF, scope, exclusions, warranty, terms, optional upgrades, e-signature with audit trail, expiry
- ⬜ Acceptance → project automatically (inherits scope, hours, materials, budget)
- ⬜ Projects: phases, tasks/checklists, buildings/units for strata, readiness checks (paint ordered, colour consult, deposit, pressure washing)
- ⬜ Scheduling board: crews and subs on a timeline, drag-and-drop, capacity-based duration, conflicts
- ⬜ Work orders: generated from project, secure expiring share links, PDF, versioning, no pricing
- ⬜ Time tracking: mobile clock in/out per job, approval
- ⬜ Job costing: estimated vs actual dashboard, sub contract costs, material purchases

### Phase 6 – advanced
- ⬜ Change orders · ⬜ invoices (deposit/progress/final) + QBO sync · ⬜ reporting dashboard
- ⬜ Automations (follow-up reminders, tasks) · ⬜ purchasing · ⬜ project messaging and photos
- ⬜ Imports: monday.com Deals/Contacts, PaintScout rates and customers (API or CSV), QBO customers – with preview, dedupe and rollback

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
- There's no file upload or photo storage yet (needs an object store; Phase 5).
- The `organizations` table exists, but there's no screen for strata management companies yet.

## Open questions for the owner
1. What are your burdened labour cost per hour, your billing rate, and your target margin?
2. How do you set subcontractor pay for a job? Is it estimated hours × an agreed rate, or a negotiated price?
3. Do you approve hosting at roughly US$50–125/month, and which domain should it use?
4. Can you share a PaintScout export (production rates and one sample estimate), or turn on PaintScout API access?
5. What are your brand colours and logo, for the proposals?
