/**
 * Command-line alternative to /setup for creating the first owner account.
 *
 *   pnpm create-owner --email you@grandviewpainting.ca --name "Your Name"
 *
 * Prints a one-time temporary password. Refuses if an owner already exists
 * unless --force-additional is passed.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name) {
    throw new Error('Usage: pnpm create-owner --email you@example.com --name "Your Name"');
  }
  const { db } = await import("../src/db");
  const { auth } = await import("../src/lib/auth");
  const { auditLog } = await import("../src/db/schema");
  const host = new URL(process.env.DATABASE_URL ?? "postgres://localhost").hostname;
  console.log(`Database: ${host}`);

  const owner = await db.query.user.findFirst({ where: (t, { eq }) => eq(t.role, "owner") });
  if (owner && !process.argv.includes("--force-additional")) throw new Error("An owner already exists. Use --force-additional to add another.");
  if (await db.query.user.findFirst({ where: (t, { eq }) => eq(t.email, email) })) throw new Error("That email already has an account.");

  const ctx = await auth.$context;
  const password = randomBytes(15).toString("base64url");
  const u = await ctx.internalAdapter.createUser({ email, name, emailVerified: true, role: "owner" }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: await ctx.password.hash(password) });
  await db.insert(auditLog).values({ actorId: u.id, action: "setup.cli_owner", entityType: "user", entityId: u.id, after: { email } });
  console.log(`\nOwner created: ${email}\nTemporary password (shown once): ${password}\nSign in, then change it with "Forgot password" and set up two-factor authentication.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
