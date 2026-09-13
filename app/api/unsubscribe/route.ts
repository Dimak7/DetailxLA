import { NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction } from "@/lib/platform/db";
import { unsubscribeToken } from "@/lib/platform/campaigns";
import { assertOrigin, AppError } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const b = z
      .object({
        id: z.uuid(),
        token: z.string().regex(/^[a-f0-9]{64}$/),
        channel: z.literal("email"),
      })
      .parse(await readJson(req));
    const expected = await unsubscribeToken(b.id, "email");
    if (!timingSafeEqual(Buffer.from(b.token), Buffer.from(expected)))
      throw new AppError("Invalid preference link.", 403);
    await transaction(async (q) => {
      await q(
        "UPDATE wl.customers SET marketing_email=false,updated_at=now() WHERE id=$1",
        [b.id],
      );
      await q(
        "INSERT INTO wl.consent_events(id,customer_id,channel,consent,wording,source) VALUES($1,$2,'email',false,'Unsubscribe requested','email link')",
        [randomUUID(), b.id],
      );
      await q(
        "UPDATE wl.messages SET status='cancelled' WHERE customer_id=$1 AND channel='email' AND purpose='marketing' AND status IN ('queued','failed','skipped')",
        [b.id],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
