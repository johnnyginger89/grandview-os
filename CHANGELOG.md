# Grandview OS – change log

Every change that reaches the live site is listed here, newest first, in plain English.
Each entry says what changed for the people using the app and, where it matters, what was
done to keep it safe. Version numbers follow `YYYY.MM.DD` (more than one release on a day gets
`.2`, `.3`, …). Technical detail lives in the git history; the short code after each line is
the commit it came from.

How to add an entry (for whoever makes the change, including the AI assistant):
1. Add a line under **Unreleased** in the same pull request as the change.
2. Use the headings *Added*, *Changed*, *Fixed*, *Removed*, *Security*.
3. Write it for the office, not for programmers: what's different and who it affects.
4. When the change goes live, the Unreleased lines move under a new dated version.

## Unreleased

### Added
- Audit of the whole app with findings, a workflow map and a master roadmap (`docs/AUDIT-2026-10.md`, `docs/ROADMAP.md`). No app behaviour changed.
- This change log.
- Automatic checks before anything goes live: every change is type-checked, linted and run through the unit and browser tests on GitHub, and must add a line here. How releases work now is in `docs/DEPLOYMENT.md` ("How changes reach the live site").
- **Fix a customer's contacts and addresses in one place.** Edit or remove a contact, pick the primary contact, and edit or remove an address (access notes and "Built before 1990" included). An address an estimate, job or lead uses can't be removed; edit it instead. The email and phone in **Edit customer** are the primary contact's, so the booking link, proposals, follow-ups, start notices and colour links all go to the corrected address.
- **Pre-1990 safety warning for crews.** Tick "Built before 1990" on an address and the crew's work order and My Jobs card say: "Built before 1990: assume lead paint and asbestos may be present. Follow safe work practices."
- **Project manager on each job**, picked at the top of the job page. They join the job's chat, hear about colour signings, and show on the work order as the office contact from its next version.
- **Pages on Customers, Estimates, Jobs and Work orders** (100 at a time, "Showing 1–100 of 1,240", Next and Previous), so older records no longer drop silently off the bottom. The Customers search also finds street addresses.

### Fixed
- **Times stay right from November 1.** British Columbia is staying on daylight time (UTC−7) all year and won't turn the clocks back on November 1, 2026. Servers or devices with out-of-date time-zone tables would have shown every time in the app an hour early from then on (crew bookings, start notices, the 4 pm reminder) and read typed times an hour off; the app now corrects for that itself.
- Updates no longer bring back the sample rates and paints you've renamed, re-coded or deleted (with their made-up prices). A brand-new setup still starts with the samples.
- **Website and YouCanBook.me leads are never lost.** One bad detail (a mistyped email, a long message) no longer turns a lead away; anything that can't be imported waits under **Leads → Couldn't import** with Retry and Dismiss, and the office is told. You and the lead's estimator get a bell and phone alert for new web leads, bookings, changes and cancellations. A repeat inquiry or booking adds to the existing lead instead of throwing the new details away, and a cancellation only loses a lead before the estimate visit; booking again reopens it. After this goes live, leads the old version silently dropped show up under Couldn't import.
- **Quotes no longer arrive already expired.** A proposal's "valid until" now counts from the day it's sent (30 days by default, Settings → Pricing), to the end of that day. The email, the estimate and the customer's copy all show the same date, and sending again gives a fresh date. Expired quotes drop off Home's "Proposals to follow up" and are marked "Expired" on the estimate with a **Send updated proposal** button. Quotes already sent keep their dates; any that went out already expired now show as expired.
- **"Hide costs" hides every cost** on the estimate screen, not just the totals: surface details, the paint picker's $/gal, extras' cost and markup, and margins in saved versions. Customer prices stay. The page now opens with costs hidden until it knows the tablet's choice, so they can't flash up on a reload.
- Upgrades are never free: when you type a final price by hand, any upgrade the customer ticks now adds its own price on top. Estimates made before this change keep the old rule, so proposals already sent don't change. The minimum job price still covers the whole job, upgrades included (your call, question 7).
- **Edits are never lost between devices.** With the same estimate open on two tablets or tabs, the older copy can no longer overwrite the newer one: it says "This estimate was changed on another device or tab" and offers **Reload**, keeping what's on screen until you choose. Send, Sign now, Mark as accepted and the other status changes save your latest edits first and stop with a clear message if they can't be saved, so the customer always gets what's on screen. An estimate changed after it was sent says the customer still sees the version sent on that date.
- **Sign now on this device** works: it opens the customer's own proposal page with signing switched on, even though the tablet is signed in as staff. The job's history records that the customer signed in person, on whose device.
- **Mark as accepted** ticks the same upgrades the customer's page would and shows the price before GST, GST, total and deposit, updating as upgrades are ticked. The job is sold exactly as on screen, or nothing changes.
- A signature, a decline and the office's status changes arriving at the same moment can no longer trip over each other: an old link or a decline never undoes a sale.
- **Every estimate goes with its lead.** New estimate from the customer page or "+" picks the customer's open lead, or asks which one when there are several, so the lead moves to Proposal sent and Won with it and the sale counts in the sales figures. The estimate shows what the customer asked for on the lead (project types, their request, the visit) and starts on the matching job type. An estimate without a lead says so and links in one click, and Mark as accepted warns when no lead will be marked won.
- **Pick the job address on the estimate.** It's in the estimate's header, chosen from the customer's addresses, so a landlord's or strata manager's job goes to the right property on the proposal, the contract and the crew's work order. Nothing is sent or marked accepted without one.
- **No more $0 surprises on a proposal.** Send, Sign now and Mark as accepted list any surface in the job that has no price yet (usually not measured) and go ahead only once you confirm it's meant.
- Home's "N jobs today" counts every job with painting booked today; a job used to drop off on the morning of its last day.
- The readiness checklist follows pressure-wash and colour-consult bookings when they're moved or removed, and a booked pressure wash shows as done after its last day.
- Signing colours no longer says they're on the work order before they are. A work order that signed colours or a booking change has made out of date is flagged "issue a new version" on the job (nothing is issued automatically).
- The Price tab shows clean percentages (55, not 55.00000000000001), and price settings must be sensible (percents between 0 and 100, no negative amounts).
- Estimators see "Sold. The office takes it from here." on an accepted estimate instead of a job link they can't open; the "accepted" notice opens the job for people who can.
- Jobs on hold: no 4 pm update reminder, and the crew's My Jobs card says "On hold: don't go to site unless the office says so."
- The work order's share dialog says crews see estimated hours (never prices), as the work order does.

### Removed
- The "Time & materials" switch on the estimate's Price tab, which didn't change anything yet.

### Security
- Database changes can no longer be edited after they're written, and ones that could break the live site or quietly change live data are refused by the tests.
- **The owner can reset a staff member's sign-in** (Settings → Users): a temporary password, or two-step sign-in again after a lost phone. Both sign them out everywhere and are recorded.
- A password someone else set (a new login, or the owner's reset) must be replaced at the next sign-in before anything else can be used.
- **New backup codes** on Password & security, after typing a code from your authenticator app; the old ones stop working.
- Only the owner can connect or disconnect the company Gmail, and only a mailbox on the company email's own domain (Settings → Company), because password-reset emails go out through it.
- The owner recovery page allows 5 wrong codes an hour, works once per code, records where each try came from, and tells the owner about every recovery.

## 2026.10.22 – sign-in, passwords and Gmail catch-up

### Added
- **Password & security** page in the account menu: change your own password. (4e28cd2)
- Forgot your current password while signed in? Set a new one with your 6-digit authenticator code instead. Five wrong codes in 15 minutes and it waits. (1a2186d)
- Owner recovery page (`/recover`) for when the owner is locked out and email isn't set up. It only exists while `OWNER_RECOVERY_CODE` (32+ characters) is set in Vercel; delete it afterwards. Two-factor is still required to sign in. (09bb245)
- Gmail now brings in the last 60 days of customer emails after connecting (about 100 inbox emails per check, no notifications for old mail) and shows what each check did in Settings → Integrations. (233e5a9)

### Fixed
- Gmail: a burst of more than 100 new emails between checks no longer drops the rest. (233e5a9)
- Sign-in works from both `grandviewpainting.app` and `www.grandviewpainting.app`, and from extra addresses listed in `BETTER_AUTH_TRUSTED_ORIGINS`. (32cb610, 6142cf8)
- Sign-in ignores a space after the email address and explains the real reason when it isn't a wrong password. (a19a379)

### Security
- Recovery and code-based password changes are audited and sign out every other device.

## 2026.10.21 – proposals, production and integrations

### Added
- **Estimator redesign** (PaintScout-style): total and Send always visible, "Add room" with the room's usual surfaces pre-ticked, tidy one-line surfaces, room conditions, colour picking with "all walls", paint shopping list, labour summary, Price tab with "Hide costs", options section, faster New estimate (customer search, job-type chips, templates). Settings → Rates → Room presets. Pricing maths unchanged. (537c7de)
- **Gmail**: connect info@ once; the app's emails go out from it; customer emails are copied into their file. **Follow up** on open proposals, and a Home list of proposals not chased for 3+ days. (e827a0d)
- **CompanyCam** photos on estimates, jobs and work orders. (bfc9d22)
- **Job chat**: a channel per job with photos and daily updates, and a 4 pm reminder to crews. (dbd1a88, 5f0c776)
- **Colour selection form**: filled from the signed estimate, completed by the office, colour consultant or customer, signed, and attached to the job and work order. (3e9615c)
- **Work orders** created automatically at the sale, with labour hours and paint to order, and multiple people assigned on different days. (fa05d51)
- **Notifications** (bell and phone) when a customer opens, accepts or declines a proposal. (6a4c9fe, b0112c5)
- **Mark as accepted** for proposals accepted by phone, email, in person or on paper; proposal email from an editable template. (2a3bc4d)
- **Schedule** calendar, **My Jobs** for crews, crew work orders. (96f4255)
- Sales dashboard, monday-style leads list, goals, phone home screen. (c456ba6)
- Markate customer import with preview and undo. (dacc2d0)
- Proposal redesigned to match the Markate presentation, fully editable in Settings → Proposals. (6798e42)

### Changed
- Lighter look, shorter menu and one search box; then navy menu with logo, month calendar and a Work orders page after owner feedback. (7d9f046, 9b92724)
- Estimate surfaces follow the room size even when the size is typed later. (17e2985)

### Fixed
- Addresses in search and the customer list. (cccc3f8)

### Security
- Closed two settings loopholes found in review. (8e957c2)

## 2026.10.20 – foundation

### Added
- The app itself: sign-in with two-factor, roles and permissions, customers and leads, pipeline, rate library, estimating engine and editor, settings, automated tests. (febb0f6, 4ab1b8e)
- Grandview Painting website branding. (5dbd70d)
- Hosting on Vercel with a Supabase database in Canada. (dc2e58b, 14d5f84)
- Customer proposals with e-signature; acceptance creates the job. (3133676)

### Fixed
- YouCanBook.me: every reschedule is processed, written dates are read as Vancouver time, and bookings with unusual customer text are accepted. (b7e67b8, 5dc63e4, 412c7a2)
