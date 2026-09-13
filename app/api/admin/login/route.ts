import { NextResponse } from "next/server";
import {
  login,
  sessionCookie,
  assertOrigin,
  requestIP,
  sessionFromToken,
} from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const b = z
      .object({ email: z.email(), password: z.string().max(128) })
      .parse(await readJson(request));
    const token = await login(b.email, b.password, requestIP(request)),
      s = await sessionFromToken(token);
    const r = NextResponse.json({
      ok: true,
      redirectTo: s?.role === "staff" ? "/admin/bookings" : "/admin/dashboard",
    });
    r.cookies.set(sessionCookie, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 604800,
      path: "/",
    });
    return r;
  } catch (e) {
    return apiError(e);
  }
}
