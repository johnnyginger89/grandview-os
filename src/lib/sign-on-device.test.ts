import { describe, expect, it } from "vitest";
import { proposalPageMode, signOnDeviceLink } from "./sign-on-device";

describe("sign now on this device", () => {
  it("adds the flag to the proposal link", () => {
    expect(signOnDeviceLink("https://os.grandviewpainting.ca/share/p/abcDEF123_-xyz789abcdef")).toBe("https://os.grandviewpainting.ca/share/p/abcDEF123_-xyz789abcdef?sign=device");
    expect(signOnDeviceLink("/share/p/abc?x=1")).toBe("/share/p/abc?x=1&sign=device");
  });

  it("shows signed-in staff the customer's page only when they asked to sign on this device", () => {
    expect(proposalPageMode(true, {})).toBe("staff");
    expect(proposalPageMode(true, { sign: "device" })).toBe("customer");
    expect(proposalPageMode(true, { sign: "yes" })).toBe("staff");
    expect(proposalPageMode(true, { sign: ["device", "device"] })).toBe("staff");
  });

  it("always shows customers their page, flag or not", () => {
    expect(proposalPageMode(false, {})).toBe("customer");
    expect(proposalPageMode(false, { sign: "device" })).toBe("customer");
  });
});
