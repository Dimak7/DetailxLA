import { NextResponse, after } from "next/server";
import {
  requireSession,
  requestSession,
  assertOrigin,
  AppError,
} from "@/lib/platform/auth";
import { adminData, adminAction } from "@/lib/platform/admin";
import { apiError, readJson } from "@/lib/platform/http";
import { processOutbox } from "@/lib/platform/worker";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams,
      section = p.get("section") || "dashboard";
    const user = await requireSession(request, section);
    const data = await adminData(section, p, user);
    if (section === "payroll" && p.get("export") === "csv") {
      const rows = Array.isArray((data as { rows?: unknown[] }).rows) ? (data as { rows: Array<Record<string, unknown>> }).rows : [];
      const value = (input: unknown) => `"${String(input ?? "").replaceAll('"', '""')}"`;
      const csv = [["Employee", "Position", "Regular hours", "Overtime hours", "Hourly rate", "Estimated gross"], ...rows.map((row) => [row.name, row.position, (Number(row.regular_minutes || 0) / 60).toFixed(2), (Number(row.overtime_minutes || 0) / 60).toFixed(2), (Number(row.hourly_rate_cents || 0) / 100).toFixed(2), (Number(row.estimated_gross_cents || 0) / 100).toFixed(2)])].map((row) => row.map(value).join(",")).join("\r\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="west-loop-payroll-${p.get("start") || "period"}-to-${p.get("end") || "period"}.csv"`, "Cache-Control": "no-store" } });
    }
    return NextResponse.json(data);
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const s = await requestSession(request);
    if (!s) throw new AppError("Please sign in.", 401);
    const body = await readJson(request);
    const result = await adminAction(body.action, body.data, s);
    after(() =>
      processOutbox(10)
        .then(() => {})
        .catch(() => {}),
    );
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return apiError(e);
  }
}
