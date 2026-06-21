import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { getDatabasePool } from "./database";
import type { BookingService, VehicleType } from "./pricing";

export type TelegramManualBookingData = {
  name?: string;
  phone?: string;
  date?: string;
  time?: string;
  service?: BookingService;
  vehicleType?: VehicleType;
  address?: string;
  notes?: string;
  price?: string;
};

export type TelegramManualStep =
  | "name"
  | "phone"
  | "date"
  | "time"
  | "service"
  | "vehicleType"
  | "address"
  | "notes"
  | "price"
  | "confirm";

export type TelegramManualSession = {
  chatId: string;
  step: TelegramManualStep;
  data: TelegramManualBookingData;
  updatedAt: string;
};

let hasEnsuredTelegramSchema = false;

export async function getTelegramManualSession(chatId: string) {
  const db = getDatabasePool();

  if (db) {
    await ensureTelegramSchema(db);
    const result = await db.query<{ state_json: string }>("SELECT state_json FROM telegram_manual_sessions WHERE chat_id = $1 LIMIT 1", [chatId]);
    const row = result.rows[0];
    return row ? safeParseSession(row.state_json) : null;
  }

  const sessions = await readLocalSessions();
  return sessions[chatId] || null;
}

export async function saveTelegramManualSession(session: TelegramManualSession) {
  const db = getDatabasePool();

  if (db) {
    await ensureTelegramSchema(db);
    await db.query(
      `INSERT INTO telegram_manual_sessions (chat_id, state_json, updated_at)
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

export async function clearTelegramManualSession(chatId: string) {
  const db = getDatabasePool();

  if (db) {
    await ensureTelegramSchema(db);
    await db.query("DELETE FROM telegram_manual_sessions WHERE chat_id = $1", [chatId]);
    return;
  }

  const sessions = await readLocalSessions();
  delete sessions[chatId];
  await writeLocalSessions(sessions);
}

async function ensureTelegramSchema(db: Pool) {
  if (hasEnsuredTelegramSchema) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS telegram_manual_sessions (
      chat_id text PRIMARY KEY,
      state_json text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  hasEnsuredTelegramSchema = true;
}

function safeParseSession(value: string) {
  try {
    return JSON.parse(value) as TelegramManualSession;
  } catch {
    return null;
  }
}

async function readLocalSessions() {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "telegram-manual-sessions.json");
  await mkdir(dataDir, { recursive: true });

  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, TelegramManualSession>;
  } catch {
    return {};
  }
}

async function writeLocalSessions(sessions: Record<string, TelegramManualSession>) {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "telegram-manual-sessions.json");
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(sessions, null, 2));
}
