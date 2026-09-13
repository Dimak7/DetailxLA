import { publicData } from "@/lib/platform/public";
import { PageShell } from "@/components/westloop/PageShell";
import { CallLink } from "@/components/westloop/PublicShell";
import { ContactForm } from "@/components/westloop/ContactForm";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Contact & Visit",
  alternates: { canonical: "/contact" },
};
export default async function Page() {
  const { business } = await publicData();
  return (
    <PageShell business={business}>
      <section className="page-intro wrap">
        <p className="eyebrow">LET'S TALK CAR CARE</p>
        <h1>
          You're in
          <br />
          <em>good hands.</em>
        </h1>
      </section>
      <section className="contact-grid wrap section no-top">
        <div>
          <h2>Visit the spa.</h2>
          <p>
            {business.address ||
              "West Loop, Chicago. Appointment location confirmed before your visit."}
          </p>
          <p>{business.hours_label}</p>
          <p>{business.service_area}</p>
          {business.phone && (
            <CallLink phone={business.phone} className="text-link" />
          )}
          {business.email && (
            <p>
              <a href={"mailto:" + business.email}>{business.email}</a>
            </p>
          )}
          {business.address && (
            <a
              className="text-link"
              target="_blank"
              rel="noreferrer"
              href={
                "https://www.google.com/maps/search/?api=1&query=" +
                encodeURIComponent(business.address)
              }
            >
              Get directions ↗
            </a>
          )}
        </div>
        <div className="paper">
          <h2>A question first?</h2>
          <p>Tell us about your vehicle and what you have in mind.</p>
          <ContactForm />
        </div>
      </section>
    </PageShell>
  );
}
