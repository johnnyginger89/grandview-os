import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: { options: { advanced: { ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"] } } } } }));

const { requestMeta } = await import("./request-meta");

describe("where a request came from", () => {
  it("takes the IP from Vercel's own header first, as the sign-in limits do", () => {
    expect(requestMeta(new Headers({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.1", "user-agent": "Mozilla/5.0" }))).toEqual({ ip: "203.0.113.7", userAgent: "Mozilla/5.0" });
    expect(requestMeta(new Headers({ "x-forwarded-for": "198.51.100.1" })).ip).toBe("198.51.100.1");
  });

  it("doesn't trust a forwarded list a browser could have started", () => {
    // Off Vercel (here, tests) an untrusted list falls back to the local address instead.
    expect(requestMeta(new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.1" })).ip).not.toBe("6.6.6.6");
  });

  it("keeps the browser description on one short line", () => {
    const meta = requestMeta(new Headers({ "user-agent": `Odd\tbrowser ${"a".repeat(400)}` }));
    expect(meta.userAgent).toMatch(/^Odd browser a+$/);
    expect(meta.userAgent).toHaveLength(300);
    expect(requestMeta(new Headers()).userAgent).toBeNull();
  });
});
