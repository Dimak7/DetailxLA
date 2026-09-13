import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { z } from "zod";
import { transaction } from "@/lib/platform/db";
import { saveAttribution, attributionSchema } from "@/lib/platform/attribution";
import { assertOrigin, requestIP, rateLimit } from "@/lib/platform/auth";
import { apiError, readJson } from "@/lib/platform/http";
import { settings } from "@/lib/platform/settings";
import { enqueue } from "@/lib/platform/outbox";
import { processOutbox } from "@/lib/platform/worker";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await rateLimit("lead:" + requestIP(request), 8, 900);
    const b = z
        .object({
          name: z.string().min(2).max(160),
          email: z.email(),
          phone: z.string().max(30).default(""),
          notes: z.string().min(5).max(2000),
          session_id: z.uuid(),
          attribution: attributionSchema,
        })
        .parse(await readJson(request)),
      s = await settings(),
      id = randomUUID();
    await transaction(async (q) => {
      const a = await saveAttribution(q, b.session_id, b.attribution);
      await q(
        "INSERT INTO wl.leads(id,name,email,phone,notes,attribution_id) VALUES($1,$2,$3,$4,$5,$6)",
        [id, b.name, b.email.toLowerCase(), b.phone, b.notes, a],
      );
      await q(
        "INSERT INTO wl.events(id,name,session_id,attribution_id) VALUES($1,'lead_created',$2,$3)",
        ["lead:" + id, b.session_id, a],
      );
      await q(
        "INSERT INTO wl.timeline(id,lead_id,type,body) VALUES($1,$2,'lead_created','Enquiry received from website')",
        [randomUUID(), id],
      );
      for (const channel of ["email", "telegram"])
        await enqueue(q, {
          key: "lead:" + id + ":" + channel,
          channel,
          recipient: channel === "email" ? s.email : s.telegram_chat_id,
          subject: "New enquiry from " + b.name,
          body: b.email + "\n" + b.phone + "\n" + b.notes,
        });
    });
    after(() =>
      processOutbox(5)
        .then(() => {})
        .catch(() => {}),
    );
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiError(e);
  }
}
