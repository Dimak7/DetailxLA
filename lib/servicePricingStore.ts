import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { getDatabasePool } from "./database";
import {
  getServicePricing,
  resolvePricedServices,
  type BookingService,
  type PricedService,
  type ServicePriceOverride,
  type VehicleType,
} from "./pricing";

type ServicePricingRow = {
  service_title: BookingService;
  prices_json: string | null;
  starting_price: number | string | null;
};

let hasEnsuredServicePricingSchema = false;

export async function getPricedServices() {
  const overrides = await listServicePriceOverrides();
  return resolvePricedServices(overrides);
}

export async function listServicePriceOverrides() {
  const db = getDatabasePool();

  if (db) {
    await ensureServicePricingSchema(db);
    const result = await db.query<ServicePricingRow>(
      `SELECT service_title, prices_json, starting_price
       FROM service_price_overrides`
    );

    return result.rows.reduce<Partial<Record<BookingService, ServicePriceOverride>>>((acc, row) => {
      acc[row.service_title] = {
        prices: safeJsonParse(row.prices_json),
        startingPrice: row.starting_price === null ? undefined : Number(row.starting_price),
      };
      return acc;
    }, {});
  }

  return readLocalOverrides();
}

export async function updateServicePricing(
  serviceTitle: BookingService,
  nextPricing: { prices?: Partial<Record<VehicleType, number>>; startingPrice?: number }
) {
  const db = getDatabasePool();

  if (db) {
    await ensureServicePricingSchema(db);
    await db.query(
      `INSERT INTO service_price_overrides (service_title, prices_json, starting_price)
       VALUES ($1, $2, $3)
       ON CONFLICT (service_title)
       DO UPDATE SET prices_json = EXCLUDED.prices_json, starting_price = EXCLUDED.starting_price`,
      [
        serviceTitle,
        nextPricing.prices ? JSON.stringify(nextPricing.prices) : null,
        nextPricing.startingPrice ?? null,
      ]
    );
  } else {
    const overrides = await readLocalOverrides();
    overrides[serviceTitle] = nextPricing;
    await writeLocalOverrides(overrides);
  }

  const services = await getPricedServices();
  return getServicePricing(serviceTitle, services) as PricedService;
}

async function ensureServicePricingSchema(db: Pool) {
  if (hasEnsuredServicePricingSchema) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS service_price_overrides (
      service_title text PRIMARY KEY,
      prices_json text,
      starting_price numeric
    )
  `);

  hasEnsuredServicePricingSchema = true;
}

async function readLocalOverrides() {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "service-price-overrides.json");
  await mkdir(dataDir, { recursive: true });

  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Partial<Record<BookingService, ServicePriceOverride>>;
  } catch {
    return {};
  }
}

async function writeLocalOverrides(overrides: Partial<Record<BookingService, ServicePriceOverride>>) {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "service-price-overrides.json");
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(overrides, null, 2));
}

function safeJsonParse(value: string | null) {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as Partial<Record<VehicleType, number>>;
  } catch {
    return undefined;
  }
}
