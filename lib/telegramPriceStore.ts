import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { getDatabasePool } from "./database";
import type { BookingService, VehicleType } from "./pricing";

export type TelegramPriceUpdate = {
  service: BookingService;
  prices?: Partial<Record<VehicleType, number>>;
  startingPrice?: number;
};

export type TelegramPriceSession = {
  chatId: string;
  step: "service" | "overrideChoice" | "price" | "confirm";
  service?: BookingService;
  pendingUpdate?: TelegramPriceUpdate;
  updatedAt: string;
};

let hasEnsuredTelegramPriceSchema = false;

export async function getTelegramPriceSession(chatId: string) {
  const db = getDatabasePool();

  if (db) {
    await ensureTelegramPriceSchema(db);
    const result = await db.query<{ state_json: string }>(
      "SELECT state_json FROM telegram_price_sessions WHERE chat_id = $1 LIMIT 1",
      [chatId]
    );
    const row = result.rows[0];
    return row ? safeParseSession(row.state_json) : null;
  }

  const sessions = await readLocalSessions();
  return sessions[chatId] || null;
}

export async function saveTelegramPriceSession(session: TelegramPriceSession) {
  const db = getDatabasePool();

  if (db) {
    await ensureTelegramPriceSchema(db);
    await db.query(
      `INSERT INTO telegram_price_sessions (chat_id, state_json, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (chat_id)
       DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = now()`,
      [session.chatId, JSON.stringify(session)]
    );
    return;
  }

  const sessions = await readLocalSessions();
  sessions[session.chatId] = session;
  await writeLocalSessions(sessions);
}

export async function clearTelegramPriceSession(chatId: string) {
  const db = getDatabasePool();

  if (db) {
    await ensureTelegramPriceSchema(db);
    await db.query("DELETE FROM telegram_price_sessions WHERE chat_id = $1", [chatId]);
    return;
  }

  const sessions = await readLocalSessions();
  delete sessions[chatId];
  await writeLocalSessions(sessions);
}

async function ensureTelegramPriceSchema(db: Pool) {
  if (hasEnsuredTelegramPriceSchema) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS telegram_price_sessions (
      chat_id text PRIMARY KEY,
      state_json text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  hasEnsuredTelegramPriceSchema = true;
}

function safeParseSession(value: string) {
  try {
    return JSON.parse(value) as TelegramPriceSession;
  } catch {
    return null;
  }
}

async function readLocalSessions() {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "telegram-price-sessions.json");
  await mkdir(dataDir, { recursive: true });

  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, TelegramPriceSession>;
  } catch {
    return {};
  }
}

async function writeLocalSessions(sessions: Record<string, TelegramPriceSession>) {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "telegram-price-sessions.json");
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(sessions, null, 2));
}
