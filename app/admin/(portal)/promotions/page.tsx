import { AdminErrorBanner, AdminPageHeader } from "@/components/admin/AdminShell";
import { loadAdminData } from "@/lib/adminPageData";
import { buildAdminClients } from "@/lib/adminData";
import { listBookings } from "@/lib/bookingStore";

export const dynamic = "force-dynamic";

const segments = ["No booking in 60 days", "Repeat customer", "Tint lead", "Ceramic lead"];

export default async function AdminPromotionsPage() {
  const clientsState = await loadAdminData(
    "promotion client segments",
    async () => buildAdminClients(await listBookings()),
    [],
    "Promotion segments are temporarily unavailable. The error was logged on the server."
  );
  const clients = clientsState.data;

  return (
    <>
      <AdminErrorBanner message={clientsState.error} />
      <AdminPageHeader eyebrow="Growth" title="Promotions" copy="Preparation lists for future email or SMS outreach. Mass sending is intentionally not enabled yet." />
      <section className="grid gap-4 lg:grid-cols-2">
        {segments.map((segment) => {
          const matches = clients.filter((client) => client.tags.includes(segment));
          return (
            <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-ink/10" key={segment}>
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-2xl font-black uppercase leading-none">{segment}</h2>
                <span className="rounded-lg bg-ink px-3 py-2 text-sm font-black text-white">{matches.length}</span>
              </div>
              <div className="mt-4 grid gap-2">
                {matches.slice(0, 8).map((client) => (
                  <div className="rounded-lg bg-smoke px-4 py-3" key={client.id}>
                    <p className="font-black uppercase">{client.name}</p>
                    <p className="text-sm text-steel">{client.email || "Not provided"} / {client.phone || "Not provided"}</p>
                  </div>
                ))}
                {!matches.length ? <p className="rounded-lg bg-smoke p-4 text-sm font-bold text-steel">No customers in this segment yet.</p> : null}
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}
