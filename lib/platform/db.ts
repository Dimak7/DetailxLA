import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import path from "node:path";
import { schema } from "./schema";
import { seed } from "./seed";

export type Query = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;
export type DB = {
  query: Query;
  transaction: <T>(fn: (q: Query) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};
const state = globalThis as typeof globalThis & { wlDB?: Promise<DB> };

export function database() {
  state.wlDB ??= connect().catch((error) => {
    state.wlDB = undefined;
    throw error;
  });
  return state.wlDB;
}
async function connect(): Promise<DB> {
  let db: DB;
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 10000,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: true }
          : undefined,
    });
    const query: Query = async (sql, params) => {
      const r = await pool.query(sql, params);
      return { rows: r.rows };
    };
    db = {
      query,
      close: () => pool.end(),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const out = await fn(async (sql, params) => ({
            rows: (await client.query(sql, params)).rows,
          }));
          await client.query("COMMIT");
          return out;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(82374510)");
      await client.query(schema);
    } finally {
      await client.query("SELECT pg_advisory_unlock(82374510)");
      client.release();
    }
  } else {
    if (
      process.env.NODE_ENV === "production" ||
      process.env.RAILWAY_ENVIRONMENT
    )
      throw new Error(
        "DATABASE_URL is required. Add a dedicated PostgreSQL database.",
      );
    const embedded = await PGlite.create(
      process.env.PGLITE_PATH ||
        path.join(process.cwd(), "data", "west-loop.pg"),
    );
    await embedded.exec(schema);
    db = {
      query: (sql, params) => embedded.query(sql, params),
      transaction: (fn) =>
        embedded.transaction((tx) =>
          fn((sql, params) => tx.query(sql, params)),
        ),
      close: () => embedded.close(),
    };
  }
  await seed(db.query);
  return db;
}
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
) {
  return (await (await database()).query<T>(sql, params)).rows;
}
export async function transaction<T>(fn: (q: Query) => Promise<T>) {
  return (await database()).transaction(fn);
}
export async function closeDatabase() {
  const db = await state.wlDB;
  await db?.close();
  state.wlDB = undefined;
}
