import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/platform/db";
import {
  hash,
  assertOrigin,
  AppError,
  rateLimit,
  requestIP,
} from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await rateLimit("review:" + requestIP(request), 10, 900);
    const b = z
      .object({
        token: z.string().length(64),
        rating: z.number().int().min(1).max(5),
        text: z.string().trim().min(5).max(2000),
      })
      .parse(await readJson(request));
    const rows = await query(
      "UPDATE wl.reviews SET rating=$2,text=$3,status='received',token_hash=NULL WHERE token_hash=$1 AND status='requested' RETURNING id",
      [hash(b.token), b.rating, b.text],
    );
    if (!rows.length)
      throw new AppError(
        "This review link has already been used or is invalid.",
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
