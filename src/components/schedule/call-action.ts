/**
 * Server actions return { ok: false, error } for every expected failure, but the
 * request itself can still fail (offline, a deploy in between). Inside a transition
 * that would surface as an uncaught error, so callers get a plain failure instead.
 */
export type CallFailed = { ok: false; error: string; reason?: undefined };

export const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection, refresh the page and try again.";

export async function callAction<T>(run: () => Promise<T>): Promise<T | CallFailed> {
  try {
    return await run();
  } catch (e) {
    console.error("[schedule] action failed", e);
    return { ok: false, error: OFFLINE_MESSAGE };
  }
}

/**
 * Close handler for a <dialog> rendered inside another one. React passes a nested
 * dialog's close event on to every onClose above it, which would also close the
 * outer dialog (the booking drawer); stop it at the inner one.
 */
export function innerDialogClose(close: () => void) {
  return (e?: { stopPropagation?: () => void }) => {
    e?.stopPropagation?.();
    close();
  };
}
