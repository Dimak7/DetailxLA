import { z } from "zod";
import { requireSession, AppError } from "@/lib/platform/auth";
import { query } from "@/lib/platform/db";
import { requireBookingPhotoAccess } from "@/lib/platform/booking-photos";
import { apiError } from "@/lib/platform/http";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(request, "my_schedule"), id = z.uuid().parse((await context.params).id);
    const photo = (await query<{ booking_id: string; data: Buffer }>("SELECT booking_id,data FROM wl.booking_photos WHERE id=$1", [id]))[0];
    if (!photo) throw new AppError("Photo not found.", 404);
    await requireBookingPhotoAccess(photo.booking_id, user);
    return new Response(new Uint8Array(photo.data), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="job-photo.webp"' } });
  } catch (error) { return apiError(error); }
}
