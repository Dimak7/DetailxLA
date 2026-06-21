import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { getDatabasePool } from "./database";

export type BusinessMetricsSettings = {
  marketingExpense: number;
  updatedAt: string;
};

const defaultSettings: BusinessMetricsSettings = {
  marketingExpense: 0,
  updatedAt: new Date(0).toISOString(),
};

let hasEnsuredBusinessMetricsSchema = false;

export async function getBusinessMetricsSettings(): Promise<BusinessMetricsSettings> {
  const db = getDatabasePool();

  if (db) {
    await ensureBusinessMetricsSchema(db);
    const result = await db.query<{ value: string; updated_at: Date | string }>(
      "SELECT value, updated_at FROM business_settings WHERE key = 'marketing_expense' LIMIT 1"
    );
    const row = result.rows[0];

    if (!row) {
      return defaultSettings;
    }

    return {
      marketingExpense: parseMoneyValue(row.value),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };
  }

  return readLocalBusinessMetricsSettings();
}

export async function updateBusinessMetricsSettings(input: { marketingExpense: number }) {
  if (!Number.isFinite(input.marketingExpense) || input.marketingExpense < 0) {
    throw new Error("Marketing expense must be a non-negative number.");
  }

  const settings: BusinessMetricsSettings = {
    marketingExpense: Math.round(input.marketingExpense),
    updatedAt: new Date().toISOString(),
  };
  const db = getDatabasePool();

  if (db) {
    await ensureBusinessMetricsSchema(db);
    await db.query(
      `INSERT INTO business_settings (key, value, updated_at)
       VALUES ('marketing_expense', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [String(settings.marketingExpense)]
    );
    return settings;
  }

  await writeLocalBusinessMetricsSettings(settings);
  return settings;
}

async function ensureBusinessMetricsSchema(db: Pool) {
  if (hasEnsuredBusinessMetricsSchema) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS business_settings (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  hasEnsuredBusinessMetricsSchema = true;
}

async function readLocalBusinessMetricsSettings() {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "business-metrics.json");
  await mkdir(dataDir, { recursive: true });

  try {
    const data = JSON.parse(await readFile(filePath, "utf8")) as Partial<BusinessMetricsSettings>;
    return {
      marketingExpense: parseMoneyValue(data.marketingExpense),
      updatedAt: data.updatedAt || defaultSettings.updatedAt,
    };
  } catch {
    return defaultSettings;
  }
}

async function writeLocalBusinessMetricsSettings(settings: BusinessMetricsSettings) {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "business-metrics.json");
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(settings, null, 2));
}

function parseMoneyValue(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}
