import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { requireSession, AppError } from "@/lib/platform/auth";
import { query, transaction } from "@/lib/platform/db";
import { apiError } from "@/lib/platform/http";
import { requireBookingPhotoAccess } from "@/lib/platform/booking-photos";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireSession(request, "my_schedule"), id = z.uuid().parse((await context.params).id);
    await requireBookingPhotoAccess(id, user);
    const photos = await query("SELECT p.id,p.stage,p.caption,p.created_at,u.name uploaded_by FROM wl.booking_photos p JOIN wl.users u ON u.id=p.uploaded_by WHERE p.booking_id=$1 ORDER BY p.created_at", [id]);
    return NextResponse.json({ photos }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const user = await requireSession(request, "my_schedule"), id = z.uuid().parse((await context.params).id);
    await requireBookingPhotoAccess(id, user);
    if (Number(request.headers.get("content-length")) > 9 * 1024 * 1024) throw new AppError("Choose an image under 8 MB.", 413);
    const form = await request.formData(), file = form.get("file"), stage = z.enum(["before", "after"]).parse(form.get("stage")), caption = z.string().trim().max(240).parse(form.get("caption") || "");
    if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new AppError("Choose a JPEG, PNG or WebP photo under 8 MB.");
    let data: Buffer;
    try {
      // Re-encoding strips EXIF (including GPS) and prevents active file content.
      data = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 30000000 }).rotate().resize(1800, 1800, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch { throw new AppError("This image could not be read. Choose a valid JPEG, PNG or WebP photo."); }
    const photoId = randomUUID();
    await transaction(async q => {
      await q("SELECT id FROM wl.bookings WHERE id=$1 FOR UPDATE", [id]);
      await requireBookingPhotoAccess(id, user, q);
      const count = Number((await q<{ count: number }>("SELECT count(*)::int count FROM wl.booking_photos WHERE booking_id=$1", [id])).rows[0].count);
      if (count >= 40) throw new AppError("This appointment already has 40 photos.");
      await q("INSERT INTO wl.booking_photos(id,booking_id,stage,caption,data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)", [photoId, id, stage, caption, data, user.user_id]);
      await q("INSERT INTO wl.timeline(id,customer_id,booking_id,type,body,actor_id) SELECT $1,customer_id,id,'job_photo',$3,$4 FROM wl.bookings WHERE id=$2", [randomUUID(), id, `${stage === "before" ? "Before" : "After"} photo uploaded${caption ? ": " + caption : ""}`, user.user_id]);
    });
    return NextResponse.json({ ok: true, id: photoId }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
