# Grandview OS

The operating system for Grandview Painting Ltd.: leads, customers, production-rate
estimating, and (in progress) proposals, projects, scheduling, work orders, time
tracking and job costing, all in one place.

- **Status and roadmap:** [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)
- **Architecture rules and commands:** [CLAUDE.md](CLAUDE.md)
- **Putting it online (Vercel + Supabase):** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- **Lead intake setup:** [docs/integrations/youcanbookme.md](docs/integrations/youcanbookme.md)
- **Competitive research (PaintScout, Markate, Jobber, …):** [docs/research/competitive-research.md](docs/research/competitive-research.md)

## Run locally

Requirements: Node 22+, pnpm, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env            # then fill in BETTER_AUTH_SECRET and the webhook secrets (openssl rand -base64 32)
createdb grandview_dev
pnpm db:migrate
pnpm db:seed:dev                # baseline config + dev logins (see output)
pnpm dev                        # http://localhost:3000
```

Dev logins are `<role>@dev.grandview.local` (e.g. `owner@dev.grandview.local`) with the
password printed by the seed. Set `MFA_ENFORCED=false` in `.env` to skip mandatory two-factor
locally; it is on by default.

## Tests

```bash
pnpm test        # unit tests: estimating engine, margin/markup, minimums, GST, options
pnpm test:e2e    # browser tests against a running server (permissions, lead → estimate flow)
```

## Editing your proposal

Everything customers see around the estimate is in **Settings → Proposals**: the cover per job type, pictures,
reviews, insurance documents, the contract and the signing step. Use **Overview → Preview** to see a sample
proposal before customers do. Changes to pictures, marketing text and insurance documents also show on
proposals you've already sent; the estimate and contract a customer signs never change after sending.
Per-job details (PO number, preparation, exclusions, customer descriptions) are in the estimate's
**Proposal details** card.

## Security notes

- No public sign-up. The owner/admin creates accounts in Settings → Users.
- Two-factor authentication is required for owner, admin, operations manager, estimator and project manager roles.
- All permission checks happen on the server (`src/lib/authz`).
- Secrets live in environment variables only; `.env` is git-ignored.
