/**
 * Browser-only: remember list choices in a cookie the server can read on the next
 * visit. Written here rather than by a Server Action because a cookie set by an
 * action re-renders the whole page, which would make every column toggle a round trip.
 */
import { encodeListPrefs, LIST_PREFS_COOKIE, type ListPrefs } from "./list-view";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function writeListPrefsCookie(p: ListPrefs): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LIST_PREFS_COOKIE}=${encodeListPrefs(p)}; Path=/leads; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
  } catch {
    // Not saving a preference is harmless; the choice still applies on this page.
  }
}
