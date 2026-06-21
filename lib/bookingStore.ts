import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Pool } from "pg";
import { bookingServices, type BookingInput, vehicleTypes } from "./bookingSchema";
import { getDatabasePool } from "./database";
import {
  addHoursToTimeSlot,
  assertTimeRange,
  doTimeRangesOverlap,
  isSlotWithinRange,
  isTimeSlot,
  timeSlots,
  type SlotAvailability,
  type TimeSlot,
} from "./schedule";

export type StoredBooking = BookingInput & {
  id: string;
  createdAt: string;
  status: BookingStatus;
};

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";

type DatabaseBookingRow = {
  id: string;
  service: string;
  booking_date: Date | string;
  booking_time: string;
  name: string;
  phone: string;
  email: string;
  car_model: string | null;
  vehicle_type: string;
  address: string;
  estimated_price: string | null;
  notes: string | null;
  details_json: string | null;
  duration_hours: number | string | null;
  status: string | null;
  source: string | null;
  created_at: Date | string;
};

export type ScheduleBlock = {
  id: string;
  date: string;
  time: TimeSlot;
  startTime: string;
  endTime: string;
  reason: string;
  createdAt: string;
};

let hasEnsuredSchema = false;

export async function saveBooking(booking: BookingInput) {
  const storedBooking: StoredBooking = {
    ...booking,
    email: booking.email || "",
    carModel: booking.carModel || "",
    durationHours: getBookingDurationHours(booking.durationHours),
    source: booking.source || "website",
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
  };

  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    await saveToDatabase(db, storedBooking);
    return storedBooking;
  }

  await saveToLocalJsonWithAvailability(storedBooking);
  return storedBooking;
}

export async function getAvailability(date: string): Promise<SlotAvailability[]> {
  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    const [bookings, blocks] = await Promise.all([
      db.query<{ booking_time: string; duration_hours: number | string | null }>(
        "SELECT booking_time, duration_hours FROM bookings WHERE booking_date = $1 AND status IN ('pending', 'booked', 'confirmed')",
        [date]
      ),
      db.query<{ block_time: string; start_time: string | null; end_time: string | null }>(
        "SELECT block_time, start_time, end_time FROM schedule_blocks WHERE block_date = $1 AND status = 'blocked'",
        [date]
      ),
    ]);
    const bookedTimes = new Set(bookings.rows.flatMap((row) => getSlotsForBookingWindow(row.booking_time, row.duration_hours)));
    const blockedTimes = getBlockedTimeSet(blocks.rows.map((row) => ({
      startTime: row.start_time || row.block_time,
      endTime: row.end_time || getNextTimeSlot(row.block_time),
    })));

    return buildAvailability(bookedTimes, blockedTimes);
  }

  const bookings = await readLocalBookings();
  const bookedTimes = new Set(
    bookings
      .filter((booking) => booking.date === date && isActiveBookingStatus(booking.status))
      .flatMap((booking) => getSlotsForBookingWindow(booking.time, booking.durationHours))
  );
  const blockedTimes = getBlockedTimeSet(
    (await readLocalBlocks())
      .filter((block) => block.date === date)
      .map((block) => ({ startTime: block.startTime || block.time, endTime: block.endTime || getNextTimeSlot(block.time) }))
  );

  return buildAvailability(bookedTimes, blockedTimes);
}

export async function listBookingsByDate(date: string) {
  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    const result = await db.query<DatabaseBookingRow>(
      `SELECT id, service, booking_date, booking_time, name, phone, email, car_model, vehicle_type, address,
        estimated_price, notes, details_json, duration_hours, status, source, created_at
       FROM bookings
       WHERE booking_date = $1
       ORDER BY booking_time ASC, created_at DESC`,
      [date]
    );

    return result.rows.map(mapDatabaseBooking);
  }

  return (await readLocalBookings())
    .filter((booking) => booking.date === date)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export async function listBookings(filters: { date?: string; status?: BookingStatus | "all"; service?: string; search?: string } = {}) {
  const db = getDatabasePool();
  const clauses: string[] = [];
  const values: string[] = [];

  if (filters.date) {
    values.push(filters.date);
    clauses.push(`booking_date = $${values.length}`);
  }

  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }

  if (filters.service && filters.service !== "all") {
    values.push(filters.service);
    clauses.push(`service = $${values.length}`);
  }

  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(`(name ILIKE $${values.length} OR email ILIKE $${values.length} OR phone ILIKE $${values.length})`);
  }

  if (db) {
    await ensureSchema(db);
    const result = await db.query<DatabaseBookingRow>(
      `SELECT id, service, booking_date, booking_time, name, phone, email, car_model, vehicle_type, address,
        estimated_price, notes, details_json, duration_hours, status, source, created_at
       FROM bookings
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY booking_date DESC, booking_time ASC, created_at DESC
       LIMIT 500`,
      values
    );

    return result.rows.map(mapDatabaseBooking);
  }

  const search = filters.search?.toLowerCase() || "";
  return (await readLocalBookings())
    .filter((booking) => !filters.date || booking.date === filters.date)
    .filter((booking) => !filters.status || filters.status === "all" || booking.status === filters.status)
    .filter((booking) => !filters.service || filters.service === "all" || booking.service === filters.service)
    .filter((booking) => !search || [booking.name, booking.email, booking.phone].some((value) => value.toLowerCase().includes(search)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.time.localeCompare(b.time))
    .slice(0, 500);
}

export async function getBookingById(id: string) {
  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    const result = await db.query<DatabaseBookingRow>(
      `SELECT id, service, booking_date, booking_time, name, phone, email, car_model, vehicle_type, address,
        estimated_price, notes, details_json, duration_hours, status, source, created_at
       FROM bookings
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    const row = result.rows[0];
    return row ? mapDatabaseBooking(row) : null;
  }

  return (await readLocalBookings()).find((booking) => booking.id === id) || null;
}

export async function listScheduleBlocks(date: string) {
  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    const result = await db.query(
      `SELECT id, block_date, block_time, start_time, end_time, reason, created_at
       FROM schedule_blocks
       WHERE block_date = $1 AND status = 'blocked'
       ORDER BY COALESCE(start_time, block_time) ASC`,
      [date]
    );

    return result.rows.map((row) => ({
      id: row.id,
      date: formatDatabaseDate(row.block_date),
      time: row.block_time,
      startTime: row.start_time || row.block_time,
      endTime: row.end_time || getNextTimeSlot(row.block_time),
      reason: row.reason || "",
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    })) as ScheduleBlock[];
  }

  return (await readLocalBlocks()).filter((block) => block.date === date);
}

export async function createScheduleBlock(input: { date: string; time?: string; startTime?: string; endTime?: string; reason?: string }) {
  const startTime = input.startTime || input.time || "";
  const endTime = input.endTime || getNextTimeSlot(startTime);
  assertTimeRange(startTime, endTime);

  const block: ScheduleBlock = {
    id: randomUUID(),
    date: input.date,
    time: startTime as TimeSlot,
    startTime,
    endTime,
    reason: input.reason?.trim() || "Unavailable",
    createdAt: new Date().toISOString(),
  };
  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    await db.query("BEGIN");
    try {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${block.date}:${block.startTime}:${block.endTime}`]);
      const booked = await db.query(
        "SELECT booking_time, duration_hours FROM bookings WHERE booking_date = $1 AND status IN ('pending', 'booked', 'confirmed')",
        [block.date]
      );
      const blocked = await hasDatabaseRangeBlockConflict(db, block.date, block.startTime, block.endTime);

      if (booked.rows.some((row) => doTimeRangesOverlap(row.booking_time, getBookingEndTime(row.booking_time, row.duration_hours), block.startTime, block.endTime))) {
        throw new Error("That time range already has a booking.");
      }

      if (blocked) {
        throw new Error("That time range already has a block.");
      }

      await db.query(
        `INSERT INTO schedule_blocks (id, block_date, block_time, start_time, end_time, reason, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'blocked', $7)`,
        [block.id, block.date, block.time, block.startTime, block.endTime, block.reason, block.createdAt]
      );
      await db.query("COMMIT");
      return block;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }

  const bookings = await readLocalBookings();
  if (bookings.some((booking) => booking.date === block.date && isActiveBookingStatus(booking.status) && doTimeRangesOverlap(booking.time, getBookingEndTime(booking.time, booking.durationHours), block.startTime, block.endTime))) {
    throw new Error("That time range already has a booking.");
  }

  const blocks = await readLocalBlocks();
  if (blocks.some((item) => item.date === block.date && doTimeRangesOverlap(block.startTime, block.endTime, item.startTime || item.time, item.endTime || getNextTimeSlot(item.time)))) {
    throw new Error("That time range already has a block.");
  }
  blocks.push(block);
  await writeLocalBlocks(blocks);
  return block;
}

export async function updateScheduleBlock(id: string, input: { date: string; startTime: string; endTime: string; reason?: string }) {
  assertTimeRange(input.startTime, input.endTime);
  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    await db.query("BEGIN");
    try {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${input.date}:${input.startTime}:${input.endTime}`]);
      const booked = await db.query(
        "SELECT booking_time, duration_hours FROM bookings WHERE booking_date = $1 AND status IN ('pending', 'booked', 'confirmed')",
        [input.date]
      );
      const blocked = await hasDatabaseRangeBlockConflict(db, input.date, input.startTime, input.endTime, id);

      if (booked.rows.some((row) => doTimeRangesOverlap(row.booking_time, getBookingEndTime(row.booking_time, row.duration_hours), input.startTime, input.endTime))) {
        throw new Error("That time range already has a booking.");
      }

      if (blocked) {
        throw new Error("That time range already has another block.");
      }

      await db.query(
        `UPDATE schedule_blocks
         SET block_date = $2, block_time = $3, start_time = $3, end_time = $4, reason = $5
         WHERE id = $1`,
        [id, input.date, input.startTime, input.endTime, input.reason?.trim() || "Unavailable"]
      );
      await db.query("COMMIT");
      return;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }

  const blocks = await readLocalBlocks();
  const bookings = await readLocalBookings();
  if (bookings.some((booking) => booking.date === input.date && isActiveBookingStatus(booking.status) && doTimeRangesOverlap(booking.time, getBookingEndTime(booking.time, booking.durationHours), input.startTime, input.endTime))) {
    throw new Error("That time range already has a booking.");
  }
  if (blocks.some((block) => block.id !== id && block.date === input.date && doTimeRangesOverlap(input.startTime, input.endTime, block.startTime || block.time, block.endTime || getNextTimeSlot(block.time)))) {
    throw new Error("That time range already has another block.");
  }
  const next = blocks.map((block) => block.id === id ? {
    ...block,
    date: input.date,
    time: input.startTime as TimeSlot,
    startTime: input.startTime,
    endTime: input.endTime,
    reason: input.reason?.trim() || "Unavailable",
  } : block);
  await writeLocalBlocks(next);
}

export async function deleteScheduleBlock(id: string) {
  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    await db.query("UPDATE schedule_blocks SET status = 'canceled' WHERE id = $1", [id]);
    return;
  }

  await writeLocalBlocks((await readLocalBlocks()).filter((block) => block.id !== id));
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    if (status === "pending" || status === "confirmed") {
      await db.query("BEGIN");
      try {
        const current = await db.query<{ booking_date: Date | string; booking_time: string; duration_hours: number | string | null; status: string | null }>(
          "SELECT booking_date, booking_time, duration_hours, status FROM bookings WHERE id = $1 LIMIT 1",
          [id]
        );
        const booking = current.rows[0];

        if (!booking) {
          throw new Error("Booking was not found.");
        }

        assertStatusTransition(normalizeBookingStatus(booking.status), status);
        const date = formatDatabaseDate(booking.booking_date);
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${date}:${booking.booking_time}`]);
        const conflict = await db.query<{ id: string; booking_time: string; duration_hours: number | string | null }>(
          "SELECT id, booking_time, duration_hours FROM bookings WHERE booking_date = $1 AND id <> $2 AND status IN ('pending', 'booked', 'confirmed')",
          [date, id]
        );
        const block = await hasDatabaseBlockConflict(db, date, booking.booking_time, booking.duration_hours);

        if (conflict.rows.some((row) => doTimeRangesOverlap(booking.booking_time, getBookingEndTime(booking.booking_time, booking.duration_hours), row.booking_time, getBookingEndTime(row.booking_time, row.duration_hours))) || block) {
          throw new Error("That slot is not available.");
        }

        await db.query("UPDATE bookings SET status = $2 WHERE id = $1", [id, status]);
        await db.query("COMMIT");
        return;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    }

    const current = await db.query<{ status: string | null }>("SELECT status FROM bookings WHERE id = $1 LIMIT 1", [id]);
    const existing = current.rows[0];
    if (!existing) {
      throw new Error("Booking was not found.");
    }
    assertStatusTransition(normalizeBookingStatus(existing.status), status);
    await db.query("UPDATE bookings SET status = $2 WHERE id = $1", [id, status]);
    return;
  }

  const bookings = await readLocalBookings();
  const target = bookings.find((booking) => booking.id === id);

  if (!target) {
    throw new Error("Booking was not found.");
  }

  assertStatusTransition(target.status, status);

  if (status === "pending" || status === "confirmed") {
    const conflict = bookings.some(
      (booking) =>
        booking.id !== id &&
        booking.date === target.date &&
        isActiveBookingStatus(booking.status) &&
        doTimeRangesOverlap(target.time, getBookingEndTime(target.time, target.durationHours), booking.time, getBookingEndTime(booking.time, booking.durationHours))
    );

    const blocks = await readLocalBlocks();
    const blocked = blocks.some((block) => block.date === target.date && doTimeRangesOverlap(target.time, getBookingEndTime(target.time, target.durationHours), block.startTime || block.time, block.endTime || getNextTimeSlot(block.time)));

    if (conflict || blocked) {
      throw new Error("That slot is not available.");
    }
  }

  await writeLocalBookings(bookings.map((booking) => booking.id === id ? { ...booking, status } : booking));
}

export async function updateBookingSchedule(id: string, input: { date: string; time: string }) {
  if (!isTimeSlot(input.time)) {
    throw new Error("Choose a valid time slot.");
  }

  const db = getDatabasePool();

  if (db) {
    await ensureSchema(db);
    await db.query("BEGIN");
    try {
      const current = await db.query<{ status: string | null; duration_hours: number | string | null }>("SELECT status, duration_hours FROM bookings WHERE id = $1 LIMIT 1", [id]);
      const booking = current.rows[0];

      if (!booking) {
        throw new Error("Booking was not found.");
      }

      if (!isActiveBookingStatus(normalizeBookingStatus(booking.status))) {
        throw new Error("Only pending or confirmed bookings can be rescheduled.");
      }

      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${input.date}:${input.time}`]);
      const conflict = await db.query<{ id: string; booking_time: string; duration_hours: number | string | null }>(
        "SELECT id, booking_time, duration_hours FROM bookings WHERE booking_date = $1 AND id <> $2 AND status IN ('pending', 'booked', 'confirmed')",
        [input.date, id]
      );
      const durationHours = getBookingDurationHours(booking.duration_hours);
      const block = await hasDatabaseBlockConflict(db, input.date, input.time, durationHours);

      if (conflict.rows.some((row) => doTimeRangesOverlap(input.time, getBookingEndTime(input.time, durationHours), row.booking_time, getBookingEndTime(row.booking_time, row.duration_hours))) || block) {
        throw new Error("That slot is not available.");
      }

      await db.query("UPDATE bookings SET booking_date = $2, booking_time = $3 WHERE id = $1", [id, input.date, input.time]);
      await db.query("COMMIT");
      return;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }

  const bookings = await readLocalBookings();
  const target = bookings.find((booking) => booking.id === id);

  if (!target) {
    throw new Error("Booking was not found.");
  }

  if (!isActiveBookingStatus(target.status)) {
    throw new Error("Only pending or confirmed bookings can be rescheduled.");
  }

  const blocks = await readLocalBlocks();
  const conflict =
    bookings.some((booking) => booking.id !== id && booking.date === input.date && isActiveBookingStatus(booking.status) && doTimeRangesOverlap(input.time, getBookingEndTime(input.time, target.durationHours), booking.time, getBookingEndTime(booking.time, booking.durationHours))) ||
    blocks.some((block) => block.date === input.date && doTimeRangesOverlap(input.time, getBookingEndTime(input.time, target.durationHours), block.startTime || block.time, block.endTime || getNextTimeSlot(block.time)));

  if (conflict) {
    throw new Error("That slot is not available.");
  }

  await writeLocalBookings(bookings.map((booking) => booking.id === id ? { ...booking, date: input.date, time: input.time as TimeSlot } : booking));
}

async function saveToDatabase(db: Pool, storedBooking: StoredBooking) {
  await db.query("BEGIN");
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${storedBooking.date}:${storedBooking.time}`]);
    const existingBooking = await db.query<{ booking_time: string; duration_hours: number | string | null }>(
      "SELECT booking_time, duration_hours FROM bookings WHERE booking_date = $1 AND status IN ('pending', 'booked', 'confirmed')",
      [storedBooking.date]
    );
    const block = await hasDatabaseBlockConflict(db, storedBooking.date, storedBooking.time, storedBooking.durationHours);

    if (existingBooking.rows.some((row) => doTimeRangesOverlap(storedBooking.time, getBookingEndTime(storedBooking.time, storedBooking.durationHours), row.booking_time, getBookingEndTime(row.booking_time, row.duration_hours))) || block) {
      throw new Error("This time is no longer available. Please choose another slot.");
    }

    await db.query(
      `INSERT INTO bookings
        (id, service, booking_date, booking_time, name, phone, email, car_model, vehicle_type, address, estimated_price, notes, details_json, duration_hours, status, source, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        storedBooking.id,
        storedBooking.service,
        storedBooking.date,
        storedBooking.time,
        storedBooking.name,
        storedBooking.phone,
        storedBooking.email,
        storedBooking.carModel || "",
        storedBooking.vehicleType,
        storedBooking.address,
        storedBooking.estimatedPrice,
        storedBooking.notes,
        JSON.stringify(storedBooking.details || []),
        storedBooking.durationHours,
        storedBooking.status,
        storedBooking.source || "website",
        storedBooking.createdAt,
      ]
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");

    if (isUniqueViolation(error)) {
      throw new Error("This time is no longer available. Please choose another slot.");
    }

    throw error;
  }
}

async function ensureSchema(db: Pool) {
  if (hasEnsuredSchema) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id uuid PRIMARY KEY,
      service text NOT NULL,
      booking_date date NOT NULL,
      booking_time text NOT NULL,
      name text NOT NULL,
      phone text NOT NULL,
      email text NOT NULL,
      car_model text NOT NULL DEFAULT '',
      vehicle_type text NOT NULL,
      address text NOT NULL,
      estimated_price text,
      notes text,
      details_json text,
      duration_hours integer NOT NULL DEFAULT 2,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS car_model text NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS estimated_price text");
  await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS details_json text");
  await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_hours integer NOT NULL DEFAULT 2");
  await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending'");
  await db.query("ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending'");
  await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'website'");
  await db.query(`
    CREATE TABLE IF NOT EXISTS schedule_blocks (
      id uuid PRIMARY KEY,
      block_date date NOT NULL,
      block_time text NOT NULL,
      start_time text,
      end_time text,
      reason text,
      status text NOT NULL DEFAULT 'blocked',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query("ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS start_time text");
  await db.query("ALTER TABLE schedule_blocks ADD COLUMN IF NOT EXISTS end_time text");

  hasEnsuredSchema = true;
}

async function saveToLocalJsonWithAvailability(booking: StoredBooking) {
  const [bookings, blocks] = await Promise.all([readLocalBookings(), readLocalBlocks()]);

  if (blocks.some((block) => block.date === booking.date && doTimeRangesOverlap(booking.time, getBookingEndTime(booking.time, booking.durationHours), block.startTime || block.time, block.endTime || getNextTimeSlot(block.time)))) {
    throw new Error("This time is no longer available. Please choose another slot.");
  }

  if (bookings.some((item) => item.date === booking.date && isActiveBookingStatus(item.status) && doTimeRangesOverlap(booking.time, getBookingEndTime(booking.time, booking.durationHours), item.time, getBookingEndTime(item.time, item.durationHours)))) {
    throw new Error("This time is no longer available. Please choose another slot.");
  }

  bookings.push(booking);
  await writeLocalBookings(bookings);
}

async function readLocalBookings() {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "bookings.json");
  await mkdir(dataDir, { recursive: true });

  let bookings: StoredBooking[] = [];
  try {
    const existing = await readFile(filePath, "utf8");
    bookings = JSON.parse(existing) as StoredBooking[];
  } catch {
    bookings = [];
  }

  return bookings.map(normalizeStoredBooking);
}

async function writeLocalBookings(bookings: StoredBooking[]) {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "bookings.json");
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(bookings, null, 2));
}

async function readLocalBlocks() {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "schedule-blocks.json");
  await mkdir(dataDir, { recursive: true });

  try {
    const blocks = JSON.parse(await readFile(filePath, "utf8")) as ScheduleBlock[];
    return blocks.map((block) => ({
      ...block,
      startTime: block.startTime || block.time,
      endTime: block.endTime || getNextTimeSlot(block.time),
    }));
  } catch {
    return [];
  }
}

async function writeLocalBlocks(blocks: ScheduleBlock[]) {
  const dataDir = path.join(process.cwd(), "data");
  const filePath = path.join(dataDir, "schedule-blocks.json");
  await mkdir(dataDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(blocks, null, 2));
}

function buildAvailability(bookedTimes: Set<string>, blockedTimes: Set<string>): SlotAvailability[] {
  return timeSlots.map((time) => ({
    time,
    available: !bookedTimes.has(time) && !blockedTimes.has(time),
    reason: bookedTimes.has(time) ? "booked" : blockedTimes.has(time) ? "blocked" : undefined,
  }));
}

async function hasDatabaseBlockConflict(db: Pool, date: string, time: string, durationHours: number | string | null) {
  const result = await db.query<{ block_time: string; start_time: string | null; end_time: string | null }>(
    "SELECT block_time, start_time, end_time FROM schedule_blocks WHERE block_date = $1 AND status = 'blocked'",
    [date]
  );

  return result.rows.some((row) => doTimeRangesOverlap(time, getBookingEndTime(time, durationHours), row.start_time || row.block_time, row.end_time || getNextTimeSlot(row.block_time)));
}

async function hasDatabaseRangeBlockConflict(db: Pool, date: string, startTime: string, endTime: string, exceptId?: string) {
  const result = await db.query<{ id: string; block_time: string; start_time: string | null; end_time: string | null }>(
    "SELECT id, block_time, start_time, end_time FROM schedule_blocks WHERE block_date = $1 AND status = 'blocked'",
    [date]
  );

  return result.rows.some((row) => {
    if (exceptId && row.id === exceptId) {
      return false;
    }

    return doTimeRangesOverlap(startTime, endTime, row.start_time || row.block_time, row.end_time || getNextTimeSlot(row.block_time));
  });
}

function getBlockedTimeSet(blocks: Array<{ startTime: string; endTime: string }>) {
  return new Set<string>(
    timeSlots.filter((slot) => blocks.some((block) => isSlotWithinRange(slot, block.startTime, block.endTime)))
  );
}

function getSlotsInRange(startTime: string, endTime: string) {
  return timeSlots.filter((slot) => isSlotWithinRange(slot, startTime, endTime));
}

export function getNextTimeSlot(time: string) {
  const index = timeSlots.findIndex((slot) => slot === time);

  if (index >= 0 && index < timeSlots.length - 1) {
    return timeSlots[index + 1];
  }

  return "8:00 PM";
}

function mapDatabaseBooking(row: DatabaseBookingRow): StoredBooking {
  return normalizeStoredBooking({
    id: row.id,
    service: row.service as StoredBooking["service"],
    date: formatDatabaseDate(row.booking_date),
    time: row.booking_time as StoredBooking["time"],
    name: row.name,
    phone: row.phone,
    email: row.email,
    carModel: row.car_model || "",
    vehicleType: row.vehicle_type as StoredBooking["vehicleType"],
    address: row.address,
    estimatedPrice: row.estimated_price || "",
    notes: row.notes || "",
    details: safeJsonParse(row.details_json) as StoredBooking["details"],
    durationHours: getBookingDurationHours(row.duration_hours),
    source: normalizeBookingSource(row.source),
    status: normalizeBookingStatus(row.status),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  });
}

function normalizeBookingSource(source: string | undefined | null): StoredBooking["source"] {
  if (source === "telegram_manual" || source === "admin_manual") {
    return source;
  }

  return "website";
}

function normalizeBookingStatus(status: string | undefined | null): BookingStatus {
  if (status === "confirmed" || status === "completed" || status === "cancelled") {
    return status;
  }

  if (status === "canceled") {
    return "cancelled";
  }

  return "pending";
}

function isActiveBookingStatus(status: BookingStatus) {
  return status === "pending" || status === "confirmed";
}

function assertStatusTransition(current: BookingStatus, next: BookingStatus) {
  if (current === next) {
    return;
  }

  if (current === "cancelled") {
    throw new Error("Cancelled bookings cannot be changed from Telegram/admin controls.");
  }

  if (current === "completed") {
    throw new Error("Completed bookings cannot be changed from Telegram/admin controls.");
  }

  if (next === "completed" && current !== "confirmed" && current !== "pending") {
    throw new Error("Only pending or confirmed bookings can be marked complete.");
  }
}

function safeJsonParse(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function formatDatabaseDate(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function getBookingDurationHours(value: number | string | null | undefined) {
  const normalized = Number(value || 0);
  return Math.max(2, Number.isFinite(normalized) ? Math.floor(normalized) : 2);
}

function getBookingEndTime(startTime: string, durationHours: number | string | null | undefined) {
  return addHoursToTimeSlot(startTime, getBookingDurationHours(durationHours));
}

function getSlotsForBookingWindow(startTime: string, durationHours: number | string | null | undefined) {
  return getSlotsInRange(startTime, getBookingEndTime(startTime, durationHours));
}

function normalizeStoredBooking(booking: Partial<StoredBooking>): StoredBooking {
  const rawDetails = Array.isArray(booking.details) ? (booking.details as Array<Record<string, unknown>>) : [];
  const details = rawDetails.map((detail) => ({
    service: typeof detail.service === "string" && bookingServices.includes(detail.service as (typeof bookingServices)[number]) ? detail.service : bookingServices[0],
    vehicleType: typeof detail.vehicleType === "string" && vehicleTypes.includes(detail.vehicleType as (typeof vehicleTypes)[number]) ? detail.vehicleType : vehicleTypes[0],
    notes: typeof detail.notes === "string" ? detail.notes : "",
    ...(typeof detail.lineNumber === "number" ? { lineNumber: detail.lineNumber } : {}),
    ...(typeof detail.estimatedPrice === "string" ? { estimatedPrice: detail.estimatedPrice } : {}),
    ...(typeof detail.basePrice === "string" ? { basePrice: detail.basePrice } : {}),
    ...(typeof detail.discountPercent === "number" ? { discountPercent: detail.discountPercent } : {}),
  }));

  return {
    id: typeof booking.id === "string" ? booking.id : randomUUID(),
    service: typeof booking.service === "string" && bookingServices.includes(booking.service as (typeof bookingServices)[number]) ? booking.service : bookingServices[0],
    date: typeof booking.date === "string" ? booking.date : "",
    time: (typeof booking.time === "string" && isTimeSlot(booking.time) ? booking.time : timeSlots[0]) as StoredBooking["time"],
    name: typeof booking.name === "string" ? booking.name : "",
    phone: typeof booking.phone === "string" ? booking.phone : "",
    email: typeof booking.email === "string" ? booking.email : "",
    carModel: typeof booking.carModel === "string" ? booking.carModel : "",
    vehicleType: typeof booking.vehicleType === "string" && vehicleTypes.includes(booking.vehicleType as (typeof vehicleTypes)[number]) ? booking.vehicleType : vehicleTypes[0],
    address: typeof booking.address === "string" ? booking.address : "",
    estimatedPrice: typeof booking.estimatedPrice === "string" ? booking.estimatedPrice : "",
    notes: typeof booking.notes === "string" ? booking.notes : "",
    details: details as StoredBooking["details"],
    durationHours: getBookingDurationHours(booking.durationHours),
    source: normalizeBookingSource(booking.source),
    status: normalizeBookingStatus(booking.status),
    createdAt: typeof booking.createdAt === "string" ? booking.createdAt : new Date(0).toISOString(),
  };
}
