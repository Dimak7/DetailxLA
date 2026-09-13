import { query } from "@/lib/platform/db";
export async function GET() {
  try {
    await query("SELECT 1");
    return Response.json({ ok: true, database: "connected" });
  } catch {
    return Response.json(
      { ok: false, database: "not configured or unavailable" },
      { status: 503 },
    );
  }
}
