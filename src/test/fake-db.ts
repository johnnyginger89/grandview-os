/**
 * A stand-in for the Drizzle `db` in unit tests. Every query chain records its
 * operation, base table and method arguments, and resolves to whatever the test's
 * resolver returns (by default, the next queued result for "op:table", else []).
 * Relational queries (`db.query.<table>.findFirst/findMany`) are selects on that
 * table; findFirst resolves to the first row. Transactions run their callback with
 * the same fake.
 */
import { getTableName, isTable } from "drizzle-orm";
import * as schema from "@/db/schema";

export type FakeOp = "select" | "insert" | "update" | "delete" | "execute";

export interface FakeCall {
  op: FakeOp;
  table: string | null;
  /** Arguments of each chained method, e.g. args.values[0], args.set[0], args.select[0] (the selected fields). */
  args: Record<string, unknown[]>;
}

const tableName = (t: unknown) => (t && typeof t === "object" && isTable(t) ? getTableName(t) : null);

export function createFakeDb() {
  const calls: FakeCall[] = [];
  let queues = new Map<string, unknown[][]>();
  let fallback: (call: FakeCall) => unknown = () => [];

  function resolve(call: FakeCall): unknown {
    const q = queues.get(`${call.op}:${call.table}`);
    if (q?.length) return q.shift();
    return fallback(call);
  }

  function chain(op: FakeOp, table?: unknown, args: Record<string, unknown[]> = {}) {
    const call: FakeCall = { op, table: tableName(table), args };
    calls.push(call);
    const proxy: object = new Proxy(
      {},
      {
        get(_t, prop) {
          if (typeof prop === "symbol") return undefined;
          if (prop === "then") {
            return (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              Promise.resolve()
                .then(() => resolve(call))
                .then(onFulfilled, onRejected);
          }
          return (...a: unknown[]) => {
            call.args[prop] = a;
            if (prop === "from" && !call.table) call.table = tableName(a[0]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  function relational(key: string) {
    const table = tableName((schema as Record<string, unknown>)[key]) ?? key;
    const run = (method: "findFirst" | "findMany") => (opts?: unknown) => {
      const call: FakeCall = { op: "select", table, args: { [method]: [opts] } };
      calls.push(call);
      return Promise.resolve()
        .then(() => resolve(call))
        .then((rows) => (method === "findFirst" && Array.isArray(rows) ? rows[0] : rows));
    };
    return { findFirst: run("findFirst"), findMany: run("findMany") };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select: (...a: unknown[]) => chain("select", undefined, { select: a }),
    selectDistinct: (...a: unknown[]) => chain("select", undefined, { selectDistinct: a }),
    insert: (t: unknown) => chain("insert", t),
    update: (t: unknown) => chain("update", t),
    delete: (t: unknown) => chain("delete", t),
    execute: () => chain("execute"),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    query: new Proxy({}, { get: (_t, key) => (typeof key === "symbol" ? undefined : relational(key)) }),
  };

  return {
    db,
    calls,
    /** Queue results per "op:table", consumed in call order. */
    queue(results: Record<string, unknown[][]>) {
      for (const [k, v] of Object.entries(results)) queues.set(k, [...(queues.get(k) ?? []), ...v]);
    },
    otherwise(fn: (call: FakeCall) => unknown) {
      fallback = fn;
    },
    reset() {
      calls.length = 0;
      queues = new Map();
      fallback = () => [];
    },
    find(op: FakeOp, table: string) {
      return calls.filter((c) => c.op === op && c.table === table);
    },
  };
}

export type FakeDb = ReturnType<typeof createFakeDb>;
