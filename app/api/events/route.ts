import { NextResponse } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/platform/db";
import { saveAttribution, attributionSchema } from "@/lib/platform/attribution";
import { assertOrigin, requestIP, rateLimit } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
const input = z.object({
  id: z.uuid(),
  name: z.enum([
    "page_view",
    "service_view",
    "booking_started",
    "service_selected",
    "booking_submitted",
    "phone_clicked",
  ]),
  session_id: z.uuid(),
  attribution: attributionSchema,
  device: z.string().max(80).default(""),
  metadata: z
    .object({
      service_id: z.uuid().optional(),
      path: z.string().max(200).optional(),
    })
    .default({}),
});
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await rateLimit("event:" + requestIP(request), 150, 60);
    const e = input.parse(await readJson(request));
    await transaction(async (q) => {
      const aid = await saveAttribution(q, e.session_id, e.attribution);
      await q(
        "INSERT INTO wl.events(id,name,session_id,attribution_id,device,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING",
        [e.id, e.name, e.session_id, aid, e.device, JSON.stringify(e.metadata)],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
