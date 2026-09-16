import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requestSession, assertOrigin, AppError } from "@/lib/platform/auth";
import { query } from "@/lib/platform/db";
import { apiError, readJson } from "@/lib/platform/http";

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const user = await requestSession(request);
    if (!user) throw new AppError("Please sign in.", 401);
    const employee = (await query<{ id: string }>("SELECT id FROM wl.employees WHERE user_id=$1 AND active=true", [user.user_id]))[0];
    if (!employee) throw new AppError("No employee profile is linked to this account.", 403);
    const { action } = await readJson(request) as { action: string };
    const active = (await query<{ id: string; break_started_at: string | null }>("SELECT id,break_started_at FROM wl.time_entries WHERE employee_id=$1 AND clock_out IS NULL", [employee.id]))[0];
    if (action === "in") {
      if (active) throw new AppError("You are already clocked in.");
      await query("INSERT INTO wl.time_entries(id,employee_id,clock_in) VALUES($1,$2,now())", [randomUUID(), employee.id]);
    } else if (action === "break_start") {
      if (!active) throw new AppError("Clock in before starting a break.");
      if (active.break_started_at) throw new AppError("Your break is already running.");
      await query("UPDATE wl.time_entries SET break_started_at=now() WHERE id=$1", [active.id]);
    } else if (action === "break_end") {
      if (!active?.break_started_at) throw new AppError("There is no active break to end.");
      await query("UPDATE wl.time_entries SET break_minutes=break_minutes+GREATEST(0,round(EXTRACT(EPOCH FROM (now()-break_started_at))/60)::int),break_started_at=NULL WHERE id=$1", [active.id]);
    } else if (action === "out") {
      if (!active) throw new AppError("Clock in before clocking out.");
      if (active.break_started_at) throw new AppError("End your break before clocking out.");
      await query("UPDATE wl.time_entries SET clock_out=now() WHERE id=$1", [active.id]);
    } else throw new AppError("Unsupported clock action.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
