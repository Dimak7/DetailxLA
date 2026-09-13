import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { Gallery } from "@/components/westloop/Gallery";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "The Finish | Work Gallery",
  alternates: { canonical: "/gallery" },
};
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
        <p>Real transformations, documented with care.</p>
      </section>
      <section className="wrap section no-top">
        <Gallery items={d.gallery} />
      </section>
    </PageShell>
  );
}
