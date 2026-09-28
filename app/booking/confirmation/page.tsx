import { notFound } from "next/navigation";
import { z } from "zod";
import { verifyReceipt } from "@/lib/platform/auth";
import { bookingById } from "@/lib/platform/bookings";
import { paymentProvider, settings } from "@/lib/platform/settings";
import { query } from "@/lib/platform/db";
import { money, timeLabel } from "@/lib/platform/types";
import { PageShell } from "@/components/westloop/PageShell";
import { ReceiptActions } from "@/components/westloop/ReceiptActions";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your Appointment",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; token?: string; payment?: string }>;
}) {
  const p = await searchParams;
  if (
    !z.uuid().safeParse(p.id).success ||
    !p.token ||
    !(await verifyReceipt(p.id!, p.token))
  )
    notFound();
  const b = await bookingById(p.id!),
    s = await settings(),
    provider = await paymentProvider();
  if (!b) notFound();
  const paid = Number(b.paid_cents || 0),
    quoteBased =
      b.service_snapshot.pricing_mode === "quote" ||
      b.service_snapshot.slug === "ceramic-coating",
    depositDue = b.deposit_cents > paid,
    payments = await query<{ id: string; amount_cents: number }>(
      "SELECT id,amount_cents FROM wl.payments WHERE booking_id=$1 AND status IN ('paid','partially_refunded','refunded')",
      [b.id],
    );
  return (
    <PageShell business={s}>
      <section className="page-intro compact-intro wrap">
        <p className="eyebrow">{b.reference}</p>
        <h1>
          {b.status === "confirmed" ? <>Time well <em>reserved.</em></> : <>Request <em>received.</em></>}
        </h1>
        <p>
          {b.status === "confirmed"
            ? "Your appointment is confirmed. Keep this private link for your records."
            : depositDue
              ? "Complete the secure deposit below to confirm your appointment."
              : quoteBased
                ? "We will review the vehicle details and contact you to confirm the ceramic coating scope and final quote."
                : "Your appointment request is saved. Keep this private link for your records."}
        </p>
      </section>
      <section className="receipt paper">
        <span className="status-pill">
          {depositDue ? "payment required" : b.status.replaceAll("_", " ")}
        </span>
        <h2>{b.service_name}</h2>
        {[
          ["Vehicle", b.vehicle],
          ["Date", b.booking_date],
          ["Time", timeLabel(b.start_minute) + " Central"],
          [
            "Location",
            b.location || "Our team will confirm your appointment location.",
          ],
          ["Service estimate", money(b.price_cents)],
          ["Verified payment", money(paid)],
          [
            "Balance",
            b.price_cents == null
              ? "To be agreed"
              : money(Math.max(0, b.price_cents - paid)),
          ],
        ].map(([k, v]) => (
          <div className="summary-row" key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
        {p.payment === "returned" && !payments.length && (
          <p className="small-note">
            Payment verification is pending. Refresh the status shortly. A
            checkout redirect alone is not proof of payment.
          </p>
        )}
        {p.payment === "unavailable" && depositDue && (
          <p className="error-message">
            Your request was saved, but secure checkout could not be opened.
            Please try the deposit button again or contact the studio.
          </p>
        )}
        {p.payment === "cancelled" && depositDue && (
          <p className="small-note">
            Payment was not completed. Your appointment remains unconfirmed.
          </p>
        )}
        <ReceiptActions
          id={b.id}
          token={p.token}
          deposit={b.deposit_cents > paid}
          canPay={
            Boolean(provider) &&
            b.price_cents !== null &&
            b.price_cents > paid &&
            !["cancelled", "no_show"].includes(b.status)
          }
          payments={payments}
          provider={provider}
        />
        <p className="small-note">
          Confirmation messages are sent when notification providers are
          configured. If you do not receive a message, this confirmation is your
          booking record. {s.cancellation_policy}
        </p>
        <a className="text-link" href="/contact">
          Need to change something? Contact us
        </a>
      </section>
    </PageShell>
  );
}
