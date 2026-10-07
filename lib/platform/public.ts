import { customerPhotoPath } from "../photo-paths";
import { query } from "./db";
import { settings, publicSettings } from "./settings";
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
  return { business: publicSettings(business), services: services.map((service) => ({ ...service, image_url: customerPhotoPath(service.image_url) })), gallery: gallery.map((item) => ({ ...item, image_url: customerPhotoPath(item.image_url), before_url: customerPhotoPath(item.before_url) })), reviews };
}
