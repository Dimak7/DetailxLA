import { NextResponse } from "next/server";
import { logout, sessionCookie, assertOrigin } from "@/lib/platform/auth";
import { apiError } from "@/lib/platform/http";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await logout(request);
    const r = NextResponse.redirect(new URL("/admin/login", request.url), 303);
    r.cookies.set(sessionCookie, "", { maxAge: 0, path: "/" });
    return r;
  } catch (e) {
    return apiError(e);
  }
}
