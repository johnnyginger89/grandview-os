import { createHmac } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEV_PASSWORD, statePath } from "./helpers";

/*
 * Getting back in: a new login must choose its own password first; backup codes can be
 * remade with the authenticator app; only the owner can reset someone's password or
 * two-step sign-in, or connect Gmail; the recovery page works once.
 * One person's story, so the tests run in order. Test logins are @example.com.
 */
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const person = { name: `[TEST DATA] Sam Signin ${run}`, email: `e2e-signin-${run}@example.com`, password: "" };

// ---------------------------------------------------------------------------
// An authenticator app, for the test: RFC 6238 codes from the base32 key the setup screen shows.
// ---------------------------------------------------------------------------

function base32Bytes(key: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of key.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

function totp(key: string, step = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + step));
  const mac = createHmac("sha1", base32Bytes(key)).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return (((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000) + "").padStart(6, "0");
}

/** A 6-digit code the authenticator wouldn't show around now. */
function wrongCode(key: string): string {
  const valid = new Set([-1, 0, 1].map((s) => totp(key, s)));
  return ["000000", "111111", "222222", "333333"].find((c) => !valid.has(c))!;
}

/** Waits until React runs the page's forms, so a press isn't lost before the page has loaded. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const forms = [...document.querySelectorAll("form")];
    return forms.length > 0 && forms.every((f) => Object.keys(f).some((k) => k.startsWith("__reactProps")));
  });
}

/** Signs in, waiting out the sign-in limit (5 a minute from one address) when other tests used it up. */
async function signIn(page: Page, email: string, password: string) {
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.goto("/login");
    await hydrated(page);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    for (let i = 0; i < 60; i++) {
      const url = new URL(page.url());
      if (!url.pathname.startsWith("/login") || url.pathname === "/login/verify") return;
      if (await page.getByRole("alert").filter({ hasText: "Too many attempts" }).isVisible()) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(10_000);
  }
  throw new Error(`Couldn't sign in as ${email}`);
}

async function freshPage(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, permissions: ["clipboard-read", "clipboard-write"] });
  return { context, page: await context.newPage() };
}

async function ownerPage(browser: Browser) {
  const context = await browser.newContext({ storageState: statePath("owner") });
  return { context, page: await context.newPage() };
}

/** On the two-step page after signing in: switch to a backup code. */
async function useBackupCode(page: Page) {
  await expect(page).toHaveURL(/\/login\/verify/);
  await hydrated(page);
  await page.getByRole("button", { name: "Use a backup code" }).click();
  await expect(page.getByLabel("Backup code")).toBeVisible();
}

async function changePassword(page: Page, from: string, to: string) {
  await hydrated(page);
  const card = page.getByRole("region", { name: "Password" });
  await card.getByLabel("Current password").fill(from);
  await card.getByLabel("New password", { exact: true }).fill(to);
  await card.getByLabel("New password again").fill(to);
  await card.getByRole("button", { name: "Change password" }).click();
}

let key = "";
let firstBackupCodes: string[] = [];
let newBackupCodes: string[] = [];

test("a new login must choose its own password before anything else", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await ownerPage(browser);
  await owner.page.goto("/settings?tab=users");
  await hydrated(owner.page);
  await owner.page.getByLabel("Name", { exact: true }).fill(person.name);
  await owner.page.getByLabel("Email", { exact: true }).fill(person.email);
  await owner.page.getByLabel("Role", { exact: true }).selectOption("estimator");
  await owner.page.getByRole("button", { name: "Create account" }).click();
  const created = owner.page.getByText(/Account created for/);
  await expect(created).toContainText("they'll choose their own password when they first sign in");
  const temporary = (await created.locator("code").textContent()) ?? "";
  expect(temporary).toHaveLength(16);
  await expect(owner.page.getByRole("row").filter({ hasText: person.email }).getByText("Temporary password", { exact: true })).toBeVisible();
  await owner.context.close();

  const { context, page } = await freshPage(browser);
  await signIn(page, person.email, temporary);
  await expect(page).toHaveURL(/\/account\/security\?change=1/);
  await expect(page.getByText("You signed in with a temporary password.")).toBeVisible();

  // Nothing else opens: pages send them back, actions and API routes refuse.
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/account\/security\?change=1/);
  expect((await page.request.get("/api/notifications")).status()).toBe(401);
  expect((await page.request.get("/api/search?q=test")).status()).toBe(401);

  // Re-entering the temporary password isn't a change, even straight to the sign-in service.
  const same = await page.request.post("/api/auth/change-password", { data: { currentPassword: temporary, newPassword: temporary }, headers: { Origin: new URL(page.url()).origin } });
  expect(same.status()).toBe(400);
  expect(await same.json()).toMatchObject({ code: "PASSWORD_UNCHANGED" });
  // Nor can they clear the requirement themselves.
  await page.request.post("/api/auth/update-user", { data: { mustChangePassword: false }, headers: { Origin: new URL(page.url()).origin } });
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/account\/security\?change=1/);

  person.password = `my own password ${run}`;
  await changePassword(page, temporary, person.password);
  await expect(page.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
  await expect(page.getByText("You signed in with a temporary password.")).toHaveCount(0);
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/customers$/);
  expect((await page.request.get("/api/notifications")).status()).toBe(200);
  await context.close();
});

test("backup codes can be remade with the authenticator app, and only the new ones work", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await freshPage(browser);
  await signIn(page, person.email, person.password);
  await page.goto("/account/security");
  await hydrated(page);

  // Turn on two-step, as the person would with their phone.
  await page.getByLabel("Confirm your password to begin").fill(person.password);
  await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
  key = (await page.getByText("Can't scan? Enter this key:").locator("code").textContent()) ?? "";
  expect(key).toMatch(/^[A-Z2-7]+$/);
  firstBackupCodes = await page.locator("p", { hasText: "Backup codes (each works once)" }).locator("xpath=following-sibling::div[1]").locator("span").allTextContents();
  expect(firstBackupCodes).toHaveLength(10);
  await page.getByLabel("6-digit code").fill(totp(key));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Two-factor authentication is set up.")).toBeVisible();

  await page.reload();
  await hydrated(page);
  const card = page.getByRole("region", { name: "Backup codes" });
  await card.getByLabel("Code from your authenticator app").fill(wrongCode(key));
  await card.getByRole("button", { name: "Make new backup codes" }).click();
  await expect(card.getByRole("alert")).toContainText("That code didn't match");
  await card.getByLabel("Code from your authenticator app").fill(totp(key));
  await card.getByRole("button", { name: "Make new backup codes" }).click();
  const list = card.getByRole("list", { name: "New backup codes" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  newBackupCodes = await list.getByRole("listitem").allTextContents();
  expect(newBackupCodes.filter((c) => firstBackupCodes.includes(c))).toEqual([]);
  await card.getByRole("button", { name: "Copy codes" }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(newBackupCodes.join("\n"));
  await card.getByRole("button", { name: "I've saved them" }).click();
  await expect(list).toHaveCount(0);
  await context.close();

  // Signing in without the phone: an old backup code no longer works, a new one does.
  const again = await freshPage(browser);
  await signIn(again.page, person.email, person.password);
  await useBackupCode(again.page);
  await again.page.getByLabel("Backup code").fill(firstBackupCodes[0]);
  await again.page.getByRole("button", { name: "Verify" }).click();
  await expect(again.page.getByRole("alert").filter({ hasText: "That code didn't work" })).toBeVisible();
  await again.page.getByLabel("Backup code").fill(newBackupCodes[0]);
  await again.page.getByRole("button", { name: "Verify" }).click();
  await expect(again.page).not.toHaveURL(/\/login/);
  await again.context.close();
});

test("the owner can reset someone's two-step and password; they're signed out and start again", async ({ browser }) => {
  test.setTimeout(240_000);
  const signedIn = await freshPage(browser);
  await signIn(signedIn.page, person.email, person.password);
  await useBackupCode(signedIn.page);
  await signedIn.page.getByLabel("Backup code").fill(newBackupCodes[1]);
  await signedIn.page.getByRole("button", { name: "Verify" }).click();
  await expect(signedIn.page).not.toHaveURL(/\/login/);

  const owner = await ownerPage(browser);
  await owner.page.goto("/settings?tab=users");
  await hydrated(owner.page);
  // Never for the owner's own row: they use Password & security.
  const mine = owner.page.getByRole("row").filter({ hasText: "owner@dev.grandview.local" });
  await expect(mine.getByText("You")).toBeVisible();
  await expect(mine.getByRole("button")).toHaveCount(0);

  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: `Reset two-step sign-in for ${person.name}` }).click();
  await expect(owner.page.getByRole("status").filter({ hasText: "Two-step sign-in reset for" })).toContainText(person.name);
  await expect(owner.page.getByRole("button", { name: `Reset two-step sign-in for ${person.name}` })).toHaveCount(0);

  // Signed out everywhere.
  await signedIn.page.goto("/customers");
  await expect(signedIn.page).toHaveURL(/\/login/);
  await signedIn.context.close();

  owner.page.once("dialog", (d) => d.accept());
  await owner.page.getByRole("button", { name: `Set temporary password for ${person.name}` }).click();
  const shown = owner.page.getByRole("status").filter({ hasText: "Temporary password for" });
  await expect(shown).toContainText("shown only once");
  const temporary = (await shown.locator("code").textContent()) ?? "";
  expect(temporary).toHaveLength(16);
  await expect(owner.page.getByRole("row").filter({ hasText: person.email }).getByText("Temporary password", { exact: true })).toBeVisible();
  await owner.context.close();

  // The old password stops working; the temporary one signs in (no two-step now) and must be replaced.
  const back = await freshPage(browser);
  await back.page.goto("/login");
  await hydrated(back.page);
  await back.page.getByLabel("Email").fill(person.email);
  await back.page.getByLabel("Password").fill(person.password);
  await back.page.getByRole("button", { name: "Sign in" }).click();
  await expect(back.page.getByRole("alert").filter({ hasText: /incorrect|Too many attempts/ })).toBeVisible();
  await signIn(back.page, person.email, temporary);
  await expect(back.page).toHaveURL(/\/account\/security\?change=1/);
  await expect(back.page.getByText("Two-factor authentication is protecting your account.")).toHaveCount(0);
  person.password = `my second own password ${run}`;
  await changePassword(back.page, temporary, person.password);
  await expect(back.page.getByRole("status").filter({ hasText: "Password changed" })).toBeVisible();
  await back.context.close();
});

test("an administrator manages users but can't reset sign-in or connect Gmail", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await freshPage(browser);
  await signIn(page, "admin@dev.grandview.local", DEV_PASSWORD);
  await page.goto("/settings?tab=users");
  const row = page.getByRole("row").filter({ hasText: person.email });
  await expect(row.getByRole("button", { name: "Deactivate" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Set temporary password for|Reset two-step sign-in for/ })).toHaveCount(0);

  await page.goto("/api/integrations/google/start");
  await expect(page).toHaveURL(/gmail=error&reason=owner/);
  await expect(page.getByRole("region", { name: "Gmail" }).getByRole("alert")).toHaveText("Only the owner can connect or disconnect Gmail.");
  await page.goto("/api/integrations/google/callback?code=abc&state=forged");
  await expect(page).toHaveURL(/reason=owner/);
  await context.close();
});

test("the recovery page refuses a wrong code and works only once", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await freshPage(browser);
  const res = await page.goto("/recover");
  test.skip(res?.status() === 404, "OWNER_RECOVERY_CODE isn't set on this server");
  const code = process.env.OWNER_RECOVERY_CODE ?? "";
  const fill = async (c: string, email: string, password: string) => {
    await page.goto("/recover");
    await hydrated(page);
    await page.getByLabel("Recovery code").fill(c);
    await page.getByLabel("Your email").fill(email);
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("New password again").fill(password);
    await page.getByRole("button", { name: "Set new password" }).click();
  };
  await fill("not the code, but long enough to look like one", "owner@dev.grandview.local", "a-new-owner-password-1");
  await expect(page.getByRole("alert").filter({ hasText: "That recovery code doesn't match the one in Vercel." })).toBeVisible();
  test.skip(code.length < 32, "Set OWNER_RECOVERY_CODE for the test run too, to try a real recovery");

  // A second owner login, so the dev owner's saved session isn't signed out.
  const owner = await ownerPage(browser);
  const second = { name: `[TEST DATA] Second Owner ${run}`, email: `e2e-owner-${run}@example.com`, password: `recovered owner password ${run}` };
  await owner.page.goto("/settings?tab=users");
  await hydrated(owner.page);
  await owner.page.getByLabel("Name", { exact: true }).fill(second.name);
  await owner.page.getByLabel("Email", { exact: true }).fill(second.email);
  await owner.page.getByLabel("Role", { exact: true }).selectOption("owner");
  await owner.page.getByRole("button", { name: "Create account" }).click();
  await expect(owner.page.getByText(/Account created for/)).toBeVisible();

  await fill(code, second.email, second.password);
  await expect(page).toHaveURL(/\/login\?recovered=1/);
  await fill(code, second.email, "yet-another-password-1");
  await expect(page.getByRole("alert").filter({ hasText: "That recovery code has already been used." })).toBeVisible();

  // The new password works (and isn't a temporary one any more); every owner is told.
  await signIn(page, second.email, second.password);
  await expect(page).not.toHaveURL(/\/account\/security|\/login/);
  const notices = (await (await owner.page.request.get("/api/notifications")).json()) as { items: { title: string; body: string | null }[] };
  expect(notices.items.map((n) => n.title)).toContain(`The password for ${second.email} was reset on the recovery page`);
  await owner.context.close();
  await context.close();
});
