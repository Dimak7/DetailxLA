import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { BookingWizard } from "@/components/westloop/BookingWizard";
import {
  effectiveDepositPercent,
  paymentProvider,
} from "@/lib/platform/settings";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Book Your Visit",
  alternates: { canonical: "/booking" },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; package?: string }>;
}) {
  const d = await publicData();
  const provider = await paymentProvider();
  const bookingBusiness = {
    ...d.business,
    deposit_percent:
      provider === "square"
        ? effectiveDepositPercent(d.business)
        : d.business.deposit_percent,
  };
  const paymentsEnabled =
    provider === "square" ||
    (provider === "stripe" && bookingBusiness.deposit_percent > 0);
  const requested = await searchParams;
  const requestedService = requested.service;
  const selectedService = d.services.find((service) => service.id === requestedService || service.slug === requestedService);
  return (
    <PageShell business={d.business}>
      <section className="page-intro compact-intro wrap">
        <p className="eyebrow">YOUR NEXT GREAT FINISH</p>
        <h1>
          Make it <em>exceptional.</em>
        </h1>
        <p>{selectedService ? `${selectedService.name}, selected for your visit. Add your vehicle and find an available time.` : "Choose your care. Tell us about your vehicle. Find a time that works."}</p>
      </section>
      <BookingWizard
        services={d.services}
        business={bookingBusiness}
        paymentsEnabled={paymentsEnabled}
        initialService={selectedService?.id}
        initialPackage={requested.package}
      />
    </PageShell>
  );
}
