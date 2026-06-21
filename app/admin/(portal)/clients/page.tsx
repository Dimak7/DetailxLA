import { AdminErrorBanner, AdminPageHeader, FlashMessage } from "@/components/admin/AdminShell";
import { ClientEmailForm, type PromotionTemplate } from "@/components/admin/ClientEmailForm";
import { loadAdminData } from "@/lib/adminPageData";
import { buildAdminClients, formatMoney } from "@/lib/adminData";
import { listBookings } from "@/lib/bookingStore";

export const dynamic = "force-dynamic";

const promotionTemplates: PromotionTemplate[] = [
  {
    label: "Free wax",
    subject: "Book 2 details and get a free wax",
    message: "Book 2 details with DETAILX LA and we will include a free wax with your appointment.",
  },
  {
    label: "Rebook",
    subject: "Ready for your next DETAILX LA detail?",
    message: "Your vehicle is due for a fresh reset. Book a mobile detail and we'll bring premium care back to your location.",
  },
  {
    label: "Seasonal",
    subject: "Seasonal DETAILX LA refresh",
    message: "Keep your vehicle looking sharp this season. We have mobile detailing openings available for returning clients.",
  },
];

export default async function AdminClientsPage({ searchParams }: { searchParams?: Promise<{ search?: string; segment?: string; adminStatus?: string; adminMessage?: string }> }) {
  const params = await searchParams;
  const search = (params?.search || "").toLowerCase();
  const segment = params?.segment || "all";
  const clientsState = await loadAdminData(
    "clients list",
    async () => buildAdminClients(await listBookings()),
    [],
    "Client records are temporarily unavailable. The error was logged on the server."
  );
  const clients = clientsState.data
    .filter((client) => !search || [client.name, client.email, client.phone, client.address].some((value) => (value || "").toLowerCase().includes(search)))
    .filter((client) => segment === "all" || client.tags.includes(segment));

  return (
    <>
      <FlashMessage status={params?.adminStatus} message={params?.adminMessage} />
      <AdminErrorBanner message={clientsState.error} />
      <AdminPageHeader eyebrow="CRM" title="Clients" copy="Lightweight customer profiles generated from the shared booking history." />
      <form className="mb-5 grid gap-3 rounded-lg bg-white p-4 ring-1 ring-ink/10 md:grid-cols-[1fr_1fr_auto]" action="/admin/clients">
        <input className="admin-input" name="search" defaultValue={params?.search || ""} placeholder="Search name, phone, email, address" />
        <select className="admin-input" name="segment" defaultValue={segment}>
          <option value="all">All clients</option>
          <option value="Repeat customer">Repeat customers</option>
          <option value="No booking in 60 days">No booking in 60 days</option>
          <option value="Tint lead">Tint leads</option>
          <option value="Ceramic lead">Ceramic leads</option>
        </select>
        <button className="rounded-lg bg-ink px-5 py-3 font-black uppercase text-white" type="submit">Filter</button>
      </form>
      <section className="grid gap-4 lg:grid-cols-2">
        {clients.length ? clients.map((client) => (
          <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-ink/10" key={client.id}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-2xl font-black uppercase leading-none">{client.name}</h2>
                <p className="mt-2 text-sm font-bold text-steel">{client.phone || "Not provided"} / {client.email || "Not provided"}</p>
                <p className="mt-1 text-sm text-steel">{client.address || "Not provided"}</p>
              </div>
              <p className="rounded-lg bg-ink px-4 py-3 text-sm font-black uppercase text-white">{formatMoney(client.totalSpent)}</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {client.tags.length ? client.tags.map((tag) => <span className="rounded-lg bg-red-soft px-3 py-1 text-xs font-black uppercase text-ink" key={tag}>{tag}</span>) : <span className="rounded-lg bg-smoke px-3 py-1 text-xs font-black uppercase text-steel">New customer</span>}
            </div>
            <div className="mt-4 grid gap-2 rounded-lg bg-smoke p-4 text-sm">
              <p><b>Vehicles:</b> {client.vehicles.join(", ") || "Not provided"}</p>
              <p><b>Last service:</b> {client.lastServiceDate}</p>
              <p><b>Booking history:</b> {client.bookings.length} booking{client.bookings.length === 1 ? "" : "s"}</p>
            </div>
            <details className="mt-4 rounded-lg border border-ink/10 bg-white p-4">
              <summary className="cursor-pointer font-black uppercase text-red">Email client</summary>
              <ClientEmailForm
                client={{ name: client.name, email: client.email }}
                returnTo={`/admin/clients?${new URLSearchParams({
                  ...(params?.search ? { search: params.search } : {}),
                  ...(segment !== "all" ? { segment } : {}),
                }).toString()}`}
                templates={promotionTemplates}
              />
            </details>
          </article>
        )) : <p className="rounded-lg bg-white p-8 text-center font-bold text-steel ring-1 ring-ink/10">No clients match this view.</p>}
      </section>
    </>
  );
}
