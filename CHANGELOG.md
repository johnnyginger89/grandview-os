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
