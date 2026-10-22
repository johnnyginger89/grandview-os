import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, unsavedMessage, type SaveResult } from "./autosave";

type Doc = { n: number };
const V0 = "2026-10-20T17:00:00.000Z";
const V1 = "2026-10-20T17:00:05.000Z";
const V2 = "2026-10-20T17:00:09.000Z";
const STALE = "This estimate was changed on another device or tab. Reload to see the latest.";

/** A save whose answer each test gives by hand. */
function server() {
  const calls: { doc: Doc; version: string; answer: (r: SaveResult) => void; fail: () => void }[] = [];
  const save = vi.fn(
    (doc: Doc, version: string) =>
      new Promise<SaveResult>((resolve, reject) => {
        calls.push({ doc, version, answer: resolve, fail: () => reject(new Error("offline")) });
      }),
  );
  return { save, calls };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("estimate autosave", () => {
  it("saves the latest document a moment after the last change, with the version it was based on", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    a.edit({ n: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    const latest = { n: 2 };
    a.edit(latest);
    expect(a.getState()).toMatchObject({ dirty: true, saving: false });
    await vi.advanceTimersByTimeAsync(1199);
    expect(s.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ doc: latest, version: V0 });
    expect(a.getState().saving).toBe(true);
    s.calls[0].answer({ ok: true, updatedAt: V1 });
    await settle();
    expect(a.getState()).toEqual({ version: V1, saved: latest, dirty: false, saving: false, error: null, conflict: null });
  });

  it("never runs two saves at once: a change made during a save goes next, with the new version", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    a.edit({ n: 1 });
    await vi.advanceTimersByTimeAsync(1200);
    const later = { n: 2 };
    a.edit(later);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.calls).toHaveLength(1);
    s.calls[0].answer({ ok: true, updatedAt: V1 });
    await settle();
    expect(a.getState().dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1200);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]).toMatchObject({ doc: later, version: V1 });
  });

  it("stops for good when the server says the screen is out of date, keeping what's on screen", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    const mine = { n: 1 };
    a.edit(mine);
    await vi.advanceTimersByTimeAsync(1200);
    s.calls[0].answer({ ok: false, error: STALE, conflict: true });
    await settle();
    expect(a.getState()).toMatchObject({ conflict: STALE, dirty: true, version: V0 });
    a.edit({ n: 2 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.calls).toHaveLength(1);
    expect(await a.flush()).toEqual({ ok: false, error: STALE });
    const sent = vi.fn();
    expect(await a.withSaved(sent)).toEqual({ ok: false, error: STALE });
    expect(sent).not.toHaveBeenCalled();
  });

  it("retries a failed save only after another change, or once when flushed", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    a.edit({ n: 1 });
    await vi.advanceTimersByTimeAsync(1200);
    s.calls[0].answer({ ok: false, error: "Enter a number" });
    await settle();
    expect(a.getState()).toMatchObject({ error: "Enter a number", dirty: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.calls).toHaveLength(1);

    const flushed = a.flush();
    await settle();
    expect(s.calls).toHaveLength(2);
    s.calls[1].answer({ ok: false, error: "Enter a number" });
    expect(await flushed).toEqual({ ok: false, error: unsavedMessage("Enter a number") });
    expect(unsavedMessage("Enter a number")).toBe("Your latest changes couldn't be saved (Enter a number). Fix that, then try again.");

    a.edit({ n: 2 });
    await vi.advanceTimersByTimeAsync(1200);
    expect(s.calls).toHaveLength(3);
    s.calls[2].answer({ ok: true, updatedAt: V1 });
    await settle();
    expect(a.getState()).toMatchObject({ error: null, dirty: false, version: V1 });
  });

  it("flush saves right away, waits for a save already under way, and gives the saved version", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    expect(await a.flush()).toEqual({ ok: true, version: V0 });
    a.edit({ n: 1 });
    await vi.advanceTimersByTimeAsync(1200);
    const newer = { n: 2 };
    a.edit(newer);
    const flushed = a.flush();
    s.calls[0].answer({ ok: true, updatedAt: V1 });
    await settle();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1]).toMatchObject({ doc: newer, version: V1 });
    s.calls[1].answer({ ok: true, updatedAt: V2 });
    expect(await flushed).toEqual({ ok: true, version: V2 });
  });

  it("withSaved saves first, holds autosave while the action runs, then carries on from the version it returns", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    a.edit({ n: 1 });
    let finish: (r: { ok: true; updatedAt: string }) => void = () => {};
    const send = vi.fn((version: string) => {
      expect(version).toBe(V1);
      return new Promise<{ ok: true; updatedAt: string; link: string }>((resolve) => (finish = (r) => resolve({ ...r, link: "https://x/share/p/abc" })));
    });
    const sent = a.withSaved(send);
    await settle();
    expect(s.calls).toHaveLength(1);
    s.calls[0].answer({ ok: true, updatedAt: V1 });
    await settle();
    expect(send).toHaveBeenCalledTimes(1);

    // Typed while the proposal is being sent: kept, but not saved until the send is done.
    const typed = { n: 2 };
    a.edit(typed);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.calls).toHaveLength(1);
    finish({ ok: true, updatedAt: V2 });
    expect(await sent).toMatchObject({ ok: true, link: "https://x/share/p/abc" });
    expect(a.getState().version).toBe(V2);
    await vi.advanceTimersByTimeAsync(1200);
    expect(s.calls[1]).toMatchObject({ doc: typed, version: V2 });
  });

  it("withSaved never runs the action when the latest changes can't be saved", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    a.edit({ n: 1 });
    const action = vi.fn(async () => ({ ok: true as const }));
    const r = a.withSaved(action);
    await settle();
    s.calls[0].answer({ ok: false, error: "Line area missing" });
    await settle();
    s.calls[1].answer({ ok: false, error: "Line area missing" });
    expect(await r).toEqual({ ok: false, error: unsavedMessage("Line area missing") });
    expect(action).not.toHaveBeenCalled();
  });

  it("an action refused as out of date stops autosave too", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    expect(await a.withSaved(async () => ({ ok: false as const, error: STALE, conflict: true }))).toMatchObject({ conflict: true });
    expect(a.getState().conflict).toBe(STALE);
    a.edit({ n: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.save).not.toHaveBeenCalled();
  });

  it("runs actions one at a time, each from the version the one before left", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    const seen: string[] = [];
    let release: () => void = () => {};
    const first = a.withSaved(async (v) => {
      seen.push(v);
      await new Promise<void>((r) => (release = r));
      return { ok: true as const, updatedAt: V1 };
    });
    const second = a.withSaved(async (v) => {
      seen.push(v);
      return { ok: true as const, updatedAt: V2 };
    });
    await settle();
    expect(seen).toEqual([V0]);
    release();
    await Promise.all([first, second]);
    expect(seen).toEqual([V0, V1]);
    expect(a.getState().version).toBe(V2);
  });

  it("reports a lost connection instead of throwing", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    a.edit({ n: 1 });
    await vi.advanceTimersByTimeAsync(1200);
    s.calls[0].fail();
    await settle();
    expect(a.getState().error).toMatch(/Couldn't reach the server/);

    const b = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    expect(await b.withSaved(async () => Promise.reject(new Error("offline")))).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't reach the server/) });
    expect(b.getState()).toMatchObject({ version: V0, conflict: null });
  });

  it("tells subscribers about changes, and only about changes", async () => {
    const s = server();
    const a = createAutosave<Doc>({ doc: { n: 0 }, version: V0, save: s.save });
    const heard = vi.fn();
    const stop = a.subscribe(heard);
    const before = a.getState();
    a.edit({ n: 1 });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(a.getState()).not.toBe(before);
    const dirty = a.getState();
    a.edit({ n: 2 });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(a.getState()).toBe(dirty);
    stop();
    await vi.advanceTimersByTimeAsync(1200);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
