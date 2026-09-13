import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { query } from "@/lib/platform/db";
import { requireSession, AppError } from "@/lib/platform/auth";
import { apiError } from "@/lib/platform/http";
export async function POST(request: Request) {
  try {
    await requireSession(request, "gallery");
    const form = await request.formData(),
      file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > 5 * 1024 * 1024 ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
      throw new AppError("Choose a JPEG, PNG or WebP image under 5 MB.");
    const data = await sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 30000000,
    })
      .rotate()
      .resize(1800, 1800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const id = randomUUID();
    await query(
      "INSERT INTO wl.media(id,content_type,data) VALUES($1,'image/webp',$2)",
      [id, data],
    );
    return NextResponse.json({ ok: true, url: "/api/media/" + id });
  } catch (e) {
    return apiError(e);
  }
}
