import { NextResponse } from "next/server";
import {
  login,
  sessionCookie,
  assertOrigin,
  requestIP,
  sessionFromToken,
  AppError,
} from "@/lib/platform/auth";
import { isAuthForm, readAuthInput } from "@/lib/platform/auth-form";
import { apiError } from "@/lib/platform/http";
import { z } from "zod";
import { adminLandingPage } from "@/lib/platform/admin-navigation";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const b = z
      .object({ email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().max(128) })
      .parse(await readAuthInput(request));
    const token = await login(b.email, b.password, requestIP(request)),
      s = await sessionFromToken(token);
    const redirectTo = s ? adminLandingPage(s.role) : "/admin/login";
    const r = isAuthForm(request)
      ? new NextResponse(null, { status: 303, headers: { Location: redirectTo } })
      : NextResponse.json({ ok: true, redirectTo });
    r.cookies.set(sessionCookie, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 604800,
      path: "/",
    });
    return r;
  } catch (e) {
    if (isAuthForm(request)) {
      const error = e instanceof AppError && e.status === 429 ? "rate-limit" : e instanceof AppError && e.status === 401 ? "credentials" : "unavailable";
      return new NextResponse(null, { status: 303, headers: { Location: "/admin/login?error=" + error } });
    }
    return apiError(e);
  }
}
