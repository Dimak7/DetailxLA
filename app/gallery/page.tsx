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
    "caption": "A careful contact wash lifts road film while respecting the finish beneath it.",
    "category": "Exterior",
    "image_url": "/brand/photos/hand-wash.webp",
    "before_url": "",
    "sort_order": -10,
    "published": true
  },
  {
    "id": "customer-mercedes-interior",
    "title": "A fresh cabin",
    "caption": "Clean leather, crisp touchpoints and a cabin that feels composed again.",
    "category": "Interior",
    "image_url": "/brand/photos/mercedes-interior.webp",
    "before_url": "",
    "sort_order": -9,
    "published": true
  },
  {
    "id": "customer-green-car-foam",
    "title": "Foam wash",
    "caption": "Dense foam begins the exterior reset by loosening dirt before contact washing.",
    "category": "Exterior",
    "image_url": "/brand/photos/green-car-foam.webp",
    "before_url": "",
    "sort_order": -8,
    "published": true
  },
  {
    "id": "customer-interior-cleaning",
    "title": "Interior care",
    "caption": "Material-appropriate tools reach the seams, textures and everyday touchpoints.",
    "category": "Interior",
    "image_url": "/brand/photos/interior-cleaning.webp",
    "before_url": "",
    "sort_order": -7,
    "published": true
  },
  {
    "id": "customer-wheel-cleaning",
    "title": "Every spoke",
    "caption": "A soft detailing brush reaches the spokes, hardware and tighter wheel surfaces.",
    "category": "Detail Work",
    "image_url": "/brand/photos/wheel-cleaning.webp",
    "before_url": "",
    "sort_order": -6,
    "published": true
  },
  {
    "id": "customer-mercedes-foam",
    "title": "In the wash bay",
    "caption": "Preparation in progress before the final finish is inspected and protected.",
    "category": "Exterior",
    "image_url": "/brand/photos/mercedes-foam.webp",
    "before_url": "",
    "sort_order": -5,
    "published": true
  },
  {
    "id": "customer-paint-beading",
    "title": "The finishing details",
    "caption": "Tight water behavior and a clear reflection reveal the quality of the prepared surface.",
    "category": "The Finish",
    "image_url": "/brand/photos/paint-beading.webp",
    "before_url": "",
    "sort_order": -4,
    "published": true
  }
];
export default async function Page() {
  const d = await publicData();
  const galleryItems = [...featuredPortfolio, ...d.gallery].filter((item, index, items) =>
    items.findIndex((candidate) => candidate.image_url === item.image_url) === index,
  );
  return (
    <PageShell business={d.business}>
      <section className="page-intro wrap">
        <p className="eyebrow">THE FINISH</p>
        <h1>
          The difference
          <br />
          <em>is in the details.</em>
        </h1>
        <p>See the work up close: careful washing, interior touchpoints, wheel details and the final surfaces that make a car feel complete.</p>
      </section>
      <section className="wrap section no-top">
        <Gallery items={galleryItems} />
      </section>
    </PageShell>
  );
}
