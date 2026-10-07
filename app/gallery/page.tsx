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
  { id: "editorial-hand-wash", title: "A careful hand wash", caption: "Safe contact washing that treats the finish with care.", category: "Exterior", image_url: "/brand/editorial/green-car-hand-wash.webp", before_url: "", sort_order: -12, published: true },
  { id: "editorial-steam", title: "Steam-cleaned interior", caption: "Targeted interior care for the surfaces you see and touch every day.", category: "Interior", image_url: "/brand/editorial/interior-steam.webp", before_url: "", sort_order: -11, published: true },
  { id: "editorial-mustang", title: "Classic finish", caption: "Deep black paint, crisp reflections and carefully finished brightwork.", category: "Paint Correction", image_url: "/brand/editorial/classic-mustang-finish.webp", before_url: "", sort_order: -10, published: true },
  { id: "editorial-wheel", title: "Wheel detail", caption: "Foam reaches into the places a quick wash leaves behind.", category: "Detail Work", image_url: "/brand/editorial/wheel-foam.webp", before_url: "", sort_order: -9, published: true },
  { id: "editorial-reflection", title: "A finish worth noticing", caption: "The kind of clarity that changes how you look at your car.", category: "The Finish", image_url: "/brand/editorial/vintage-green-lifestyle.webp", before_url: "", sort_order: -8, published: true },
  { id: "editorial-cabin", title: "Made for the drive", caption: "A clean, composed cabin that feels good to return to.", category: "The Finish", image_url: "/brand/editorial/vintage-cabin-lifestyle.webp", before_url: "", sort_order: -7, published: true },
  { id: "brand-full-detail", title: "Full detail finish", caption: "Interior and exterior care, brought together.", category: "Full Detail", image_url: "/brand/photography/full-detail-studio.webp", before_url: "", sort_order: -6, published: true },
  { id: "brand-correction", title: "Paint refinement", caption: "Inspection lighting reveals the work behind the gloss.", category: "Paint Correction", image_url: "/brand/photography/paint-correction.webp", before_url: "", sort_order: -5, published: true },
  { id: "brand-coating", title: "Ceramic application", caption: "Careful preparation and controlled application under inspection lights.", category: "Ceramic Coating", image_url: "/brand/photography/ceramic-coating.webp", before_url: "", sort_order: -4, published: true },
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
