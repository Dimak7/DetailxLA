import Link from "next/link";
import { siteConfig } from "@/lib/siteConfig";

export const metadata = {
  title: `Privacy Notice | ${siteConfig.brandName}`,
  description: `Privacy notice for ${siteConfig.brandName}, premium mobile detailing in Los Angeles.`,
};

export default function PrivacyNoticePage() {
  return (
    <main className="min-h-screen bg-smoke px-4 py-12 text-ink">
      <div className="content-shell max-w-4xl rounded-[1.8rem] bg-white p-6 shadow-[0_24px_90px_rgba(16,19,27,0.08)] ring-1 ring-ink/10 md:p-10">
        <p className="eyebrow">Privacy Notice</p>
        <h1 className="mt-4 text-4xl font-black uppercase leading-none md:text-6xl">How {siteConfig.brandName} handles your information.</h1>
        <div className="mt-8 grid gap-6 text-base leading-8 text-steel">
          <p>We collect the information you submit through our booking and contact forms, including your name, phone number, email address, vehicle details, service address, and appointment preferences.</p>
          <p>We use this information to schedule your appointment, confirm service details, send booking and invoice messages, manage admin records, and improve our operations.</p>
          <p>Payment and booking tools may involve third-party services such as Railway, Supabase or PostgreSQL storage, Resend, Telegram, Twilio, and Stripe where enabled. We only use those services to support the business workflow.</p>
          <p>We do not sell your personal information. We may retain booking and invoice records as required for operations, customer support, dispute resolution, and internal reporting.</p>
          <p>If you need to update or remove your information, contact us at <a className="font-bold text-ink" href={`mailto:${siteConfig.businessEmail}`}>{siteConfig.businessEmail}</a>.</p>
        </div>
        <Link className="mt-8 inline-flex rounded-lg bg-ink px-5 py-4 text-sm font-black uppercase text-white transition hover:bg-charcoal" href="/">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
