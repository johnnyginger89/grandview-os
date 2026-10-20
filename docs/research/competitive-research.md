# Competitive Research: PaintScout Estimating Model + Field-Service UX Patterns

Researched 2026-10-20. This informs an original estimating system for a BC painting company. It summarizes concepts only and does not reproduce proprietary text or code.

Legend: **[V]** means verified from the cited source. **[I]** means inferred, or drawn from general product knowledge and not re-verified this session.

Main sources: PaintScout help center (help.paintscout.com), paintscout.com/pricing, Markate pricing and integrations pages, Pipedrive, Jobber and Buildertrend help/marketing pages. G2, Capterra.com and GetApp blocked direct fetching (403), so the review data comes from search-engine summaries of Capterra listings.

---

## 1. PaintScout estimating data model

### 1.1 Hierarchy

| Concept | What it is | Source |
|---|---|---|
| **Estimate Type** | Project category such as Interior or Exterior. Rate categories link to one or more estimate types, and each type sets its default area mode (room or surface). | [V] [Glossary](https://help.paintscout.com/en/articles/6063735-paintscout-glossary), [Rates overview](https://help.paintscout.com/en/articles/3206998-production-rates-section-overview) |
| **Area** | A physical space with dimensions, such as a kitchen or one side of a house. It has width, length and height fields. **Room** mode treats it as four walls. **Surface** mode treats it as a single plane. | [V] [Adding Areas](https://help.paintscout.com/support/estimating/areas-and-rates/adding-areas-to-an-estimate.md) |
| **Substrate / Surface** | A specific surface inside an area, such as walls, ceiling, trim, doors or windows. You add one by choosing a rate category, then a rate. It inherits the area's dimensions, and you can override them per surface or switch it to direct sqft/lnft entry. | [V] [Adjust Surface Dimensions](https://help.paintscout.com/support/estimating/areas-and-rates/how-to-adjust-surface-dimensions.md) |
| **Rate Category** | Top-level container for production rates (for example, Walls). Its order controls the picker order in the estimate builder. | [V] [Rates overview](https://help.paintscout.com/en/articles/3206998-production-rates-section-overview) |
| **Production Rate** | The pricing rule applied to a surface (fields in 1.2). | [V] same |
| **Line Item** | A custom entry not tied to dimensions or rates, such as prep, a flat fee or a consultation. | [V] [Line Items Overview](https://help.paintscout.com/support/customization/templates-and-presets/line-items-overview.md) |
| **Grouping** | Groups substrates or items into categories for presentation. | [V] Glossary |
| **Options** | Areas, line items or groups marked optional. They sit below the total, and the customer can add or remove them before accepting. | [V] [Customer Accepted Options](https://help.paintscout.com/support/estimating/line-items-and-options/customer-accepted-options.md) |
| **Template / Smart Template** | A regular template is a fixed snapshot that goes stale when rates change. A Smart Template pulls current rates, products and terms each time it is used, and is tied to one estimate type. | [V] [Smart Templates](https://help.paintscout.com/support/customization/templates-and-presets/smart-templates.md) |
| **Presentation** | A multi-page customer proposal, like a mini website with tabs. Pages are made of sections (title, photos, text, layout, style), and each section can optionally be edited per estimate. The defaults are a Quote page and a Terms page. | [V] [Presentations Overview](https://help.paintscout.com/support/customization/presentations-and-terms/presentations-overview.md) |
| **Work Order** | Crew-facing document with no customer pricing (see 1.7). | [V] [Working with Work Orders](https://help.paintscout.com/support/estimating/managing-estimates-and-work-orders/work-orders/working-with-work-orders.md) |

There are two views of the same estimate. **Area View** groups by room and **Surface View** groups by surface type. Both use the same measurements. [V] [Pricing FAQ](https://help.paintscout.com/support/resources/frequently-asked-questions/pricing-and-calculations.md)

### 1.2 Production rate fields [V unless marked]

Source: [Production Rates Overview](https://help.paintscout.com/en/articles/3206998-production-rates-section-overview), [How rates are calculated](https://help.paintscout.com/support/customization/pricing-and-rates/how-production-rates-are-calculated), [Advanced options](https://help.paintscout.com/support/customization/pricing-and-rates/advanced-production-rate-options)

- **Internal label**, seen by the team and on the work order. **Client label**, seen by the customer, which falls back to the internal label.
- **Calculation variables**, usually two:
  - Time-based: sqft/hr, lnft/hr, or hrs/item.
  - Price-based: $/sqft, $/lnft, or $/item.
  - PaintScout recommends using an hours variable so that labour hours are always known.
- **Per-coat values (1 to 4 coats).** Each value is the rate for that *total* number of coats, not an incremental one. For example, walls might be 125 sqft/hr at 1 coat and 85 sqft/hr at 2 coats. For item rates, hours per item rise with coats. For $/sqft rates, price rises with coats.
- **Use coats** toggle, turned off for prep, hardware and similar work. **Default coats** sets the starting coat count.
- **Default product** (only one per rate). A custom coverage value can override the product's coverage for that rate, for example spray versus roll. Changing the rate's variables clears the custom coverage. For primer plus topcoat, use a separate primer rate or a line item. [V] Pricing FAQ.
- **Descriptions:** area-view text, surface-view text, and a crew note.
- **Advanced:** Hide from customer (it still shows on the work order, and an area with only hidden surfaces is hidden too), Show coats, Show price, and Use custom hourly rate (for example, carpentry billed at a different rate).
- **Not found:** I found no documented difficulty or height multipliers, and the sitemap has no multiplier page. [I] Variations seem to be handled by creating separate rates (for example, "Walls – high ceiling" or "Walls – spray") or by editing hours manually on the estimate (there is an "Adjust Painting & Prep Hours" article).

### 1.3 Dimension → quantity math

- [V] The area takes W × L × H. The help example of a 15 × 12 × 8 room giving **432 sqft of walls** confirms **walls = 2(L+W) × H**. ([Adjust Surface Dimensions](https://help.paintscout.com/support/estimating/areas-and-rates/how-to-adjust-surface-dimensions.md))
- [I] Ceiling and floor are presumably L × W, and baseboard and crown are presumably the perimeter 2(L+W) in lnft. The docs did not state these explicitly.
- [V] No deductions are made for doors or windows, following PCA measurement standards. ([Coverage rates](https://help.paintscout.com/support/customization/pricing-and-rates/coverage-rates))
- [V] Surface-level overrides mean an area's total can differ from the sum of its surfaces.

### 1.4 Pricing model: single billing hourly rate (verified)

- [V] **Price = Σ(hours) × hourly rate + materials (when priced separately).** Their example: 13.5 hrs × $67 = $904.50 in labour, plus $155.71 in materials, for $1,060.21. ([Intro to production-rate estimation](https://help.paintscout.com/support/customization/pricing-and-rates/introduction-to-production-rate-estimation))
- [V] The **hourly rate is a *billing* rate with overhead and profit built in:**
  > hourly rate = (avg direct labour wage incl. burden + avg P&S $/hr + avg overhead $/hr) ÷ (1 − target margin)

  P&S $/hr comes from historical paint and sundries spend divided by painter hours. Their example is about $9.68/hr. If products are priced separately, materials are left out of the hourly rate to avoid double-counting. ([Calculate your hourly rate](https://help.paintscout.com/support/customization/pricing-and-rates/how-to-calculate-your-hourly-rate))
- So the caller's premise holds. PaintScout does **not** model cost plus markup per line. Profit and overhead are baked into one blended $/hr. A "Markup" glossary term exists (selling price minus production cost), but I found no per-line markup mechanism. [V/I]
- [V] **Prep hours are not auto-calculated.** They are entered manually and charged at the same hourly rate. ([Prep hours](https://help.paintscout.com/support/estimating/areas-and-rates/prep-hours.md))
- [V] **Sales rate** = total price ÷ total hours. It is a profitability check, and it rises when flat-fee or material items are added. ([Sales rate](https://help.paintscout.com/support/estimating/creating-estimates/what-is-a-sales-rate))
- [V] Other estimate-level controls ([Estimate Settings](https://help.paintscout.com/support/customization/templates-and-presets/estimate-settings.md), [Pricing FAQ](https://help.paintscout.com/support/resources/frequently-asked-questions/pricing-and-calculations.md)):
  - Hours rounding (1, 0.5, 0.25 or none) and gallon rounding (nearest or up).
  - Price rounding.
  - Stackable tax rates. Tax on materials only needs support to enable a labour/material split, which matters for BC PST.
  - Discounts as % or $.
  - Manual adjustment or subtotal override, which disables area pricing.
  - Estimate expiry.
  - Credit-card surcharge.
  - The hourly rate can be overridden per estimate. Templates do not inherit a changed default hourly rate.

### 1.5 Materials

[V] [Coverage rates](https://help.paintscout.com/support/customization/pricing-and-rates/coverage-rates)

- **Surfaces:** gallons = area ÷ coverage (sqft/gal or lnft/gal, per coat) × coats.
- **Items:** gallons = count × gal/item × coats.
- Coverage is set on the product, with an optional override per rate.
- PaintScout itself warns that the result over-estimates because openings are not deducted, and suggests ordering about 60–70% initially.
- Line-item materials need gallons entered manually.

### 1.6 Options, upgrades, change orders

- [V] Customers toggle options before accepting. Accepted options get their own subtotal line, carry over to the invoice, and feed an "Options Accepted" report.
- [V] A "Tiered Packages" (good/better/best) feature is in **beta** (sitemap).
- [V] "Additional work" (change orders) syncs to QBO, and a net-negative change becomes a credit memo.

### 1.7 Work order

[V] ([Working with Work Orders](https://help.paintscout.com/support/estimating/managing-estimates-and-work-orders/work-orders/working-with-work-orders.md))

- Generated from the estimate, without pricing.
- Hours display options: show all, hide item hours, or hide all. Total hours are editable.
- Includes products, with quantities following the rounding settings.
- Crew notes can be added at job, area and surface level.
- Shared by link, email, SMS or PDF.
- For crews who need another language, the doc suggests browser translation.

### 1.8 Job costing (weak)

[V] ([Job Costing](https://help.paintscout.com/support/operations/deals/job-costing.md))

- Only on "Production" deals, and requires the paid Operations add-on.
- Costs are **entered manually** in three buckets (labour, materials, other). Nothing syncs from timesheets or bills.
- Profit = pre-tax job value − logged costs.
- **There is no estimated-versus-actual hours comparison** and no time tracking in the docs (the sitemap has no timesheet page). A cross-job Job Profitability report exists.

### 1.9 Integrations and data export

- [V] **QuickBooks Online** ([QBO doc](https://help.paintscout.com/support/integrations/accounting/quickbooks-online-integration.md)):
  - **One-way, PaintScout → QBO.**
  - Invoices are created on one trigger (estimate accepted, invoice created, or invoice paid).
  - Customers are pushed manually. Paid status and partial payments can sync.
  - Lines are sent as a single total or as line items, with QBO calculating tax. Canadian users pick a tax code.
  - QBO items must already exist. Estimates do not become QBO Estimates.
- [V] Other integrations: Stripe, Wisetack financing, Zapier, Dropbox, Pipeline CRM, Workglue, and two-way Google Calendar. (Glossary, [pricing](https://paintscout.com/pricing))
- [V] **CSV exports:**
  - Production rates ([doc](https://help.paintscout.com/support/customization/pricing-and-rates/exporting-production-rates.md)). Columns are not documented, and **import is not documented.**
  - Contacts.
  - Filtered estimate lists ([doc](https://help.paintscout.com/support/estimating/managing-estimates-and-work-orders/managing-estimates/how-to-filter-estimates-and-export.md)).
- [V] **API (beta)** ([OpenAPI guide](https://help.paintscout.com/support/beta-guides/openapi-beta-guide.md), [developers](https://help.paintscout.com/developers)):
  - The API key is created in Account Settings.
  - REST resources include Companies, Contacts, Deals, Quotes, Quote Items, Invoices, Invoice Items, Notes, Activities, Tasks, Users and Webhooks.
  - **Settings resources** include Rate Categories, Rates, Products, Line Items, Quote Templates, Quote Types, Area Labels, Tax Rates, Pipelines, Stages, Lead Sources and Tags.
  - A **read-only MCP server** is at `mcp.paintscout.com/mcp`.
  - **Migration implication [I]:** if the user has PaintScout data, the API or MCP is the cleanest way to pull rates, products and quote history for migration. Rate CSV export is the fallback.

### 1.10 Platform and price

- [V] Web app, mobile-compatible, with an **offline mode** for building estimates only. Offline data is stored in the browser, and sending, searching and downloading are not possible offline. ([Offline](https://help.paintscout.com/support/getting-started/how-do-i-use-paintscout-offline))
- [I] There is no confirmed native app.
- [V] Pricing ([pricing](https://paintscout.com/pricing)):
  - Sales plan: $99/mo annual or $119/mo monthly.
  - Operations add-on: $79/$99.
  - Extra seats: $20/user.
  - Paid setup "Success Packages": $999–$1,999. These include *production rate setup*, which signals that configuring rates is hard.

---

## 2. What users praise and complain about

Review volume is small (Capterra lists about 6 reviews at 4.8/5). These points come from search summaries of [Capterra](https://www.capterra.com/p/201082/PaintScout/reviews/).

**Praise [V via search summary]:**
- Ease of use and fast estimates.
- Built specifically for painters.
- Strong customer service, and the company acts on suggestions.
- Better close rates attributed to the interactive proposals.

**Complaints [V via search summary]:**
- Progress invoicing is clunky.
- There is a learning curve.

**Competitor-claimed weaknesses** ([DripJobs comparison](https://dripjobs.com/compare-dripjobs-vs-paintscout), biased, so treat as **[I]**). Some of these are outdated against PaintScout's current pricing page, which now lists deposits, ACH and change orders.
- No native mobile app.
- Paid CRM add-on.
- Manual pipeline.
- Basic follow-ups only.
- No built-in good/better/best tiers (now in beta).
- No two-way SMS.
- Weak job costing and crew management.

**Synthesized pain points [I]:**
1. **Setup rigidity.** Rates need per-coat tables and one product per rate, and difficulty or height variations multiply the number of rates. Paid setup packages exist for this reason.
2. **Prep is manual.**
3. **Job costing is shallow.** It is manual, has no actual-versus-estimate hours, and has no time clock.
4. **Price stacks up** across Sales, Operations and seats.
5. **QBO sync is one-way.**
6. **Material quantities over-estimate** because openings are not deducted.

---

## 3. Markate (the system being replaced)

- [V] [markate.com](https://www.markate.com/): estimates (including an "AI Estimator" and video estimates), invoices with online payments, scheduling and dispatch with routing, a customer portal, CRM, SMS/email marketing, review requests, postcards, and native iOS/Android apps (schedule, time logs, GPS check-ins).
- [V] [Pricing](https://www.markate.com/pricing): $49.95/mo (owner-operator) plus $5 per employee. Most extras are $10/mo add-ons (online booking, CompanyCam integration, branded portal, Zapier, NiceJob). The API costs $50/mo.
- [V] **QuickBooks:** [Integrations](https://www.markate.com/integrations) lists QuickBooks Online and QuickBooks Payroll (employee hours sync). The pricing page claims "sync your data" with QBO. I found no documentation of the sync direction or objects.
- [V] **Data export:** the FAQ says to download your data as CSV or PDF before cancelling.
- [I] Markate is a generic home-service tool with no painting production-rate model. Migration likely means CSV export of customers, jobs and invoices. Because invoices may already live in QBO, the new system should reconcile against QBO customers to avoid creating duplicates.

---

## 4. UX patterns worth borrowing

| Product | Pattern | Status |
|---|---|---|
| **Jobber** | Client hub where the customer approves the quote online. **Optional line items** that the customer ticks, with the total updating live. A "recommended" option is pre-checked. A separate beta "quote options" feature lets the customer pick one of several alternatives (good/better/best). Linear Request → Quote → Job → Invoice flow. | [V] [optional line items](https://help.getjobber.com/es/articles/optional-line-items-on-quotes/), workflow [I] |
| **Pipedrive** | Kanban pipeline by stage. **Deal "rotting"**: a per-stage idle-days threshold turns the card red. It resets on any activity or edit and ignores future-scheduled activities. Activity-first selling, where every deal should have a next step. | [V] [rotting](https://support.pipedrive.com/en/article/the-rotting-feature), next-step [I] |
| **HubSpot** | A unified contact or deal record with a chronological **activity timeline** (emails, calls, notes, quote views), associations between contact, company and deal, and quote-viewed tracking. | [I] general knowledge |
| **Monday.com** | Board/table views with coloured **status columns**, the same data shown as kanban, calendar or Gantt, and simple "when status changes to X, do Y" automation recipes. Good for a production schedule board. | [I] general knowledge |
| **CompanyCam** | Photos tied to a project, timestamped and GPS-tagged, in a **chronological timeline**. Before/after pairs. Templated photo reports shared by link. Checklists per job type. | [V] via [GetApp](https://www.getapp.com/operations-management-software/a/companycam/) summaries |
| **Buildertrend** | **Daily logs** (notes, photos, voice-to-text). **Change orders** sent from the field, approved by the client online, with an option to auto-generate an invoice on approval and a required disclaimer before approval. A client portal showing progress. | [V] via search of [buildertrend.com](https://buildertrend.com/remodelers/) |

---

## 5. Implications for an original Grandview estimating design [I]

1. **Keep the Area → Surface → Rate model and dimension auto-calculation**:
   - walls = perimeter × height
   - ceiling = L × W
   - baseboard = perimeter
   - **Improve on it** with optional opening deductions (doors and windows) for *materials only*, so labour still follows PCA no-deduct convention while gallon counts become realistic.
2. **Separate cost from price.** Store crew cost per hour and a billing rate (or overhead % and target margin) so job costing can show the real margin. Still show a PaintScout-style "effective $/hr" (the sales rate) as a sanity check.
3. **Use modifiers instead of rate explosion.** Apply stackable multipliers for height or ladder work, difficulty, colour change, condition, or occupied home to production rates, rather than cloning rates.
4. **Auto-prep.** Make prep a percentage of paint hours or a per-surface prep rate, with manual override.
5. **Allow multiple products per surface** (primer plus finish), with coverage per application method.
6. **Bring options and tiers in from day one**: Jobber-style optional items plus good/better/best.
7. **Close the job-costing loop.** Turn the work order into a crew time clock per job or area, so actual-versus-estimated hours feed back into calibrating production rates. This is PaintScout's biggest gap.
8. **Design QBO two-way sync for BC.** Handle GST and PST separately (PST on materials only, where applicable). Read QBO customers to dedupe, and pull payment status back.
9. **Make rates import/export round-trip** (CSV), versioned so that old quotes keep the rates they were built with. PaintScout's Smart Template versus snapshot issue shows why versioning matters.
10. **Mobile:** use a PWA with a robust offline estimate builder and photo capture (CompanyCam-style timeline per job).
