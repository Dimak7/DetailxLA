"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BookingReceipt } from "@/lib/platform/receipts";
import { money, timeLabel } from "@/lib/platform/types";
import { ReceiptActions } from "./ReceiptActions";
import { appointmentDate, confirmationView, needsPaymentVerification, type CheckoutHint } from "./booking-confirmation-state";
import { pollBookingStatus } from "./booking-status-poll";
import styles from "./BookingConfirmation.module.css";

export function BookingConfirmation({ initialReceipt, token, checkoutHint, cancellationPolicy, phone }: {
  initialReceipt: BookingReceipt;
  token: string;
  checkoutHint: CheckoutHint;
  cancellationPolicy: string;
  phone: string;
}) {
  const returned = checkoutHint === "returned";
  const [returnUnverified, setReturnUnverified] = useState(() => returned && needsPaymentVerification(initialReceipt, true));
  const [receipt, setReceipt] = useState(initialReceipt);
  const [checking, setChecking] = useState(() => needsPaymentVerification(initialReceipt, returned));
  const [checked, setChecked] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [unavailable, setVerificationUnavailable] = useState(false);
  const [checkoutUnverified, setCheckoutUnverified] = useState(false);
  const activeCheck = useRef<AbortController | null>(null);

  const checkStatus = useCallback(async (verifyReturn: boolean) => {
    activeCheck.current?.abort();
    const request = new AbortController();
    activeCheck.current = request;
    setChecking(true);
    setExhausted(false);
    setVerificationUnavailable(false);
    const result = await pollBookingStatus({
      id: initialReceipt.id, token, returned: verifyReturn, signal: request.signal,
      onReceipt: (next, verificationUnavailable) => {
        if (activeCheck.current !== request || request.signal.aborted) return;
        setReceipt(next);
        setChecked(true);
        setVerificationUnavailable(verificationUnavailable);
        if (!needsPaymentVerification(next, true)) setReturnUnverified(false);
        if (!verifyReturn && !verificationUnavailable) setCheckoutUnverified(false);
      },
      onUnavailable: () => {
        if (activeCheck.current === request && !request.signal.aborted) setVerificationUnavailable(true);
      },
    });
    if (activeCheck.current !== request || request.signal.aborted) return;
    activeCheck.current = null;
    setChecking(false);
    setExhausted(result === "timeout");
  }, [initialReceipt.id, token]);

  useEffect(() => {
    if (needsPaymentVerification(initialReceipt, returned)) void checkStatus(returned);
    return () => {
      activeCheck.current?.abort();
      activeCheck.current = null;
    };
  }, [initialReceipt, returned, checkStatus]);

  const view = confirmationView(receipt, { returned: returnUnverified || checkoutUnverified, checkoutHint, checked, checking, exhausted, verificationUnavailable: unavailable });
  const appointmentStatus = {
    new: "Awaiting confirmation", confirmed: "Confirmed", in_progress: "In progress",
    completed: "Completed", cancelled: "Cancelled", no_show: "Missed appointment",
  }[receipt.status];
  const contactPhone = phone.replace(/[^+\d]/g, "");
  const hasRefund = receipt.refundedCents > 0;

  return <div className={styles.page}>
    <div className={styles.container}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>YOUR APPOINTMENT</p>
        <div className={styles.liveStatus} role="status" aria-live="polite" aria-atomic="true">
          <span className={styles.badge} data-tone={view.kind === "paid_confirmed" || view.kind === "confirmed" ? "success" : "neutral"}>
            {checking && view.pending ? <span className={styles.spinner} aria-hidden="true" /> : null}{view.badge}
          </span>
          <h1>{view.title}</h1>
          <p className={styles.lead}>{view.message}</p>
        </div>
        <p className={styles.reference}>Booking reference <strong>{receipt.reference}</strong></p>
      </header>

      <div className={styles.layout}>
        <section className={styles.appointmentCard} aria-labelledby="appointment-details">
          <p className={styles.eyebrow}>APPOINTMENT DETAILS</p>
          <h2 id="appointment-details">{receipt.serviceName}</h2>
          <dl className={styles.details}>
            <div><dt>Date</dt><dd>{appointmentDate(receipt.date)}</dd></div>
            <div><dt>Time</dt><dd>{timeLabel(receipt.startMinute)} <span className={styles.timezone}>Central time (Chicago)</span></dd></div>
            <div><dt>Vehicle</dt><dd>{receipt.vehicle || "Details to be confirmed"}</dd></div>
            <div><dt>Location</dt><dd>{receipt.location || "Our team will confirm your appointment location."}</dd></div>
            <div><dt>Appointment</dt><dd>{appointmentStatus}</dd></div>
            <div><dt>Reference</dt><dd className={styles.referenceValue}>{receipt.reference}</dd></div>
          </dl>
          <p className={styles.privateNote}>Keep this private link for your booking and payment details.</p>
        </section>

        <section className={styles.paymentCard} aria-labelledby="payment-details">
          <p className={styles.eyebrow}>PAYMENT SUMMARY</p>
          <h2 id="payment-details">Clear from the start.</h2>
          <dl className={styles.amounts}>
            <div><dt>{receipt.priceCents === null ? "Service price" : view.kind === "quote" ? "Starting estimate" : "Service estimate"}</dt><dd>{money(receipt.priceCents)}</dd></div>
            <div><dt>{hasRefund ? "Net payment recorded" : "Payment recorded"}</dt><dd>{money(receipt.paidCents)}</dd></div>
            {hasRefund ? <div><dt>Refund recorded</dt><dd>{money(receipt.refundedCents)}</dd></div>
              : <div className={styles.balance}><dt>{view.pending && !view.resumeCheckout ? "Latest payment" : "Remaining service balance"}</dt><dd>{view.pending && !view.resumeCheckout ? "Checking" : view.balanceCents === null ? "To be agreed" : money(view.balanceCents)}</dd></div>}
          </dl>
          {hasRefund && <p className={styles.smallNote}>Total received before refunds: {money(receipt.paidCents + receipt.refundedCents)}. Contact us about any remaining charges or changes to this booking.</p>}
          {view.kind === "paid_confirmed" && !view.fullyPaid && <p className={styles.successNote}>{view.depositDue === 0 && receipt.depositCents > 0 ? "Your deposit is paid." : "Your payment is recorded."} {view.balanceCents === null ? "The final service price will be agreed with you." : "The remaining service balance is " + money(view.balanceCents) + "."}</p>}
          {view.pending && !view.resumeCheckout && <p className={styles.notice}>Your booking is saved. Please don’t pay again while the latest payment is being checked.</p>}
          {!view.pending && unavailable && <p className={styles.smallNote}>We couldn’t refresh every payment detail just now. Your last recorded status is shown above.</p>}

          <ReceiptActions id={receipt.id} token={token} deposit={view.offerDeposit} canPay={view.canPay}
            payments={receipt.payments} resumeCheckoutUrl={view.resumeCheckout ? receipt.pendingCheckoutUrl || null : null}
            onPaymentUncertain={() => {
              setCheckoutUnverified(true);
              void checkStatus(false);
            }} />
          <div className={styles.supportActions}>
            <button className={styles.secondaryButton} disabled={checking} onClick={() => void checkStatus(returnUnverified)}>{checking ? "Checking payment status…" : "Check payment status"}</button>
            <Link href="/contact" className={styles.textLink}>Contact us</Link>
          </div>
          <p className={styles.checkNote} role="status" aria-live="polite">
            {checking ? "This usually takes a moment. You can leave this page and return using your private link."
              : view.pending && !view.resumeCheckout ? "We’ll keep your booking details here. Check again shortly, or contact us with your reference."
                : checked && !unavailable ? "Your payment status has been checked." : "Payments shown here have been recorded against your booking."}
          </p>
        </section>
      </div>

      <footer className={styles.help}>
        <div><h2>Need to change something?</h2><p>Contact us with reference <strong>{receipt.reference}</strong> so we can help with your appointment.</p></div>
        <div className={styles.helpActions}><Link href="/contact" className={styles.textLink}>Contact the studio</Link>{contactPhone ? <a className={styles.textLink} href={"tel:" + contactPhone}>{phone}</a> : null}</div>
        {cancellationPolicy ? <p className={styles.policy}>{cancellationPolicy}</p> : null}
      </footer>
    </div>
  </div>;
}
