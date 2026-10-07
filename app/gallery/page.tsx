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
  { id: "brand-full-detail", title: "Full detail finish", caption: "Interior and exterior care, brought together.", category: "Full Detail", image_url: "/brand/photography/full-detail-studio.webp", before_url: "", sort_order: -8, published: true },
  { id: "brand-correction", title: "Paint refinement", caption: "Inspection lighting reveals the work behind the gloss.", category: "Paint Correction", image_url: "/brand/photography/paint-correction.webp", before_url: "", sort_order: -7, published: true },
  { id: "brand-interior", title: "Interior finish", caption: "Clean materials, precise touchpoints and a comfortable cabin.", category: "Interior", image_url: "/brand/photography/interior-detail.webp", before_url: "", sort_order: -6, published: true },
  { id: "brand-coating", title: "Ceramic application", caption: "Careful preparation and controlled application under inspection lights.", category: "Ceramic Coating", image_url: "/brand/photography/ceramic-coating.webp", before_url: "", sort_order: -5, published: true },
  { id: "brand-exterior", title: "Exterior gloss", caption: "Paint, wheels, glass and finishing details in balance.", category: "Exterior", image_url: "/brand/photography/exterior-detail.webp", before_url: "", sort_order: -4, published: true },
  { id: "brand-engine", title: "Engine-bay care", caption: "A clean, natural finish without heavy shine.", category: "Detail Work", image_url: "/brand/photography/engine-bay.webp", before_url: "", sort_order: -3, published: true },
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
