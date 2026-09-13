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
    return NextResponse.json(
      await adminData(section, p, await requireSession(request, section)),
    );
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
