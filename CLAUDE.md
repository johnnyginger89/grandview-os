# Grandview OS – guide for Claude and developers

Business management platform for Grandview Painting Ltd. (BC, Canada): CRM and
lead intake, production-rate estimating, proposals, projects, scheduling, work
orders, time tracking and job costing. See `docs/DEVELOPMENT_PLAN.md` for status.

@AGENTS.md

## Stack
- Next.js 16 (App Router, Turbopack), React 19, TypeScript strict
- PostgreSQL + Drizzle ORM (`src/db/schema/*`, migrations in `drizzle/`)
- Better Auth (email/password, TOTP two-factor, DB rate limiting) – `src/lib/auth.ts`
- Tailwind CSS v4 with design tokens in `src/app/globals.css`; UI primitives in `src/components/ui.tsx`
- decimal.js for every money/quantity calculation (`src/lib/money.ts`)
- Vitest (unit) and Playwright (e2e)

## Commands
```
pnpm dev                 # local dev server
pnpm typecheck           # tsc --noEmit
pnpm test                # unit tests (estimating engine etc.)
pnpm test:e2e            # Playwright, needs a running server on :3000 and dev seed
pnpm db:generate         # create a migration after editing src/db/schema
pnpm db:migrate          # apply migrations
pnpm db:seed:dev         # baseline config + one dev login per role (password in src/db/seed.ts)
```
Local Postgres: `DATABASE_URL=postgres://postgres@localhost:5432/grandview_dev`. Copy `.env.example` to `.env`.

## Architecture rules (do not break)
1. **Authorization is server-side.** Pages call `requirePermission()`, server actions call
   `assertPermission()` (`src/lib/authz/guard.ts`). The role → permission matrix lives only in
   `src/lib/authz/permissions.ts`. Hiding a button is never the protection.
2. **Field roles never receive financial data.** `estimates.costing` / `financials.read` gate
   any cost, margin or markup. Work orders shared by link must be built from a filtered
   projection, never the raw project/estimate.
3. **Money uses Decimal**, stored as Postgres `numeric`. Never `Number()` arithmetic for money
   except for display formatting.
4. **The estimating engine is pure** (`src/lib/estimating/engine.ts`) and covered by
   `engine.test.ts`. Any change to pricing math needs a test. The browser and server both use
   `src/lib/estimating/document.ts` so their totals always match.
5. **Rate snapshots.** Estimate lines store a copy of the rate (`rate_snapshot`). Editing a rate
   adds a `production_rate_versions` row; existing estimates never change unless a user
   explicitly clicks "Use current rate".
6. **Accepted estimates are locked.** Changes after acceptance go through change orders.
7. **Audit** consequential changes with `audit()` (`src/server/audit.ts`).
8. **Customer-facing messages are human-initiated** (button click with preview). Automations may
   create tasks/reminders but must not email customers on their own.
9. Domain logic lives in `src/server/*` (server-only). Route files and server actions stay thin:
   validate with zod, check permission, call the service, revalidate.
10. Times are stored UTC (`timestamptz`) and displayed in America/Vancouver (`src/lib/utils.ts`).

## Conventions
- Server actions return `{ ok: true, ... } | { ok: false, error }` and never throw to the client.
- Validate every external input with zod (forms, webhooks, JSON documents).
- Settings that the owner should be able to change belong in `app_settings` / pick-list tables,
  not in code. Starter values live in `src/db/seed-data.ts`.
- Test/dev data must be obviously fake (`@example.com`, `[TEST DATA]`, `*.dev.grandview.local`).
- Keep comments sparse and about *why*.
