/**
 * Autosave for the estimate editor, kept free of React so it can be tested on its own.
 *
 * Saves run one at a time, a moment after the last change, and each carries the version
 * (estimates.updatedAt) the screen's copy is based on. When the server refuses one because
 * another device or tab changed the estimate first, autosave stops for good: the screen keeps
 * what the user sees, but never overwrites the newer work. Actions that freeze or change the
 * saved copy (send, mark accepted, status changes) go through `withSaved`, which saves what's on
 * screen first and holds autosave until the action is done.
 */

export type SaveResult = { ok: true; updatedAt: string } | { ok: false; error: string; conflict?: boolean };
/** An action's result: the estimate's new version if it changed it, or a refusal because the screen is out of date. */
export type Outcome = { ok: true; updatedAt?: string } | { ok: false; error: string; conflict?: boolean };
export type Failure = { ok: false; error: string };
export type WithSaved = <R extends Outcome>(action: (version: string) => Promise<R>) => Promise<R | Failure>;

export interface AutosaveState<D> {
  /** Version of the copy the server has. */
  version: string;
  /** The document the server has, so a screen can tell straight away that what it shows differs. */
  saved: D;
  /** Changes on screen the server doesn't have yet. */
  dirty: boolean;
  saving: boolean;
  /** Why the last save failed; cleared by the next good save. */
  error: string | null;
  /** The screen is out of date (changed elsewhere, or accepted): nothing more is saved until a reload. */
  conflict: string | null;
}

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

export function unsavedMessage(error: string | null): string {
  return error ? `Your latest changes couldn't be saved (${error.replace(/\.$/, "")}). Fix that, then try again.` : "Your latest changes couldn't be saved. Try again.";
}

export function createAutosave<D>(opts: { doc: D; version: string; save: (doc: D, version: string) => Promise<SaveResult>; delayMs?: number }) {
  const delay = opts.delayMs ?? 1200;
  let latest = opts.doc;
  let saved = opts.doc;
  /** A document whose save failed is only retried once it changes, or by a flush. */
  let failed: D | null = null;
  let version = opts.version;
  let error: string | null = null;
  let conflict: string | null = null;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let holds = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();

  const snapshot = (): AutosaveState<D> => ({ version, saved, dirty: latest !== saved, saving: inFlight !== null, error, conflict });
  let state = snapshot();

  function emit() {
    const next = snapshot();
    const same = (Object.keys(next) as (keyof AutosaveState<D>)[]).every((k) => next[k] === state[k]);
    if (same) return;
    state = next;
    for (const l of listeners) l();
  }

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    cancel();
    if (conflict || holds > 0 || inFlight || latest === saved || latest === failed) return;
    timer = setTimeout(() => {
      timer = null;
      void saveNow();
    }, delay);
  }

  function saveNow(): Promise<void> {
    if (inFlight) return inFlight;
    if (conflict || latest === saved) return Promise.resolve();
    const doc = latest;
    inFlight = (async () => {
      let r: SaveResult;
      try {
        r = await opts.save(doc, version);
      } catch {
        r = { ok: false, error: OFFLINE };
      }
      if (r.ok) {
        version = r.updatedAt;
        saved = doc;
        error = null;
        failed = null;
      } else if (r.conflict) conflict = r.error;
      else {
        error = r.error;
        failed = doc;
      }
    })().finally(() => {
      inFlight = null;
      emit();
      schedule();
    });
    emit();
    return inFlight;
  }

  /** Saves everything on screen now (retrying a failed save once) and gives the saved version. */
  async function flush(): Promise<{ ok: true; version: string } | Failure> {
    holds++;
    cancel();
    try {
      let retried = false;
      for (;;) {
        if (inFlight) {
          await inFlight;
          continue;
        }
        if (conflict) return { ok: false, error: conflict };
        if (latest === saved) return { ok: true, version };
        if (latest === failed) {
          if (retried) return { ok: false, error: unsavedMessage(error) };
          retried = true;
          failed = null;
        }
        await saveNow();
      }
    } finally {
      holds--;
      schedule();
    }
  }

  async function runHeld<R extends Outcome>(action: (version: string) => Promise<R>): Promise<R | Failure> {
    let outcome: R | undefined;
    try {
      const f = await flush();
      if (!f.ok) return f;
      outcome = await action(f.version);
      return outcome;
    } catch {
      return { ok: false, error: OFFLINE };
    } finally {
      if (outcome?.ok && outcome.updatedAt) version = outcome.updatedAt;
      else if (outcome && !outcome.ok && outcome.conflict) conflict = outcome.error;
      holds--;
      emit();
      schedule();
    }
  }

  /** Saves what's on screen, then runs `action` with autosave held, one action at a time. */
  const withSaved: WithSaved = (action) => {
    holds++;
    cancel();
    const run = queue.then(() => runHeld(action));
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    /** The document on screen changed. */
    edit(doc: D) {
      if (doc !== latest) {
        latest = doc;
        emit();
      }
      schedule();
    },
    flush,
    withSaved,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
  };
}
