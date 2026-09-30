import { notFound } from "next/navigation";
import { z } from "zod";
import { verifyReceipt } from "@/lib/platform/auth";
import { bookingReceipt } from "@/lib/platform/receipts";
import { settings } from "@/lib/platform/settings";
import { PageShell } from "@/components/westloop/PageShell";
import { BookingConfirmation } from "@/components/westloop/BookingConfirmation";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your Appointment",
  robots: { index: false, follow: false },
};
export default async function Page({ searchParams }: {
  searchParams: Promise<{ id?: string; token?: string; payment?: string }>;
}) {
  const parameters = await searchParams;
  if (!z.uuid().safeParse(parameters.id).success || !parameters.token || !(await verifyReceipt(parameters.id!, parameters.token))) notFound();
  const [receipt, business] = await Promise.all([bookingReceipt(parameters.id!), settings()]);
  if (!receipt) notFound();
  const checkoutHint = parameters.payment === "returned" || parameters.payment === "cancelled" || parameters.payment === "unavailable" ? parameters.payment : "";
  return <PageShell business={business} showBookingCTA={false}>
    <BookingConfirmation key={receipt.id} initialReceipt={receipt} token={parameters.token}
      checkoutHint={checkoutHint} cancellationPolicy={business.cancellation_policy} phone={business.phone} />
  </PageShell>;
}
