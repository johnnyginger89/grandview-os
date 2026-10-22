import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/email", () => ({ sendEmail: async () => ({ status: "logged", provider: "test" }) }));
const { trustedOrigins } = await import("./auth");

describe("addresses allowed to sign in", () => {
  it("adds the www twin of the main address, either way round", () => {
    expect(trustedOrigins("https://grandviewpainting.app", undefined)).toEqual(["https://www.grandviewpainting.app"]);
    expect(trustedOrigins("https://www.grandviewpainting.app/", undefined)).toEqual(["https://grandviewpainting.app"]);
  });

  it("keeps the extra addresses from the setting, and only https ones", () => {
    expect(trustedOrigins("https://grandviewpainting.app", "https://grandview-os.vercel.app/, http://evil.example.com, junk")).toEqual(["https://grandview-os.vercel.app", "https://www.grandviewpainting.app"]);
  });

  it("adds nothing for local or vercel.app addresses", () => {
    expect(trustedOrigins("http://localhost:3000", undefined)).toEqual([]);
    expect(trustedOrigins("https://grandview-os.vercel.app", undefined)).toEqual([]);
    expect(trustedOrigins(undefined, undefined)).toEqual([]);
  });
});
