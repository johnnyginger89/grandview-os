# Putting Grandview OS online

The app runs on **Vercel** (hosting, Montréal region) with a **Supabase** Postgres database
in **Canada (Central)**. Every push to the `main` branch on GitHub deploys automatically, and
database updates run as part of each deploy.

Costs (USD, before tax): Vercel Pro $20/month · Supabase Pro $25/month. Supabase Free works for
a first look, but it pauses after a week of inactivity and has **no automatic backups**, so it
must be upgraded to Pro before real customer data goes in.

You will need: a password manager (to generate and store secrets) and about 20 minutes.

---

## 1. Supabase (database)

1. Go to **supabase.com** → **Start your project** → sign in with GitHub.
2. **New project**
   - Name: `grandview-os`
   - Database password: click **Generate a password**, then save it in your password manager.
   - Region: **Canada (Central)**. This can't be changed later.
   - Click **Create new project** and wait about 2 minutes.
3. **Turn off the Data API.** The app doesn't use it, and turning it off closes a door.
   In the left menu go to **Project Settings → Data API** (on some accounts it's under **Integrations → Data API**),
   switch **Enable Data API** off, and save.
4. **Enforce SSL**: **Project Settings → Database → SSL Configuration** → turn on
   **Enforce SSL on incoming connections**.
5. **Copy the connection string**: click **Connect** at the top of the project page → choose
   **Session pooler** (port **5432**) → copy the URI. It looks like:
   `postgresql://postgres.abcd1234:[YOUR-PASSWORD]@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`
   Replace `[YOUR-PASSWORD]` with the database password from step 2. If the password contains
   symbols such as `@ : / ? #`, generate a new letters-and-numbers password instead, since symbols
   break the URL. Keep this full string in your password manager: it is the `DATABASE_URL`.

   ⚠️ Use the **Session pooler**, not "Direct connection" (Vercel can't reach it) and not
   "Transaction pooler".

## 2. Generate the secrets

Create these in your password manager. Use its password generator: **40 characters, letters
and numbers only**. On a Mac you can instead run `openssl rand -hex 24` in Terminal.

| Name | What it's for |
|---|---|
| `BETTER_AUTH_SECRET` | Signs login sessions |
| `SETUP_TOKEN` | One-time code to create your owner account (delete after step 5) |
| `YCBM_WEBHOOK_SECRET` | Lets YouCanBook.me send bookings in |
| `FORM_WEBHOOK_SECRET` | Lets your website form send leads in |

Never send these by email or chat, including to Claude. They go only into Vercel.

## 3. Vercel (hosting)

1. Go to **vercel.com** → **Sign Up** → **Continue with GitHub**. Choose the **Pro** plan.
   (The free Hobby plan's terms don't allow business use.)
2. **Add New… → Project** → find **johnnyginger89/grandview-os** → **Import**.
   (If it's not listed, click **Adjust GitHub App Permissions** and allow that repository.)
3. On the import screen:
   - **Project Name**: `grandview-os`. Your app's address will be `https://grandview-os.vercel.app`.
     If Vercel says the name is taken, pick another; the address follows the name.
   - Framework preset: **Next.js**. Leave the build and install settings alone (the repo sets them).
   - Open **Environment Variables** and add each row below:

| Name | Value |
|---|---|
| `DATABASE_URL` | The Supabase Session pooler string from step 1.5 |
| `BETTER_AUTH_SECRET` | From step 2 |
| `BETTER_AUTH_URL` | `https://grandview-os.vercel.app` (your project's address) |
| `APP_URL` | Same as `BETTER_AUTH_URL` |
| `SETUP_TOKEN` | From step 2 |
| `YCBM_WEBHOOK_SECRET` | From step 2 |
| `FORM_WEBHOOK_SECRET` | From step 2 |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

4. Click **Deploy**. The first build takes 2–4 minutes. It also creates all the database tables
   and the starting configuration (pipeline stages, rate library, templates).
5. After it deploys, open **Settings → Environment Variables** and make sure every variable is
   ticked for **Production**. Untick **Preview** and **Development**, so test builds can never touch
   the real database.

If the build fails, open the failed deployment → **Build Logs** and copy the red lines. Those
messages say which setting is missing. They never show your secrets.

## 4. Check it's alive

Open `https://grandview-os.vercel.app/api/health`. You should see `{"ok":true,"db":"up",...}`.

## 5. Create your owner account

1. Go to `https://grandview-os.vercel.app/setup`.
2. Enter the **SETUP_TOKEN** code, then your name, email and a password (12+ characters).
3. Sign in. You'll be taken straight to **two-factor setup**: scan the QR code with an
   authenticator app (Google Authenticator, 1Password, Microsoft Authenticator) and **save the
   backup codes** in your password manager.
4. Back in Vercel → **Settings → Environment Variables**, **delete `SETUP_TOKEN`**. The setup page
   already switches itself off once an owner exists; this removes the code entirely.
5. In the app go to **Settings → Company**: add your phone number, GST number and YouCanBook.me link.
   Then go to **Settings → Pricing defaults** and enter your real labour cost and billing rate.

To add Malcolm and the crew, use **Settings → Users** in the app.

## 6. Your own address: grandviewpainting.app

The owner bought `grandviewpainting.app` for Grandview OS (Oct 2026). `.app` addresses only work
over https; Vercel sets that up by itself.

1. Vercel → project **grandview-os** → **Settings → Domains** → **Add** → `grandviewpainting.app`.
   When Vercel offers to add `www.grandviewpainting.app` too, accept and let it redirect to
   `grandviewpainting.app`.
   - **Bought through Vercel:** nothing else to do; it turns **Valid** within minutes.
   - **Bought elsewhere** (GoDaddy, Namecheap, Squarespace…): Vercel shows the records to add at
     that company, usually an **A** record for `@` and a **CNAME** for `www`. Add exactly what
     Vercel shows, in that company's DNS settings for grandviewpainting.app.
2. When Vercel shows the domain as **Valid**, change these in **Settings → Environment Variables**
   (Production):
   - `BETTER_AUTH_URL` = `https://grandviewpainting.app`
   - `APP_URL` = `https://grandviewpainting.app`
   - `BETTER_AUTH_TRUSTED_ORIGINS` = `https://grandview-os.vercel.app`
     (so the old address keeps working while everyone switches)
3. **Deployments → ⋯ → Redeploy** on the latest deployment.
4. Sign in at the new address. Phone notifications belong to an address: turn them on again
   from the bell, and on iPhone add the new address to the Home Screen (remove the old icon).

Links already sent (proposals, work orders, colour forms) keep working on the old address.
New links use the new one. Webhooks (YouCanBook.me, website form) keep working on either address;
switch them to the new one when convenient.

## 7. Connect lead intake

- **YouCanBook.me**: follow `docs/integrations/youcanbookme.md` using
  `https://<your-address>/api/inbound/youcanbookme` and `YCBM_WEBHOOK_SECRET`.
- **Website form (Gravity Forms)**: use the Gravity Forms **Webhooks** add-on to POST to
  `https://<your-address>/api/inbound/form` with header `x-webhook-secret: <FORM_WEBHOOK_SECRET>`.

## 8. Email (password resets and the booking-link button)

Until this is set up, the app can't send email. The booking-link button will report that email
isn't configured, and **Forgot password** won't send anything.

1. Sign up at **resend.com** and add the domain `grandviewpainting.ca`. Resend shows 2–3 DNS records;
   add them in Wix the same way as step 6.
2. Create an API key. In Vercel add `RESEND_API_KEY` = the key and
   `EMAIL_FROM` = `Grandview Painting <info@grandviewpainting.ca>`, then redeploy.

## 9. Before real data: upgrade and back up

- Supabase → **Organization settings → Billing** → upgrade to **Pro**. That gives you daily
  backups kept for 7 days, and the project no longer pauses.
- Optional: Point-in-Time Recovery (about $100/month) narrows possible data loss to minutes.

## Rolling back

Vercel → **Deployments** → pick the last good deployment → **⋯ → Instant Rollback**. Database
changes only ever add things, so an older version keeps working. Don't delete database tables or
columns by hand.

## Data location

The database (Supabase ca-central-1) and the app servers (Vercel `yul1`) are both in Montréal.
Vercel's build machines, logs and global content cache may run outside Canada. No customer data
is written to logs.

---

### Reference: all settings

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase Session pooler (port 5432). The app adds SSL automatically. |
| `BETTER_AUTH_SECRET` | yes | 32+ characters |
| `BETTER_AUTH_URL` | yes | `https://…` public address |
| `APP_URL` | yes | Same as above (used in webhook instructions and emails) |
| `YCBM_WEBHOOK_SECRET` | yes | 32+ characters |
| `FORM_WEBHOOK_SECRET` | yes | 32+ characters |
| `SETUP_TOKEN` | first run only | 32+ characters; delete after creating the owner |
| `ENABLE_EXPERIMENTAL_COREPACK` | yes | `1`. Makes Vercel use the repo's pnpm version |
| `RESEND_API_KEY`, `EMAIL_FROM` | for email | See step 8 |
| `EMAIL_REPLY_TO` | no | Reply-to address for outgoing email |
| `BETTER_AUTH_TRUSTED_ORIGINS` | no | Extra allowed addresses, comma separated: `https://grandview-os.vercel.app` after switching to grandviewpainting.app |
| `DB_POOL_MAX` | no | Database connections per server instance (default 3) |
| `CRON_SECRET` | recommended | Any long random text (`openssl rand -hex 24`). Vercel sends it with the scheduled jobs (4 pm daily-update reminder, Gmail check every 10 minutes) so nobody else can set them off |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Gmail | From Google Cloud → Credentials → OAuth client ID (Web application). Authorized redirect URIs: `https://grandviewpainting.app/api/integrations/google/callback` (and `https://grandview-os.vercel.app/api/integrations/google/callback` while both addresses are in use). Then Settings → Integrations → Connect Gmail, signed in as info@ |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no | Phone notification keys; made automatically and kept in the database when not set |
| `INTEGRATIONS_ENCRYPTION_KEY` | no | Encrypts integration tokens (CompanyCam, Gmail) in the database. Defaults to a key derived from `BETTER_AUTH_SECRET`; changing either means re-entering those tokens |

The app refuses to start on the live site if a required setting is missing or too short.
Two-factor sign-in can't be turned off there, and development test logins are blocked there.

## Locked out (owner)

If the owner forgets the password and email isn't set up:

1. In Vercel → Settings → Environment Variables, add `OWNER_RECOVERY_CODE` with any text of
   32+ characters (a long sentence). Tick Production. Redeploy.
2. Go to `https://grandviewpainting.app/recover`, enter that same text, your email and a new password.
3. Sign in (your authenticator code is still required).
4. Delete `OWNER_RECOVERY_CODE` in Vercel and redeploy. The page disappears again.
