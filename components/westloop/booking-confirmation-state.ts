import type { BookingReceipt } from "@/lib/platform/receipts";

export type CheckoutHint = "returned" | "cancelled" | "unavailable" | "";
export type ConfirmationContext = {
  returned?: boolean;
  checkoutHint?: CheckoutHint;
  checked?: boolean;
  checking?: boolean;
  exhausted?: boolean;
  verificationUnavailable?: boolean;
};

/** A return URL starts verification; it never establishes that a payment succeeded. */
export function needsPaymentVerification(receipt: BookingReceipt, returned = false) {
  if (receipt.pendingPayment) return true;
  return returned && receipt.priceCents !== null && receipt.priceCents > 0
    && receipt.paidCents === 0 && receipt.refundedCents === 0 && !receipt.failedPayment;
}

export function confirmationView(receipt: BookingReceipt, context: ConfirmationContext = {}) {
  const pending = needsPaymentVerification(receipt, context.returned);
  const quoteAwaiting = receipt.status === "new" && receipt.paidCents === 0
    && (receipt.priceCents === null || (receipt.quoteBased && receipt.depositCents === 0));
  const balanceCents = receipt.priceCents === null || quoteAwaiting ? null : Math.max(0, receipt.priceCents - receipt.paidCents);
  const depositDue = Math.max(0, receipt.depositCents - receipt.paidCents);
  const fullyPaid = receipt.priceCents !== null && receipt.priceCents > 0 && balanceCents === 0;
  const terminal = ["cancelled", "no_show"].includes(receipt.status);
  const pendingCheckoutUrl = receipt.pendingCheckoutUrl;
  const resumeCheckout = Boolean(pendingCheckoutUrl) && receipt.pendingPayment && !context.returned
    && context.checked === true && !context.checking && !context.verificationUnavailable
    && !terminal && receipt.refundedCents === 0 && !quoteAwaiting;
  const base = {
    pending,
    balanceCents,
    depositDue,
    fullyPaid,
    resumeCheckout,
    canPay: Boolean(receipt.provider) && balanceCents !== null && balanceCents > 0
      && !pending && !context.checking && !terminal && receipt.refundedCents === 0,
    offerDeposit: depositDue > 0 && !["completed", "in_progress"].includes(receipt.status),
  };
  if (receipt.status === "cancelled") return {
    ...base, kind: "cancelled", badge: "Appointment cancelled", title: "Appointment cancelled.",
    message: "This appointment is no longer scheduled. Contact us if you need help with your payment or would like to arrange another visit.",
  };
  if (receipt.status === "no_show") return {
    ...base, kind: "no_show", badge: "Missed appointment", title: "Let’s arrange your next visit.",
    message: "This appointment was marked as missed. Contact us to discuss the booking and arrange a new time.",
  };
  if (resumeCheckout) return {
    ...base, kind: "checkout_incomplete", badge: "Checkout not completed",
    title: context.checkoutHint === "cancelled" ? "Checkout was closed." : "Your checkout is ready to continue.",
    message: receipt.paidCents > 0
      ? "Your earlier payment is recorded. No new payment is recorded for this checkout. You can continue the same secure checkout or contact us for help."
      : "Your booking request is saved. No completed payment is recorded for this checkout. You can continue the same secure checkout or contact us for help.",
  };
  if (pending) return {
    ...base, kind: "pending", badge: "Payment verification pending",
    title: context.exhausted ? "Your booking is saved." : receipt.paidCents > 0 ? "Checking your balance payment." : "Checking your payment.",
    message: context.exhausted
      ? "Your payment is still being verified. Please don’t pay again. You can check the status below or contact us with your booking reference."
      : receipt.paidCents > 0
        ? "Your earlier payment is recorded. We’re checking the latest payment now—please don’t pay again while we confirm it."
        : "Your booking details are saved. We’re checking your payment now. Please don’t pay again while we confirm it.",
  };
  if (receipt.refundedCents > 0) return {
    ...base, kind: "refunded", badge: receipt.paidCents > 0 ? "Partial refund recorded" : "Refund recorded", title: "Your payment has been updated.",
    message: "A refund has been recorded for this booking. Your payment totals and appointment status are shown below. Contact us with any questions.",
  };
  if (receipt.status === "completed") return {
    ...base, kind: "completed", badge: "Service completed", title: "Thank you for visiting.",
    message: fullyPaid ? "Your service is complete and your payment is recorded. Keep this private link for your records."
      : "Your service is complete. Your recorded payments and any remaining service balance are shown below.",
  };
  if (receipt.status === "in_progress") return {
    ...base, kind: "in_progress", badge: "Service in progress", title: "Your vehicle is in our care.",
    message: "Your appointment is in progress. Your recorded payments and service details are shown below.",
  };
  if (receipt.failedPayment && !fullyPaid) return {
    ...base, kind: "failed", badge: "Latest payment not completed", title: "Your latest payment wasn’t completed.",
    message: receipt.paidCents > 0
      ? "Your earlier payment is still recorded. The latest payment did not complete. Check the balance below or contact us for help."
      : "Your booking request is saved, but no completed payment is recorded. You can try checkout again or contact us for help.",
  };
  if (receipt.status === "confirmed" && receipt.paidCents > 0) return {
    ...base, kind: "paid_confirmed", badge: fullyPaid ? "Paid in full" : depositDue === 0 && receipt.depositCents > 0 ? "Deposit paid" : "Payment received", title: "You’re all set.",
    message: "Your payment was received and your appointment is confirmed.",
  };
  if (receipt.paidCents > 0) return {
    ...base, kind: "paid_unconfirmed", badge: "Payment received", title: "Your payment was received.",
    message: "Your payment is recorded. Your appointment is awaiting confirmation; contact us if you need help with the remaining steps.",
  };
  if (receipt.status === "confirmed") return {
    ...base, kind: "confirmed", badge: "Appointment confirmed", title: "Your appointment is confirmed.",
    message: "Your time is reserved. Keep this private link for your appointment details and any remaining service balance.",
  };
  if (!context.checked && context.checkoutHint === "cancelled") return {
    ...base, kind: "checkout_cancelled", badge: "Booking request saved", title: "Checkout was closed.",
    message: "Your booking request is saved. No completed payment is recorded. Check the payment status below or contact us if you need help.",
  };
  if (!context.checked && context.checkoutHint === "unavailable") return {
    ...base, kind: "checkout_unavailable", badge: "Booking request saved", title: "Your booking request is saved.",
    message: "Checkout couldn’t be opened. You can check your payment status below or contact us to complete the next step.",
  };
  if (quoteAwaiting) return {
    ...base, kind: "quote", badge: "Quote request received", title: "Your request is with us.",
    message: "We’ll review your vehicle and service details, then contact you to agree the scope, price and appointment. No payment is due online yet.",
  };
  return {
    ...base, kind: "requested", badge: "Booking request received", title: "Your request is saved.",
    message: depositDue > 0
      ? "Your details are saved. Complete the deposit below to confirm your appointment, or contact us if you need a hand."
      : "We’ll review your request and contact you to confirm the appointment. Keep this private link for your records.",
  };
}

/** Format the stored Chicago calendar date without converting it into the visitor’s timezone. */
export function appointmentDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(value.getTime()) ? date : new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago",
  }).format(value);
}
