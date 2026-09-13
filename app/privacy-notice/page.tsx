import { settings } from "@/lib/platform/settings";
import { PageShell } from "@/components/westloop/PageShell";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Privacy Notice",
  alternates: { canonical: "/privacy-notice" },
};
export default async function Page() {
  const b = await settings();
  return (
    <PageShell business={b}>
      <article className="legal wrap">
        <p className="eyebrow">YOUR INFORMATION</p>
        <h1>Privacy notice.</h1>
        <p>
          We collect contact details, vehicle information, appointment requests,
          consent choices and website attribution data to provide our services
          and understand which channels generate bookings.
        </p>
        <h2>How we use information</h2>
        <p>
          We use your information to manage appointments, answer questions,
          process payments through our payment provider and send service-related
          communications. Marketing email and SMS require separate, optional
          consent. You can unsubscribe from email or reply STOP to promotional
          texts at any time.
        </p>
        <h2>Providers & tracking</h2>
        <p>
          Configured service providers may process messages, payments or
          analytics on our behalf. Google and Meta tracking may use browser
          identifiers and advertising click identifiers when enabled. We do not
          store payment card details. We do not sell customer contact lists.
        </p>
        <h2>Retention & requests</h2>
        <p>
          We retain records as needed to operate the business and meet
          recordkeeping obligations. Contact us to request access, correction or
          deletion of your information, subject to applicable requirements.
        </p>
        <p>
          {b.email ? (
            <a href={"mailto:" + b.email}>{b.email}</a>
          ) : (
            <a href="/contact">Contact us about privacy</a>
          )}
        </p>
      </article>
    </PageShell>
  );
}
