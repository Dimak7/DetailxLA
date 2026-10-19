"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, action, type RecordData } from "./AdminControls";
import { money } from "@/lib/platform/types";
export function JobPayments({ booking }: { booking: RecordData }) {
  const router = useRouter(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [url, setUrl] = useState(""),
    [createdInvoice, setCreatedInvoice] = useState(false);
  const invoice = booking.square_invoice as RecordData | undefined,
    total = booking.price_cents == null ? null : Number(booking.price_cents),
    paid = Number(booking.collected_cents || 0),
    due = total === null ? null : Math.max(0, total - paid),
    link = url || String(invoice?.url || "");
  async function save(name: string, kind = "balance") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action(name, { booking_id: booking.id, kind, request_id: crypto.randomUUID() });
      if (result?.queued) setNotice("Payment text queued for the customer. Check the customer timeline for delivery.");
      if (result?.url) {
        setUrl(String(result.url));
        setCreatedInvoice(name === "create_square_invoice");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment action failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button onClick={() => setOpen(true)}>Payments</button>
      {open && (
        <Modal
          title={`Payments · ${booking.reference}`}
          onClose={() => setOpen(false)}
        >
          {booking.square_environment==="sandbox"&&<p role="status"><strong>Sandbox invoice — test payments only.</strong></p>}
          <p>
            Book by phone → collect 50% deposit → detail the vehicle → collect
            the remaining balance → hand over the car.
          </p>
          <dl className="job-payment-totals">
            <div>
              <dt>Agreed service total</dt>
              <dd>{money(total)}</dd>
            </div>
            <div>
              <dt>Deposit required</dt>
              <dd>
                {money(
                  invoice
                    ? Math.round(Number(invoice.amount_cents) / 2)
                    : total === null ? null : Math.round(total / 2),
                )}
              </dd>
            </div>
            <div>
              <dt>Service payments collected</dt>
              <dd>{money(paid)}</dd>
            </div>
            <div>
              <dt>Service balance remaining</dt>
              <dd>{money(due)}</dd>
            </div>
            <div>
              <dt>Customer tips (separate)</dt>
              <dd>{money(Number(booking.tip_cents || 0))}</dd>
            </div>
          </dl>
          <p>
            <strong>
              {total === null
                ? "Agree the quote first"
                : paid === 0
                  ? "Awaiting deposit"
                  : due === 0
                    ? "Service paid in full"
                    : paid < Math.round(total / 2)
                      ? "Deposit partially paid"
                      : "Deposit received · balance due before handover"}
            </strong>
          </p>
          {booking.status === "completed" && Number(due) > 0 && (
            <p role="status">
              Detail complete. Collect the remaining service balance before
              releasing the vehicle.
            </p>
          )}
          <div className="button-row">
            <button disabled={busy || total === null || paid >= Math.round(Number(total) / 2)} onClick={() => void save("send_booking_payment_text", "deposit")}>Send deposit link by text</button>
            <button disabled={busy || total === null || !due} onClick={() => void save("send_booking_payment_text", "balance")}>Send balance link by text</button>
          </div>
          {notice && <p className="success-message" role="status">{notice}</p>}
          {link ? (
            <>
              <p>
                <a
                  className="button"
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open customer payment page
                </a>
              </p>
              <label>
                Share this payment link
                <input
                  readOnly
                  value={link}
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <p>
                {invoice || createdInvoice
                  ? "Use this same invoice for the deposit and final balance. It also appears in Square Invoices. The final payment offers tipping."
                  : "This booking uses its existing checkout collection flow. Share this secure link to collect the remaining amount."}
              </p>
            </>
          ) : paid > 0 || booking.has_checkout ? (
            <>
              <p>
                This booking already uses the existing checkout collection flow.
              </p>
              <button
                disabled={busy || !due}
                onClick={() => void save("create_payment")}
              >
                Get remaining balance link
              </button>
              {paid < Number(booking.deposit_cents) && (
                <button
                  disabled={busy}
                  onClick={() => void save("create_payment", "deposit")}
                >
                  Get deposit link
                </button>
              )}
            </>
          ) : (
            <>
              <p>
                Create one Square invoice for the whole detail: 50% due now and
                the rest due on the service date. It does not charge a card or
                send an email automatically. Share the link with the customer.
              </p>
              <p className="small-note">
                Taking payment in person? Open this invoice by its appointment
                reference in Square Invoices and collect it on the Square
                device. Do not start an unrelated custom-amount sale; the
                invoice order is what matches the payment and tip to this job.
              </p>
              <button
                className="button"
                disabled={busy || total === null || total < 2}
                onClick={() => void save("create_square_invoice")}
              >
                {busy ? "Connecting to Square…" : "Create 50% deposit invoice"}
              </button>
            </>
          )}
          {invoice && (
            <>
              <p className="small-note">
                For an in-person balance, open this appointment reference in
                Square Invoices and take the card payment there. Its payment,
                tip, fee and refund history will sync to this booking.
              </p>
              <button
                disabled={busy}
                onClick={() => void save("refresh_detail_invoice")}
              >
                Refresh Square payments
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          <p className="small-note">
            Use Manage to record Confirmed, In progress and Completed as the job
            progresses. Square controls payment status; marking a detail
            complete does not mark it paid. Existing checkout payments must
            finish their current collection flow.
          </p>
        </Modal>
      )}
    </>
  );
}
export function JobTipAllocation({
  booking,
  employees,
}: {
  booking: RecordData;
  employees: RecordData[];
}) {
  const router = useRouter(),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  function launch() {
    const existing = Array.isArray(booking.job_assignments)
      ? (booking.job_assignments as RecordData[])
      : [];
    const assigned = employees.find((e) => e.user_id === booking.assigned_to);
    setSelected(
      existing.length
        ? existing.map((a) => String(a.employee_id))
        : assigned
          ? [String(assigned.employee_id)]
          : [],
    );
    setError("");
    setOpen(true);
  }
  function toggle(employeeId: string) {
    setSelected((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId],
    );
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await action("save_job_assignments", {
        booking_id: booking.id,
        employee_ids: selected,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign detailers.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button onClick={launch}>Assign detailers</button>
      {open && (
        <Modal
          title={`Assign detailers · ${booking.reference}`}
          onClose={() => setOpen(false)}
        >
          <p>
            Select everyone working on this vehicle. Job credit and tips are
            divided automatically and evenly across the assigned detailers.
          </p>
          <div className="job-detailer-options">
            {employees.map((employee) => {
              const id = String(employee.employee_id);
              return (
                <label className="job-detailer-option" key={id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(id)}
                    onChange={() => toggle(id)}
                  />
                  <span>
                    <strong>{String(employee.name)}</strong>
                    <small>{String(employee.position || "Detailer")}</small>
                  </span>
                </label>
              );
            })}
          </div>
          {selected.length > 0 && (
            <p className="small-note" role="status">
              {selected.length === 1
                ? "This detailer receives 100% of the job credit and tip."
                : `${selected.length} detailers receive an equal ${(
                    100 / selected.length
                  ).toFixed(2)}% share. Any rounding cent is assigned consistently.`}
              {Number(booking.tip_cents || 0) > 0
                ? ` Current tip: ${money(Number(booking.tip_cents || 0))}.`
                : ""}
            </p>
          )}
          <div className="button-row">
            <button
              className="button"
              disabled={busy || !selected.length}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save assignments"}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          <p>
            Square and cash tips appear automatically in Payroll. Tips stay
            separate from service commission.
          </p>
        </Modal>
      )}
    </>
  );
}
