import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { safeErrorMessage } from "./action-error";

describe("safeErrorMessage", () => {
  it("keeps deliberate messages", () => {
    expect(safeErrorMessage(new Error("This lead has no email address."))).toBe("This lead has no email address.");
  });
  it("keeps app errors that opt in, even with minified class names", () => {
    class X extends Error { readonly expose = true; }
    expect(safeErrorMessage(new X("You don't have permission to do that."))).toBe("You don't have permission to do that.");
  });
  it("formats validation errors", () => {
    const r = z.object({ name: z.string().min(1, "Name is required") }).safeParse({ name: "" });
    expect(safeErrorMessage(r.error)).toBe("name: Name is required");
  });
  it("hides database and library errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    class PostgresError extends Error {
      code = "23505";
      constructor(m: string) { super(m); this.name = "PostgresError"; }
    }
    expect(safeErrorMessage(new PostgresError('duplicate key value violates unique constraint "x"'))).not.toContain("duplicate");
    const withCode = Object.assign(new Error("password authentication failed for user postgres"), { code: "28P01" });
    expect(safeErrorMessage(withCode)).not.toContain("password");
    expect(safeErrorMessage("boom")).toMatch(/Something went wrong/);
    spy.mockRestore();
  });
});
