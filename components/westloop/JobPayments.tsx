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
    try {
      const result = await action(name, { booking_id: booking.id, kind });
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
                    : Math.round(Number(total || 0) / 2),
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
            <button
              disabled={busy}
              onClick={() => void save("refresh_detail_invoice")}
            >
              Refresh Square payments
            </button>
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
  type Split = { employee_id: string; share: string; tip: string };
  const [splits, setSplits] = useState<Split[]>([]),
    [explicit, setExplicit] = useState(false);
  function launch() {
    const existing = Array.isArray(booking.job_assignments)
      ? (booking.job_assignments as RecordData[])
      : [];
    const assigned = employees.find((e) => e.user_id === booking.assigned_to);
    setSplits(
      existing.length
        ? existing.map((a) => ({
            employee_id: String(a.employee_id),
            share: String(Number(a.pool_share_bps) / 100),
            tip:
              a.tip_override_cents == null
                ? ""
                : String(Number(a.tip_override_cents) / 100),
          }))
        : assigned
          ? [
              {
                employee_id: String(assigned.employee_id),
                share: "100",
                tip: "",
              },
            ]
          : [],
    );
    setExplicit(existing.some((a) => a.tip_override_cents != null));
    setError("");
    setOpen(true);
  }
  function change(index: number, key: keyof Split, value: string) {
    setSplits(
      splits.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      await action("save_job_assignments", {
        booking_id: booking.id,
        assignments: splits.map((row) => ({
          employee_id: row.employee_id,
          pool_share_bps: Math.round(Number(row.share) * 100),
          tip_override_cents: explicit
            ? Math.round(Number(row.tip) * 100)
            : null,
        })),
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not allocate tips.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button onClick={launch}>Detailers & tip split</button>
      {open && (
        <Modal
          title={`Detailers & tips · ${booking.reference}`}
          onClose={() => setOpen(false)}
        >
          <p>
            Total tip: <strong>{money(Number(booking.tip_cents || 0))}</strong>.
            Assign the detailers who worked this job. Job shares must add up to
            100% and control their commission allocation.
          </p>
          <label>
            <input
              type="checkbox"
              checked={explicit}
              onChange={(e) => setExplicit(e.target.checked)}
            />{" "}
            Set individual tip amounts
          </label>
          <p className="small-note">
            Otherwise tips split equally among the assigned detailers.
            Individual amounts must add up to the total tip. Changing the total
            tip resets individual amounts to an equal split.
          </p>
          {splits.map((row, index) => (
            <div className="job-tip-row" key={index}>
              <label>
                Detailer
                <select
                  value={row.employee_id}
                  onChange={(e) => change(index, "employee_id", e.target.value)}
                >
                  <option value="">Choose detailer</option>
                  {employees.map((e) => (
                    <option
                      key={String(e.employee_id)}
                      value={String(e.employee_id)}
                    >
                      {String(e.name)}
                    </option>
                  ))}
                  {!employees.some((e) => e.employee_id === row.employee_id) &&
                    row.employee_id && (
                      <option value={row.employee_id}>
                        Previously assigned detailer
                      </option>
                    )}
                </select>
              </label>
              <label>
                Job share (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={row.share}
                  onChange={(e) => change(index, "share", e.target.value)}
                />
              </label>
              {explicit && (
                <label>
                  Tip ($)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.tip}
                    onChange={(e) => change(index, "tip", e.target.value)}
                  />
                </label>
              )}
              <>
                {!explicit && (
                  <span>
                    Tip:{" "}
                    {money(
                      Math.floor(
                        Number(booking.tip_cents || 0) / splits.length,
                      ) +
                        (row.employee_id ===
                        [...splits].sort((a, b) =>
                          a.employee_id.localeCompare(b.employee_id),
                        )[0]?.employee_id
                          ? Number(booking.tip_cents || 0) % splits.length
                          : 0),
                    )}
                  </span>
                )}
              </>
              <button
                onClick={() => setSplits(splits.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="button-row">
            <button
              onClick={() =>
                setSplits([
                  ...splits,
                  {
                    employee_id: "",
                    share: splits.length ? "0" : "100",
                    tip: "0",
                  },
                ])
              }
            >
              Add detailer
            </button>
            <button
              className="button"
              disabled={busy || !splits.length}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save allocations"}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          <p>
            See each detailer’s tips in Team → Payroll and Performance. Tips
            stay separate from service commission.
          </p>
        </Modal>
      )}
    </>
  );
}
