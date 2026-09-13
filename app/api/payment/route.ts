import { NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyReceipt,
  assertOrigin,
  AppError,
  rateLimit,
  requestIP,
} from "@/lib/platform/auth";
import { createCheckout } from "@/lib/integrations/payments";
import { apiError, readJson } from "@/lib/platform/http";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await rateLimit("checkout:" + requestIP(request), 15, 900);
    const b = z
      .object({
        id: z.uuid(),
        token: z.string(),
        kind: z.enum(["deposit", "balance"]).default("balance"),
      })
      .parse(await readJson(request));
    if (!(await verifyReceipt(b.id, b.token)))
      throw new AppError("Invalid confirmation link.", 403);
    return NextResponse.json({
      ok: true,
      url: await createCheckout(b.id, b.kind),
    });
  } catch (e) {
    return apiError(e);
  }
}
