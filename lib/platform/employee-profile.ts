import { randomUUID } from "node:crypto";
import type { Query } from "./db";
import type { Role } from "./types";

/** Repair older team logins after successful authentication, without changing access or pay. */
export async function ensureStaffEmployeeProfile(
  q: Query,
  user: { id: string; name: string; email: string; role: Role },
) {
  if (user.role !== "staff") return;
  const linked = (await q("SELECT id FROM wl.employees WHERE user_id=$1", [user.id])).rows;
  if (linked.length) return; // An inactive linked profile must stay inactive.
  const matches = (await q<{ id: string; user_id: string | null; active: boolean }>(
    "SELECT id,user_id,active FROM wl.employees WHERE lower(btrim(email))=$1 FOR UPDATE",
    [user.email.trim().toLowerCase()],
  )).rows;
  if (matches.length) {
    // Never guess between duplicate records, reactivate former staff, or take a linked profile.
    if (matches.length === 1 && !matches[0].user_id && matches[0].active)
      await q("UPDATE wl.employees SET user_id=$1,updated_at=now() WHERE id=$2 AND user_id IS NULL", [user.id, matches[0].id]);
    return;
  }
  const employeeId = randomUUID();
  await q(
    "INSERT INTO wl.employees(id,user_id,name,email,position) VALUES($1,$2,$3,$4,'Detailer') ON CONFLICT(user_id) DO NOTHING",
    [employeeId, user.id, user.name, user.email.trim().toLowerCase()],
  );
  await q(
    "INSERT INTO wl.employee_availability(employee_id,weekday,available,start_minute,end_minute) SELECT id,weekday,false,480,1200 FROM wl.employees CROSS JOIN generate_series(0,6) weekday WHERE id=$1 ON CONFLICT DO NOTHING",
    [employeeId],
  );
}
