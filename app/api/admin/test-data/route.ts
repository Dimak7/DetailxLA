import { NextResponse } from "next/server";
import { requireSession } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { archiveTestData, restoreTestData, testDataCleanupPreview } from "@/lib/platform/test-data-cleanup";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return NextResponse.json(await testDataCleanupPreview(await requireSession(request, "settings")), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireSession(request, "settings");
    const body = z.object({ action: z.enum(["archive", "restore"]), data: z.unknown() }).parse(await readJson(request));
    const result = body.action === "archive" ? await archiveTestData(body.data, user) : await restoreTestData(body.data, user);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["23503", "23505", "23502"].includes(String(error.code)))
      return NextResponse.json({ ok: false, error: "This record has linked history or conflicts with a current record. Nothing was changed. Review the linked records before retrying." }, { status: 409 });
    return apiError(error);
  }
}
