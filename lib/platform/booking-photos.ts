import { query, type Query } from "./db";
import { AppError } from "./auth";
import type { Session } from "./types";

export async function requireBookingPhotoAccess(id: string, user: Session, q: Query = async (sql, params) => ({ rows: await query(sql, params) })) {
  const booking = (await q<{ allowed: boolean }>(`SELECT ($2::text<>'staff' OR b.assigned_to=$3 OR EXISTS (
    SELECT 1 FROM wl.employee_job_assignments a JOIN wl.employees e ON e.id=a.employee_id WHERE a.booking_id=b.id AND e.user_id=$3)) allowed
    FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id WHERE b.id=$1 AND c.archived_at IS NULL`, [id, user.role, user.user_id])).rows[0];
  if (!booking || !booking.allowed) throw new AppError("Appointment not found or unavailable for your account.", 404);
}
