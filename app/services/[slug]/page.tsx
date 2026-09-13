import Link from "next/link";
import { notFound } from "next/navigation";
import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { money } from "@/lib/platform/types";
import { siteUrl } from "@/lib/platform/settings";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { services } = await publicData();
  const s = services.find((x) => x.slug === slug);
  return {
    title: s?.name || "Service",
    description: s?.description,
    alternates: { canonical: "/services/" + slug },
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const d = await publicData();
  const s = d.services.find((x) => x.slug === slug);
  if (!s) notFound();
  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: s.name,
    description: s.description,
    provider: {
      "@type": "AutomotiveBusiness",
      name: d.business.name,
      url: siteUrl(),
    },
    areaServed: "Chicago",
    ...(s.pricing_mode !== "quote"
      ? {
          offers: {
            "@type": "Offer",
            price: s.price_cents / 100,
            priceCurrency: "USD",
          },
        }
      : {}),
  };
  return (
    <PageShell business={d.business}>
      <section className="page-intro wrap">
        <p className="eyebrow">{s.category}</p>
        <h1>{s.name}</h1>
        <p>{s.description}</p>
      </section>
      <section className="wrap service-detail">
        <div>
          <h2>The treatment.</h2>
          <ul className="inclusions">
            {s.includes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <aside className="paper">
          <p className="eyebrow">YOUR APPOINTMENT</p>
          <h2>
            {s.pricing_mode === "starting" ? "From " : ""}
            {money(s.pricing_mode === "quote" ? null : s.price_cents)}
          </h2>
          <p>Approximately {s.duration_minutes / 60} hours</p>
          {s.pricing_mode !== "quote" && (
            <p>
              SUV: +{money(s.suv_extra_cents)} · Truck: +
              {money(s.truck_extra_cents)}
            </p>
          )}
          <p>Final scope is confirmed after reviewing your vehicle.</p>
          <Link className="button" href={"/booking?service=" + s.id}>
            Choose your time ↗
          </Link>
        </aside>
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
        }}
      />
    </PageShell>
  );
}
