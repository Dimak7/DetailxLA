import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminErrorBanner, AdminPageHeader, FlashMessage } from "@/components/admin/AdminShell";
import { loadAdminData } from "@/lib/adminPageData";
import { formatMoney } from "@/lib/adminData";
import { getBusinessMetricsSettings } from "@/lib/businessMetricsStore";
import { getStartingPriceLabel } from "@/lib/pricing";
import { getPricedServices } from "@/lib/servicePricingStore";
import { timeSlots } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage({ searchParams }: { searchParams?: Promise<{ adminStatus?: string; adminMessage?: string }> }) {
  const params = await searchParams;
  const [pricingState, businessSettingsState] = await Promise.all([
    loadAdminData("settings services", () => getPricedServices(), []),
    loadAdminData("settings business metrics", () => getBusinessMetricsSettings(), { marketingExpense: 0, updatedAt: new Date(0).toISOString() }),
  ]);
  const pricedServices = pricingState.data;
  const businessSettings = businessSettingsState.data;

  return (
    <>
      <FlashMessage status={params?.adminStatus} message={params?.adminMessage} />
      <AdminErrorBanner message={pricingState.error || businessSettingsState.error} />
      <AdminPageHeader eyebrow="Config" title="Settings" copy="Operational defaults used by the current booking flow. Environment variables still control secrets and integrations." />
      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-ink/10">
          <h2 className="text-2xl font-black uppercase leading-none">Dashboard inputs</h2>
          <p className="mt-3 text-sm leading-6 text-steel">Update the marketing spend used in admin analytics without affecting booking or pricing logic.</p>
          <div className="mt-4 rounded-lg bg-smoke p-4 text-sm font-bold text-steel">
            Current monthly marketing input: <span className="text-ink">{formatMoney(businessSettings.marketingExpense)}</span>
          </div>
          <AdminActionForm className="mt-4 grid gap-3" pendingLabel="Saving..." refreshOnSuccess={false} submitClassName="rounded-lg bg-ink px-5 py-3 font-black uppercase text-white disabled:cursor-not-allowed disabled:opacity-60" submitLabel="Save Settings">
            <input type="hidden" name="action" value="update-business-metrics" />
            <input type="hidden" name="returnTo" value="/admin/settings" />
            <label className="grid gap-2 text-xs font-black uppercase tracking-[0.12em] text-steel">
              Marketing Spend
              <input className="admin-input" defaultValue={businessSettings.marketingExpense} inputMode="decimal" min="0" name="marketingExpense" type="number" />
            </label>
          </AdminActionForm>
        </article>
        <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-ink/10">
          <h2 className="text-2xl font-black uppercase leading-none">Business hours</h2>
          <p className="mt-3 text-sm leading-6 text-steel">Public booking accepts every hourly start from 6:00 AM through 7:00 PM so jobs fit inside the 6:00 AM to 10:00 PM service day.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {timeSlots.map((slot) => <span className="rounded-lg bg-smoke px-3 py-2 text-sm font-black" key={slot}>{slot}</span>)}
          </div>
        </article>
        <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-ink/10">
          <h2 className="text-2xl font-black uppercase leading-none">Service defaults</h2>
          <div className="mt-4 grid gap-2">
            {pricedServices.map((service) => (
              <div className="rounded-lg bg-smoke px-4 py-3" key={service.title}>
                <div className="flex items-start justify-between gap-4">
                  <p className="font-black uppercase">{service.title}</p>
                  <p className="shrink-0 text-sm font-black text-red">{getStartingPriceLabel(service.title, pricedServices)}</p>
                </div>
                <p className="mt-1 text-sm text-steel">Shown in booking flow and admin estimates.</p>
              </div>
            ))}
          </div>
        </article>
        <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-ink/10 lg:col-span-2">
          <h2 className="text-2xl font-black uppercase leading-none">Integration setup</h2>
          <div className="mt-4 grid gap-2 text-sm font-bold text-steel md:grid-cols-2">
            <p>Admin auth: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_SESSION_SECRET</p>
            <p>Email: RESEND_API_KEY, BUSINESS_EMAIL, EMAIL_FROM</p>
            <p>Payments: STRIPE_SECRET_KEY</p>
            <p>Database: DATABASE_URL, DATABASE_SSL</p>
          </div>
        </article>
      </section>
    </>
  );
}
