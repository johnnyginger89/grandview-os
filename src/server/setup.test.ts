import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));

const { setupTokenMatches, setupSchema } = await import("./setup");

describe("first-run setup", () => {
  const token = "x".repeat(40);
  it("accepts only the exact configured token", () => {
    expect(setupTokenMatches(token, token)).toBe(true);
    expect(setupTokenMatches(token + "y", token)).toBe(false);
    expect(setupTokenMatches("", token)).toBe(false);
  });
  it("is disabled when the configured token is missing or short", () => {
    expect(setupTokenMatches("short", "short")).toBe(false);
    expect(setupTokenMatches("", "")).toBe(false);
  });
  it("enforces the password policy", () => {
    const base = { token, name: "Owner", email: "owner@example.com" };
    expect(setupSchema.safeParse({ ...base, password: "short", confirm: "short" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, password: "a long enough password", confirm: "different password!!" }).success).toBe(false);
    expect(setupSchema.safeParse({ ...base, password: "a long enough password", confirm: "a long enough password" }).success).toBe(true);
  });
});
