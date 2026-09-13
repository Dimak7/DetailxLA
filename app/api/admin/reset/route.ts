import { NextResponse, after } from "next/server";
import {
  assertOrigin,
  requestIP,
  createReset,
  resetPassword,
  rateLimit,
} from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { enqueue } from "@/lib/platform/outbox";
import { transaction } from "@/lib/platform/db";
import { siteUrl } from "@/lib/platform/settings";
import { processOutbox } from "@/lib/platform/worker";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const b = await readJson(request);
    if (b.token) {
      await rateLimit("reset-use:" + requestIP(request), 10, 900);
      await resetPassword(
        z.string().max(100).parse(b.token),
        z.string().max(128).parse(b.password),
      );
      return NextResponse.json({ ok: true });
    }
    const email = z.email().parse(b.email),
      token = await createReset(email, requestIP(request));
    if (token) {
      await transaction((q) =>
        enqueue(q, {
          key: randomUUID(),
          channel: "email",
          recipient: email,
          subject: "Reset your West Loop Auto Spa password",
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
    return NextResponse.json({
      ok: true,
      message:
        "If this account exists, a reset email will be sent when email is configured.",
    });
  } catch (e) {
    return apiError(e);
  }
}
