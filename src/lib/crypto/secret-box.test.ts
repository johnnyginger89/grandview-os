import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { seal, unseal } = await import("./secret-box");

describe("secret box", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-that-is-long-enough-1234";
    delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("round-trips, and never stores the secret in the clear", () => {
    const sealed = seal("cc-token-abc123");
    expect(JSON.stringify(sealed)).not.toContain("cc-token-abc123");
    expect(unseal(sealed)).toBe("cc-token-abc123");
    expect(seal("cc-token-abc123").iv).not.toBe(sealed.iv);
  });

  it("refuses tampering, other keys and junk", () => {
    const sealed = seal("cc-token-abc123");
    const flipped = Buffer.from(sealed.data, "base64");
    flipped[0] ^= 1;
    expect(unseal({ ...sealed, data: flipped.toString("base64") })).toBeNull();
    process.env.INTEGRATIONS_ENCRYPTION_KEY = "a-different-key-for-integrations-5678";
    expect(unseal(sealed)).toBeNull();
    expect(unseal("cc-token-abc123")).toBeNull();
    expect(unseal(null)).toBeNull();
  });
});
