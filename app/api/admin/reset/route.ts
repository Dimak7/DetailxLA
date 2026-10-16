import { NextResponse, after } from "next/server";
import {
  assertOrigin,
  requestIP,
  createReset,
  resetPassword,
  rateLimit,
} from "@/lib/platform/auth";
import { isAuthForm, readAuthInput } from "@/lib/platform/auth-form";
import { apiError } from "@/lib/platform/http";
import { enqueue } from "@/lib/platform/outbox";
import { transaction } from "@/lib/platform/db";
import { settings, siteUrl } from "@/lib/platform/settings";
import { processOutbox } from "@/lib/platform/worker";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export async function POST(request: Request) {
  let nativeToken = "";
  try {
    assertOrigin(request);
    const b = await readAuthInput(request);
    if (typeof b.token === "string" && /^[a-f0-9]{64}$/.test(b.token)) nativeToken = b.token;
    if (b.token) {
      await rateLimit("reset-use:" + requestIP(request), 10, 900);
      await resetPassword(
        z.string().max(100).parse(b.token),
        z.string().max(128).parse(b.password),
      );
      return isAuthForm(request)
        ? new NextResponse(null, { status: 303, headers: { Location: "/admin/login?reset=complete" } })
        : NextResponse.json({ ok: true });
    }
    const email = z.string().trim().toLowerCase().pipe(z.email()).parse(b.email),
      token = await createReset(email, requestIP(request));
    if (token) {
      const business = await settings();
      await transaction((q) =>
        enqueue(q, {
          key: randomUUID(),
          channel: "email",
          recipient: email,
          subject: `Reset your ${business.name} password`,
          body:
            "This reset link expires in 30 minutes:\n" +
            siteUrl() +
            "/admin/reset?token=" +
            token,
        }),
      );
      after(() =>
        processOutbox(5)
          .then(() => {})
          .catch(() => {}),
      );
    }
    if (isAuthForm(request)) return new NextResponse(null, { status: 303, headers: { Location: "/admin/login?reset=requested" } });
    return NextResponse.json({
      ok: true,
      message:
        "If this account exists, a reset email will be sent when email is configured.",
    });
  } catch (e) {
    if (isAuthForm(request)) return new NextResponse(null, { status: 303, headers: { Location: nativeToken ? `/admin/reset?token=${nativeToken}&error=invalid` : "/admin/login?error=reset" } });
    return apiError(e);
  }
}
