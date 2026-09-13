import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { BookingWizard } from "@/components/westloop/BookingWizard";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Book Your Visit",
  alternates: { canonical: "/booking" },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const d = await publicData();
  return (
    <PageShell business={d.business}>
      <section className="page-intro compact-intro wrap">
        <p className="eyebrow">MAKE TIME FOR YOUR CAR</p>
        <h1>
          Your next <em>fresh start.</em>
        </h1>
        <p>Choose your service. Find your time. We'll handle the details.</p>
      </section>
      <BookingWizard
        services={d.services}
        business={d.business}
        initialService={(await searchParams).service}
      />
    </PageShell>
  );
}
