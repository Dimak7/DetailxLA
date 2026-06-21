import { Pool } from "pg";

let pool: Pool | null = null;

export function isDatabaseRequired() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

export function getDatabasePool() {
  if (!process.env.DATABASE_URL) {
    if (isDatabaseRequired()) {
      throw new Error("DATABASE_URL is required in production. Persistent booking storage is not configured.");
    }

    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}
