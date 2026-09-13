import { query } from "./db";
import { settings } from "./settings";
import type { Service, GalleryItem, Review } from "./types";
export async function publicData() {
  const [business, services, gallery, reviews] = await Promise.all([
    settings(),
    query<Service>(
      "SELECT * FROM wl.services WHERE active=true ORDER BY sort_order,name",
    ),
    query<GalleryItem>(
      "SELECT * FROM wl.gallery WHERE published=true ORDER BY sort_order LIMIT 24",
    ),
    query<Review>(
      "SELECT id,name,rating,text,created_at FROM wl.reviews WHERE status='published' ORDER BY created_at DESC LIMIT 12",
    ),
  ]);
  return { business, services, gallery, reviews };
}
