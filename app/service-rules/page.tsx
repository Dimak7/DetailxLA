import { settings } from "@/lib/platform/settings";
import { PageShell } from "@/components/westloop/PageShell";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Service Terms",
  alternates: { canonical: "/service-rules" },
};
export default async function Page() {
  const b = await settings();
  return (
    <PageShell business={b}>
      <article className="legal wrap">
        <p className="eyebrow">CLEAR FROM THE START</p>
        <h1>Service terms.</h1>
        <h2>Appointments & pricing</h2>
        <p>
          Prices, estimated duration and service inclusions are displayed when
          booking. Starting prices and consultations are not fixed quotes.
          Vehicle condition, size and additional requests can affect scope.
          Additional charges require your approval before work begins.
        </p>
        <h2>Before your appointment</h2>
        <p>
          Remove valuables and personal items. Tell us about existing damage,
          aftermarket finishes, delicate materials and any safety concerns.
          Access and service location must be agreed before the appointment.
        </p>
        <h2>Cancellations & changes</h2>
        <p>{b.cancellation_policy}</p>
        <h2>Deposits & payment</h2>
        <p>
          Any applicable deposit is shown in your booking summary. Payment is
          processed securely by our payment provider. An appointment is not
          marked paid until verified payment confirmation is received.
        </p>
        <h2>Results & concerns</h2>
        <p>
          Some stains, odors, scratches or wear cannot be fully corrected. We
          will discuss realistic expectations for your vehicle. Contact us
          promptly about any service concern so we can review it together.
        </p>
        <a className="text-link" href="/contact">
          Contact the team ↗
        </a>
      </article>
    </PageShell>
  );
}
