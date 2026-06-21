import { AdminActionForm as AsyncAdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminErrorBanner, AdminPageHeader, FlashMessage, StatusBadge } from "@/components/admin/AdminShell";
import { InvoiceCreateButton } from "@/components/admin/InvoiceCreateButton";
import { loadAdminData } from "@/lib/adminPageData";
import { getBookingDetails } from "@/lib/adminData";
import { listBookings, type BookingStatus } from "@/lib/bookingStore";
import { freeWaxBonusLabel, hasFreeWaxBonus } from "@/lib/pricing";
import { getPricedServices } from "@/lib/servicePricingStore";
import { timeSlots } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function AdminBookingsPage({ searchParams }: { searchParams?: Promise<{ date?: string; status?: BookingStatus | "all"; service?: string; search?: string; adminStatus?: string; adminMessage?: string }> }) {
  const params = await searchParams;
  const [pricingState, bookingsState] = await Promise.all([
    loadAdminData("priced services for bookings", () => getPricedServices(), []),
    loadAdminData(
      "bookings list",
      () =>
        listBookings({
          date: params?.date,
          status: params?.status || "all",
          service: params?.service || "all",
          search: params?.search,
        }),
      [],
      "Bookings are temporarily unavailable. The issue has been logged on the server."
    ),
  ]);
  const pricedServices = pricingState.data;
  const bookings = bookingsState.data;
  const returnToParams = new URLSearchParams({
    ...(params?.date ? { date: params.date } : {}),
    ...(params?.status ? { status: params.status } : {}),
    ...(params?.service ? { service: params.service } : {}),
    ...(params?.search ? { search: params.search } : {}),
  }).toString();
  const returnTo = returnToParams ? `/admin/bookings?${returnToParams}` : "/admin/bookings";

  return (
    <>
      <FlashMessage status={params?.adminStatus} message={params?.adminMessage} />
      <AdminErrorBanner message={bookingsState.error || pricingState.error} />
      <AdminPageHeader eyebrow="Manage" title="Bookings" copy="Confirm, cancel, resend confirmations, create invoices, and review customer details." />
      <form className="mb-5 grid gap-3 rounded-lg bg-white p-4 ring-1 ring-ink/10 md:grid-cols-[1fr_1fr_1fr_1fr_auto]" action="/admin/bookings">
        <input className="admin-input" name="search" defaultValue={params?.search || ""} placeholder="Search customer, email, phone" />
        <input className="admin-input" name="date" defaultValue={params?.date || ""} type="date" />
        <select className="admin-input" name="status" defaultValue={params?.status || "all"}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select className="admin-input" name="service" defaultValue={params?.service || "all"}>
          <option value="all">All services</option>
          {pricedServices.map((service) => <option key={service.title} value={service.title}>{service.title}</option>)}
        </select>
        <button className="rounded-lg bg-ink px-5 py-3 font-black uppercase text-white" type="submit">Filter</button>
      </form>

      <section className="grid gap-4">
        {bookings.length ? bookings.map((booking) => (
          <article className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-ink/10" key={booking.id}>
            <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={booking.status} />
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-steel">ID {booking.id}</p>
                </div>
                <h2 className="mt-3 text-2xl font-black uppercase leading-none">{getDisplayValue(booking.name)}</h2>
                <div className="mt-4 grid gap-3 rounded-lg bg-smoke p-4 text-sm text-steel md:grid-cols-2">
                  <p><b>Date:</b> {getDisplayValue(booking.date)}</p>
                  <p><b>Time:</b> {getDisplayValue(booking.time)}</p>
                  <p><b>Service:</b> {getDisplayValue(booking.service)}</p>
                  <p><b>Price:</b> {getDisplayValue(booking.estimatedPrice, "Estimate pending")}</p>
                  <p><b>Phone:</b> {getDisplayValue(booking.phone)}</p>
                  <p><b>Email:</b> {getDisplayValue(booking.email)}</p>
                  <p><b>Address:</b> {getDisplayValue(booking.address)}</p>
                  <p><b>Vehicle:</b> {getDisplayValue(booking.carModel || booking.vehicleType)}</p>
                </div>
                <div className="mt-4 grid gap-2">
                  {getBookingDetails(booking).map((detail) => (
                    <div className="rounded-lg bg-smoke px-4 py-3" key={detail.lineNumber}>
                      <p className="font-black uppercase">Detail {detail.lineNumber}: {getDisplayValue(detail.service)}</p>
                      <p className="text-sm font-bold text-steel">{getDisplayValue(detail.vehicleType)} / {getDisplayValue(detail.estimatedPrice, "Estimate pending")}</p>
                      <p className="mt-1 text-sm text-steel"><b>Notes:</b> {getDisplayValue(detail.notes)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-ink/10 bg-white p-4 text-sm text-steel">
                  <p><b>Booking notes:</b> {getDisplayValue(booking.notes)}</p>
                </div>
                {hasFreeWaxBonus(getBookingDetails(booking)) ? <p className="mt-3 text-sm font-black uppercase text-red">Bonus: {freeWaxBonusLabel}</p> : null}
              </div>
              <div className="grid gap-3">
                <BookingStatusActions bookingId={booking.id} returnTo={returnTo} />
                <AsyncAdminActionForm className="rounded-lg bg-smoke p-3" pendingLabel="Rescheduling..." submitClassName="rounded-lg border border-ink/10 px-4 py-3 text-sm font-black uppercase disabled:cursor-not-allowed disabled:opacity-60" submitLabel="Reschedule">
                  <input type="hidden" name="action" value="reschedule-booking" />
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input className="admin-input" name="date" type="date" defaultValue={booking.date} required />
                  <select className="admin-input" name="time" defaultValue={booking.time} required>
                    {timeSlots.map((time) => <option key={time} value={time}>{time}</option>)}
                  </select>
                </AsyncAdminActionForm>
              </div>
            </div>
          </article>
        )) : <p className="rounded-lg bg-white p-8 text-center font-bold text-steel ring-1 ring-ink/10">No bookings match this view.</p>}
      </section>
    </>
  );
}

function getDisplayValue(value?: string | null, fallback = "Not provided") {
  return value && value.trim() ? value : fallback;
}

function BookingStatusActions({ bookingId, returnTo }: { bookingId: string; returnTo: string }) {
  return (
    <div className="grid gap-2 rounded-lg bg-smoke p-3">
      {["confirmed", "cancelled", "completed"].map((status) => (
        <AsyncAdminActionForm key={status} pendingLabel="Saving..." submitClassName="w-full rounded-lg bg-ink px-4 py-3 text-sm font-black uppercase text-white disabled:cursor-not-allowed disabled:bg-steel" submitLabel={`Mark ${status}`}>
          <input type="hidden" name="action" value="update-booking-status" />
          <input type="hidden" name="bookingId" value={bookingId} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="returnTo" value={returnTo} />
        </AsyncAdminActionForm>
      ))}
      <AsyncAdminActionForm pendingLabel="Sending..." submitClassName="w-full rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm font-black uppercase disabled:cursor-not-allowed disabled:opacity-60" submitLabel="Resend Email">
        <input type="hidden" name="action" value="resend-email" />
        <input type="hidden" name="bookingId" value={bookingId} />
        <input type="hidden" name="returnTo" value={returnTo} />
      </AsyncAdminActionForm>
      <InvoiceCreateButton bookingId={bookingId} returnTo={returnTo} />
    </div>
  );
}
