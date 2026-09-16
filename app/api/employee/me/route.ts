import { NextResponse } from "next/server";
import { requestSession, AppError } from "@/lib/platform/auth";
import { query } from "@/lib/platform/db";
import { apiError } from "@/lib/platform/http";
export async function GET(request: Request) {
  try {
    const user = await requestSession(request);
    if (!user) throw new AppError("Please sign in.", 401);
    const employee = (await query<{ id: string }>("SELECT id FROM wl.employees WHERE user_id=$1 AND active=true", [user.user_id]))[0];
    if (!employee) throw new AppError("No employee profile is linked to this account.", 403);
    return NextResponse.json({ ok: true, employee: (await query("SELECT id,name,position FROM wl.employees WHERE id=$1", [employee.id]))[0], shifts: await query("SELECT * FROM wl.employee_shifts WHERE employee_id=$1 AND published=true AND shift_date>=to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM-DD') ORDER BY shift_date,start_minute", [employee.id]), entries: await query("SELECT * FROM wl.time_entries WHERE employee_id=$1 ORDER BY clock_in DESC LIMIT 50", [employee.id]) });
  } catch (e) { return apiError(e); }
}
