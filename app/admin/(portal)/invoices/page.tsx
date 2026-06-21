import Link from "next/link";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminErrorBanner, AdminPageHeader, FlashMessage, StatusBadge } from "@/components/admin/AdminShell";
import { loadAdminData } from "@/lib/adminPageData";
import { formatMoney } from "@/lib/adminData";
import { listInvoices } from "@/lib/invoiceStore";

export const dynamic = "force-dynamic";

export default async function AdminInvoicesPage({ searchParams }: { searchParams?: Promise<{ adminStatus?: string; adminMessage?: string; payment?: string }> }) {
  const params = await searchParams;
  const invoicesState = await loadAdminData(
    "invoices list",
    () => listInvoices(),
    [],
    "Invoice records are temporarily unavailable. The error was logged on the server."
  );
  const invoices = invoicesState.data;

  return (
    <>
      <FlashMessage status={params?.adminStatus} message={params?.adminMessage} />
      <AdminErrorBanner message={invoicesState.error} />
      {params?.payment ? <p className="mb-5 rounded-lg bg-ink px-4 py-3 text-sm font-black uppercase text-white">Stripe payment returned: {params.payment}</p> : null}
      <AdminPageHeader
        eyebrow="Payments"
        title="Invoices"
        copy="Create Stripe-hosted payment links from booking data and track invoice status."
        action={<Link className="rounded-lg bg-red px-5 py-4 text-center font-black uppercase text-white" href="/admin/bookings">Create from booking</Link>}
      />
      <section className="grid gap-4">
        {invoices.length ? invoices.map((invoice) => (
          <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-ink/10" key={invoice.id}>
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={invoice.status} />
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-steel">Booking {invoice.bookingId}</p>
                </div>
                <h2 className="mt-3 text-2xl font-black uppercase leading-none">{invoice.customerName || "Not provided"}</h2>
                <p className="mt-2 text-sm font-bold text-steel">{invoice.customerEmail || "Not provided"} / {formatMoney(invoice.amount)}</p>
                {invoice.paymentUrl ? <a className="mt-3 inline-flex text-sm font-black uppercase text-red" href={invoice.paymentUrl} target="_blank" rel="noreferrer">Open payment link</a> : null}
              </div>
              <AdminActionForm className="flex flex-wrap gap-2" pendingLabel="Updating..." submitClassName="rounded-lg bg-ink px-4 py-3 text-sm font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-60" submitLabel="Update">
                <input type="hidden" name="action" value="update-invoice-status" />
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="returnTo" value="/admin/invoices" />
                <select className="admin-input" name="status" defaultValue={invoice.status}>
                  <option value="draft">draft</option>
                  <option value="sent">sent</option>
                  <option value="paid">paid</option>
                  <option value="overdue">overdue</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </AdminActionForm>
            </div>
          </article>
        )) : (
          <div className="rounded-lg bg-white p-8 text-center ring-1 ring-ink/10">
            <p className="font-black uppercase">No invoices yet.</p>
            <p className="mt-2 text-sm text-steel">Open a booking and click Create Invoice to generate a Stripe payment link.</p>
          </div>
        )}
      </section>
    </>
  );
}
