/**
 * "Sign now on this device": the office hands its screen to the customer. The proposal link
 * opened with this flag shows exactly what the customer sees at home, with signing switched
 * on, even though the browser is signed in as staff. Without it, staff get the read-only preview.
 */
const PARAM = "sign";
const VALUE = "device";

export function signOnDeviceLink(link: string): string {
  return `${link}${link.includes("?") ? "&" : "?"}${PARAM}=${VALUE}`;
}

export function proposalPageMode(signedIn: boolean, query: Record<string, string | string[] | undefined>): "customer" | "staff" {
  return signedIn && query[PARAM] !== VALUE ? "staff" : "customer";
}
