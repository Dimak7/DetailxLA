import Link from "next/link";
import { siteConfig } from "@/lib/siteConfig";

export const metadata = {
  title: `Service Rules | ${siteConfig.brandName}`,
  description: `Service rules and terms for ${siteConfig.brandName} mobile detailing in Los Angeles.`,
};

const rules = [
  "Appointments require accurate contact, vehicle, and service-location details.",
  "Final service time can vary based on vehicle size, condition, access, weather, and add-on scope.",
  "Monthly maintenance service pricing is discussed after vehicle condition and schedule frequency are reviewed.",
  "For safety and quality reasons, we may reschedule if weather, parking access, or site conditions are not suitable.",
  "Customers are responsible for confirming that the service location allows mobile detailing activity.",
  "Invoice and payment requests are due according to the payment terms provided after service or invoice creation.",
  "By booking, you agree that estimate-based services may be adjusted if the vehicle condition differs materially from the booking description.",
];

export default function ServiceRulesPage() {
  return (
    <main className="min-h-screen bg-smoke px-4 py-12 text-ink">
      <div className="content-shell max-w-4xl rounded-[1.8rem] bg-white p-6 shadow-[0_24px_90px_rgba(16,19,27,0.08)] ring-1 ring-ink/10 md:p-10">
        <p className="eyebrow">Service Rules</p>
        <h1 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">Booking and service terms.</h1>
        <div className="mt-8 grid gap-4">
          {rules.map((rule) => (
            <div className="rounded-[1.2rem] bg-smoke px-5 py-4 text-base leading-8 text-steel" key={rule}>
              {rule}
            </div>
          ))}
        </div>
        <p className="mt-8 text-base leading-8 text-steel">Questions about service setup, pricing scope, or access can be sent to <a className="font-bold text-ink" href={`mailto:${siteConfig.businessEmail}`}>{siteConfig.businessEmail}</a>.</p>
        <Link className="mt-8 inline-flex rounded-lg bg-ink px-5 py-4 text-sm font-black uppercase text-white transition hover:bg-charcoal" href="/">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
