import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { ServiceCards } from "@/components/westloop/ServiceCards";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Services & Pricing",
  alternates: { canonical: "/services" },
  description:
    "Explore Chicago car detailing, interior cleaning, paint correction and ceramic coating. Clear pricing and online appointments.",
};
export default async function Page() {
  const d = await publicData();
  return (
    <PageShell business={d.business}>
      <section className="page-intro wrap">
        <p className="eyebrow">THE SERVICE MENU</p>
        <h1>
          Every car deserves
          <br />
          <em>considered care.</em>
        </h1>
        <p>
          A simple refresh. A complete reset. A little extra protection.
          <br />
          Find the right treatment for your vehicle.
        </p>
      </section>
      <section className="wrap section no-top">
        <ServiceCards services={d.services} />
        <p className="small-note">
          Prices shown are for sedans unless noted. Vehicle size and condition
          may affect the final scope. Additional work is approved before we
          begin. Maintenance pricing is discussed after assessing vehicle
          condition and schedule.
        </p>
      </section>
    </PageShell>
  );
}
