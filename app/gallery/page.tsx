import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { Gallery } from "@/components/westloop/Gallery";
import type { GalleryItem } from "@/lib/platform/types";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "The Finish | Work Gallery",
  alternates: { canonical: "/gallery" },
};
const featuredPortfolio: GalleryItem[] = [
  {
    "id": "customer-hand-wash",
    "title": "A careful hand wash",
    "caption": "A sponge lifts dirt from the exterior finish.",
    "category": "Exterior",
    "image_url": "/brand/photos/hand-wash.webp",
    "before_url": "",
    "sort_order": -10,
    "published": true
  },
  {
    "id": "customer-mercedes-interior",
    "title": "A fresh cabin",
    "caption": "White leather, clean surfaces and a cabin ready for the drive.",
    "category": "Interior",
    "image_url": "/brand/photos/mercedes-interior.webp",
    "before_url": "",
    "sort_order": -9,
    "published": true
  },
  {
    "id": "customer-green-car-foam",
    "title": "Foam wash",
    "caption": "A green sports car covered in cleaning foam.",
    "category": "Exterior",
    "image_url": "/brand/photos/green-car-foam.webp",
    "before_url": "",
    "sort_order": -8,
    "published": true
  },
  {
    "id": "customer-interior-cleaning",
    "title": "Interior care",
    "caption": "A brush works cleaner into an interior door panel.",
    "category": "Interior",
    "image_url": "/brand/photos/interior-cleaning.webp",
    "before_url": "",
    "sort_order": -7,
    "published": true
  },
  {
    "id": "customer-wheel-cleaning",
    "title": "Every spoke",
    "caption": "A soft brush reaches into the wheel.",
    "category": "Detail Work",
    "image_url": "/brand/photos/wheel-cleaning.webp",
    "before_url": "",
    "sort_order": -6,
    "published": true
  },
  {
    "id": "customer-mercedes-foam",
    "title": "In the wash bay",
    "caption": "A black Mercedes during its foam wash.",
    "category": "Exterior",
    "image_url": "/brand/photos/mercedes-foam.webp",
    "before_url": "",
    "sort_order": -5,
    "published": true
  },
  {
    "id": "customer-paint-beading",
    "title": "The finishing details",
    "caption": "Water beading and a microfiber towel on black paint.",
    "category": "The Finish",
    "image_url": "/brand/photos/paint-beading.webp",
    "before_url": "",
    "sort_order": -4,
    "published": true
  }
];
export default async function Page() {
  const d = await publicData();
  return (
    <PageShell business={d.business}>
      <section className="page-intro wrap">
        <p className="eyebrow">THE FINISH</p>
        <h1>
          The difference
          <br />
          <em>is in the details.</em>
        </h1>
        <p>A closer look at the surfaces, finishes and craftsmanship behind every service.</p>
      </section>
      <section className="wrap section no-top">
        <Gallery items={[...featuredPortfolio, ...d.gallery]} />
      </section>
    </PageShell>
  );
}
