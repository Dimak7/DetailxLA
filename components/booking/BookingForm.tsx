"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fireBookingConversion } from "@/lib/gtag";
import { trackBookingLead } from "@/lib/metaPixel";
import {
  buildBookingEstimate,
  freeWaxBonusLabel,
  getStartingPriceLabel,
  isBoatDetailingService,
  roadVehicleTypes,
  type PricedService,
  type BookingDetailSelection,
  type BookingDetailEstimate,
  type BookingService,
  type VehicleType,
} from "@/lib/pricing";
import { timeSlots, type SlotAvailability } from "@/lib/schedule";

const maxDetails = 6;

type Status = {
  type: "idle" | "success" | "error";
  message: string;
};

type ServiceCounts = Record<string, number>;

type BookingConfirmation = {
  details: BookingDetailEstimate[];
  date: string;
  time: string;
  location: string;
  estimatedTotal: string;
  bonusIncluded: boolean;
  emailSent: boolean;
  boatSelected: boolean;
  assetDetail: string;
};

export function BookingForm({ initialServices }: { initialServices: readonly PricedService[] }) {
  const searchParams = useSearchParams();
  const initialServiceCounts = useMemo(() => buildInitialServiceCounts(initialServices), [initialServices]);
  const [serviceCounts, setServiceCounts] = useState<ServiceCounts>(initialServiceCounts);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>("Sedan");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [availability, setAvailability] = useState<SlotAvailability[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ type: "idle", message: "" });
  const formRef = useRef<HTMLFormElement>(null);

  const calendarDays = useMemo(() => buildCalendar(cursor), [cursor]);
  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const selectedDetails = buildDetailsFromCounts(serviceCounts, selectedVehicle, initialServices);
  const bookingEstimate = buildBookingEstimate(selectedDetails, initialServices);
  const estimatedPrice = bookingEstimate.estimatedPrice;
  const totalDetails = selectedDetails.length;
  const primaryDetail = selectedDetails[0] ?? { service: initialServices[0].title, vehicleType: selectedVehicle };
  const boatSelected = selectedDetails.some((detail) => isBoatDetailingService(detail.service));
  const assetLabel = boatSelected ? "Boat size / length" : "Car make/model (optional)";
  const assetPlaceholder = boatSelected ? "24 ft pontoon / 32 ft cruiser / jet boat" : "BMW X3 / Honda Civic / Ford Transit";
  const notesLabel = boatSelected ? "Condition or special notes" : "Optional notes";
  const notesPlaceholder = boatSelected
    ? "Condition, oxidation, vinyl needs, compartments, dock access, or protection goals..."
    : "Parking access, pet hair, stains, coating goals, tint questions...";
  const availableSlotByTime = new Map(availability.map((slot) => [slot.time, slot]));

  useEffect(() => {
    const requestedService = searchParams.get("service");

    if (!requestedService || !initialServices.some((service) => service.title === requestedService)) {
      return;
    }

    setServiceCounts((current) => {
      if (current[requestedService as BookingService] === 1 && getDetailCount(current) === 1) {
        return current;
      }

      const next = initialServices.reduce((counts, service) => {
        counts[service.title] = service.title === requestedService ? 1 : 0;
        return counts;
      }, {} as ServiceCounts);

      return next;
    });

    setSelectedVehicle(isBoatDetailingService(requestedService) ? "Boat" : "Sedan");
  }, [initialServices, searchParams]);

  useEffect(() => {
    if (boatSelected && selectedVehicle !== "Boat") {
      setSelectedVehicle("Boat");
      return;
    }

    if (!boatSelected && selectedVehicle === "Boat") {
      setSelectedVehicle("Sedan");
    }
  }, [boatSelected, selectedVehicle]);

  useEffect(() => {
    if (!selectedDate) {
      setAvailability([]);
      setAvailabilityError("");
      return;
    }

    const controller = new AbortController();
    setAvailabilityLoading(true);
    setAvailabilityError("");

    fetch(`/api/availability?date=${encodeURIComponent(selectedDate)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || "Could not load availability.");
        }

        setAvailability(result.slots || []);
        if (selectedTime && !result.slots?.some((slot: SlotAvailability) => slot.time === selectedTime && slot.available)) {
          setSelectedTime("");
        }
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setAvailability([]);
        setAvailabilityError(error instanceof Error ? error.message : "Could not load availability.");
      })
      .finally(() => setAvailabilityLoading(false));

    return () => controller.abort();
  }, [selectedDate]);

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget || formRef.current;
    setStatus({ type: "idle", message: "" });

    if (!form) {
      setStatus({ type: "error", message: "We could not read the booking form. Please refresh and try again." });
      return;
    }

    if (!selectedDetails.length) {
      setStatus({ type: "error", message: "Add at least one detail before requesting your booking." });
      return;
    }

    if (!selectedDate || !selectedTime) {
      setStatus({ type: "error", message: "Choose a date and time before requesting your detail." });
      return;
    }

    if (!availableSlotByTime.get(selectedTime as SlotAvailability["time"])?.available) {
      setStatus({ type: "error", message: "That time is not available anymore. Please choose another slot." });
      return;
    }

    const formData = new FormData(form);
    const payload: Record<string, unknown> = Object.fromEntries(formData.entries());
    const primaryNotes = String(payload.notes || "");
    const details = selectedDetails.map((detail) => ({ ...detail, notes: primaryNotes }));
    payload.service = primaryDetail.service;
    payload.vehicleType = selectedVehicle;
    payload.estimatedPrice = estimatedPrice;
    payload.date = selectedDate;
    payload.time = selectedTime;
    payload.details = details;

    setLoading(true);
    try {
      const response = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Booking request failed.");
      }

      const bookingId = typeof result.bookingId === "string" ? result.bookingId : "";
      fireBookingConversion(bookingId);
      trackBookingLead(bookingId);
      setConfirmation({
        details: bookingEstimate.details,
        date: selectedDate,
        time: selectedTime,
        location: String(payload.address || ""),
        estimatedTotal: estimatedPrice,
        bonusIncluded: bookingEstimate.bonusIncluded,
        emailSent: result.status === "booking_saved_email_sent" || Boolean(result.emailSent),
        boatSelected,
        assetDetail: String(payload.carModel || ""),
      });
      (formRef.current ?? form)?.reset();
      setServiceCounts(buildInitialServiceCounts(initialServices));
      setSelectedVehicle("Sedan");
      setAvailability([]);
      setAvailabilityError("");
      setSelectedDate("");
      setSelectedTime("");
      setStatus({ type: "idle", message: "" });
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  function moveMonth(direction: number) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + direction);
    const today = new Date();
    const firstAllowed = new Date(today.getFullYear(), today.getMonth(), 1);

    if (next >= firstAllowed) {
      setCursor(next);
    }
  }

  function updateServiceCount(service: BookingService, change: number) {
    setServiceCounts((current) => {
      const nextTotal = getDetailCount(current) + change;
      const nextCount = Math.max(0, current[service] + change);

      if (nextTotal < 1 || nextTotal > maxDetails) {
        return current;
      }

      return {
        ...current,
        [service]: nextCount,
      };
    });
  }

  return (
    <>
      <form ref={formRef} className="min-w-0 max-w-full overflow-hidden rounded-lg bg-white p-3 text-ink shadow-[0_28px_90px_rgba(5,5,6,0.3)] ring-1 ring-white/20 backdrop-blur md:p-5" onSubmit={submitBooking}>
      <input name="service" type="hidden" value={primaryDetail.service} />
      <input name="vehicleType" type="hidden" value={selectedVehicle} />
      <input name="estimatedPrice" type="hidden" value={estimatedPrice} />

      <div className="rounded-lg bg-ink p-4 text-white">
        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-red">Reservation</p>
            <h3 className="mt-2 text-2xl font-black uppercase leading-none">Build your detail.</h3>
          </div>
          <div className="min-w-0 rounded-lg bg-white px-4 py-3 text-right text-ink">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-steel">{totalDetails} detail{totalDetails === 1 ? "" : "s"}</p>
            <p className="text-2xl font-black leading-none">{estimatedPrice}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {initialServices.map((service) => {
          const count = serviceCounts[service.title];
          const active = count > 0;
          return (
            <article
              className={`group min-w-0 overflow-hidden rounded-lg border text-left transition ${active ? "border-red bg-ink text-white shadow-[0_18px_48px_rgba(193,18,31,0.2)]" : "border-ink/10 bg-smoke text-ink hover:border-red/40"}`}
              key={service.title}
            >
              <div className="relative h-28 overflow-hidden">
                <div className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-105" style={{ backgroundImage: `url(${service.image})` }} />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/20 to-transparent" />
                <span className="absolute left-3 top-3 rounded-lg bg-red px-2.5 py-1 text-xs font-black uppercase text-white">{service.code}</span>
                <div className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-white p-1 text-ink shadow-lg">
                  <button aria-label={`Remove ${service.title}`} className="grid h-8 w-8 place-items-center rounded-md bg-smoke text-lg font-black transition hover:bg-red-soft disabled:opacity-40" disabled={count === 0 || totalDetails === 1} onClick={() => updateServiceCount(service.title, -1)} type="button">
                    -
                  </button>
                  <span className="min-w-8 text-center text-sm font-black">{count}</span>
                  <button aria-label={`Add ${service.title}`} className="grid h-8 w-8 place-items-center rounded-md bg-red text-lg font-black text-white transition hover:bg-red-dark disabled:opacity-40" disabled={totalDetails >= maxDetails} onClick={() => updateServiceCount(service.title, 1)} type="button">
                    +
                  </button>
                </div>
              </div>
              <div className="p-4">
                <p className={`text-xs font-black uppercase ${active ? "text-red-soft" : "text-red"}`}>{service.tone}</p>
                <h4 className="mt-1 text-lg font-black uppercase leading-none">{service.title}</h4>
                <p className={`mt-2 text-sm font-black ${active ? "text-white" : "text-ink"}`}>{getStartingPriceLabel(service.title, initialServices)}</p>
                <p className={`mt-2 text-sm leading-6 ${active ? "text-ash" : "text-steel"}`}>{service.description}</p>
              </div>
            </article>
          );
        })}
      </div>

      {boatSelected ? (
        <div className="mt-4 rounded-lg border border-red/15 bg-red-soft/60 p-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-red">Boat detailing</p>
          <p className="mt-2 text-sm font-bold leading-6 text-ink">
            Boat Detailing uses a starting base price of $300. Final pricing depends on boat size, condition, oxidation, and service package.
          </p>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-ink/10 bg-smoke p-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-red">Vehicle size</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {roadVehicleTypes.map((vehicle) => (
                <button
                  className={`rounded-lg px-3 py-3 text-sm font-black uppercase transition ${selectedVehicle === vehicle ? "bg-red text-white shadow-[0_12px_30px_rgba(193,18,31,0.2)]" : "bg-white text-ink ring-1 ring-ink/10 hover:ring-red/40"}`}
                  key={vehicle}
                  onClick={() => setSelectedVehicle(vehicle)}
                  type="button"
                >
                  {vehicle}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg bg-smoke p-4 ring-1 ring-ink/10">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-red">Booking summary</p>
        <div className="mt-3 grid gap-2">
          {bookingEstimate.details.map((detail) => (
            <div className="flex min-w-0 items-start justify-between gap-4 rounded-lg bg-white px-4 py-3" key={detail.lineNumber}>
              <div className="min-w-0">
                <p className="font-black uppercase leading-tight">Detail {detail.lineNumber}: {detail.service}</p>
                <p className="mt-1 text-sm font-bold text-steel">{detail.vehicleType === "Boat" ? "Boat" : detail.vehicleType}</p>
              </div>
              <p className="shrink-0 text-right font-black text-ink">{detail.estimatedPrice}</p>
            </div>
          ))}
        </div>
        {bookingEstimate.bonusIncluded ? (
          <div className="mt-3 rounded-lg border border-red/20 bg-red-soft px-4 py-3 text-sm font-black uppercase text-ink">
            Bonus: {freeWaxBonusLabel}
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between rounded-lg bg-ink px-4 py-4 text-white">
          <span className="text-sm font-black uppercase text-ash">Total estimate</span>
          <span className="text-2xl font-black">{bookingEstimate.estimatedPrice}</span>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-ink p-4 text-white ring-1 ring-red/25">
        <div className="mb-4 grid grid-cols-[44px_1fr_44px] items-center gap-3 text-center">
          <button className="calendar-control" type="button" onClick={() => moveMonth(-1)} aria-label="Previous month">-</button>
          <p className="font-black uppercase">{monthLabel}</p>
          <button className="calendar-control" type="button" onClick={() => moveMonth(1)} aria-label="Next month">+</button>
        </div>
        <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs font-black uppercase text-ash">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) => (
            day ? (
              <button
                className={`rounded-lg py-3 text-sm font-black transition ${selectedDate === day.iso ? "bg-red text-white" : "bg-white/10 text-white hover:bg-white/20"} disabled:cursor-not-allowed disabled:opacity-30`}
                disabled={day.disabled}
                key={day.iso}
                onClick={() => setSelectedDate(day.iso)}
                type="button"
              >
                {day.label}
              </button>
            ) : (
              <span key={`blank-${index}`} />
            )
          ))}
        </div>
      </div>

      <div className="mt-4 min-w-0 max-w-full overflow-hidden rounded-lg bg-smoke p-3 ring-1 ring-ink/10 sm:p-4">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-red">Preferred time</p>
          <p className="w-fit max-w-full rounded-lg bg-white px-3 py-2 text-xs font-black uppercase text-ink ring-1 ring-ink/10">
            {selectedTime || (selectedDate ? "Select a time" : "Choose date first")}
          </p>
        </div>
        <div className="mt-3 max-w-full overflow-x-auto overscroll-x-contain pb-1">
          <div className="inline-flex max-w-none gap-2 pr-2">
          {timeSlots.map((time) => {
            const slot = availableSlotByTime.get(time);
            const disabled = !selectedDate || availabilityLoading || Boolean(availabilityError) || !slot || !slot.available;
            return (
              <button
                className={`shrink-0 rounded-lg px-3.5 py-3 text-xs font-black uppercase transition sm:px-4 sm:text-sm ${
                  selectedTime === time
                    ? "bg-red text-white shadow-[0_12px_30px_rgba(193,18,31,0.24)]"
                    : disabled
                      ? "bg-white text-steel opacity-45"
                      : "bg-white text-ink ring-1 ring-ink/10 hover:bg-red-soft hover:ring-red/30"
                }`}
                disabled={disabled}
                key={time}
                onClick={() => setSelectedTime(time)}
                type="button"
              >
                {time}
                {slot && !slot.available ? <span className="ml-2 text-[10px]">{slot.reason}</span> : null}
              </button>
            );
          })}
          </div>
        </div>
      </div>
      {selectedDate && !availabilityLoading && !availabilityError && availability.length > 0 && availability.every((slot) => !slot.available) ? (
        <p className="mt-3 rounded-lg bg-red-soft px-4 py-3 text-sm font-bold text-ink">No slots are open for this date. Please choose another day.</p>
      ) : null}
      {availabilityLoading ? <p className="mt-3 text-sm font-bold text-steel">Checking available times...</p> : null}
      {availabilityError ? <p className="mt-3 rounded-lg bg-red-100 px-4 py-3 text-sm font-bold text-red-900">{availabilityError}</p> : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="form-label">Name<input className="field" name="name" minLength={2} required placeholder="Your name" /></label>
        <label className="form-label">Phone<input className="field" name="phone" required placeholder="Your phone number" /></label>
        <label className="form-label">Email<input className="field" name="email" type="email" required placeholder="you@email.com" /></label>
        <label className="form-label">Service location<input className="field" name="address" minLength={5} required placeholder="Los Angeles address, neighborhood, or parking location" /></label>
        <label className="form-label md:col-span-2">{assetLabel}<input className="field" name="carModel" maxLength={120} placeholder={assetPlaceholder} /></label>
      </div>
      <label className="form-label mt-4">{notesLabel}<textarea className="field min-h-28 resize-y" name="notes" maxLength={800} placeholder={notesPlaceholder} /></label>
      <button className="mt-5 w-full rounded-lg bg-red px-6 py-4 font-black uppercase text-white shadow-[0_16px_42px_rgba(193,18,31,0.25)] transition hover:-translate-y-0.5 hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-60" disabled={loading} type="submit">
        {loading ? "Requesting..." : `Request Booking - ${estimatedPrice}`}
      </button>
      {status.message ? (
        <p className={`mt-4 rounded-lg px-4 py-3 text-sm font-bold ${status.type === "success" ? "bg-red-soft text-ink" : "bg-red-100 text-red-900"}`}>
          {status.message}
        </p>
      ) : null}
      <style jsx>{`
        .field {
          min-height: 52px;
          width: 100%;
          border-radius: 8px;
          border: 1px solid rgba(5, 5, 6, 0.14);
          background: rgba(245, 245, 242, 0.9);
          padding: 0.85rem 0.95rem;
          color: var(--ink);
          outline: none;
        }
        .field:focus {
          border-color: var(--red);
          box-shadow: 0 0 0 4px rgba(193, 18, 31, 0.18);
        }
        .form-label {
          display: grid;
          gap: 0.5rem;
          font-size: 0.8rem;
          font-weight: 900;
          text-transform: uppercase;
          color: var(--ink);
        }
        .calendar-control {
          height: 44px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.1);
          color: var(--white);
          font-weight: 900;
        }
      `}</style>
      </form>
      {confirmation ? (
        <BookingConfirmationOverlay
          confirmation={confirmation}
          onBookAnother={() => setConfirmation(null)}
          onBackHome={() => {
            setConfirmation(null);
            window.location.hash = "top";
          }}
        />
      ) : null}
    </>
  );
}

function BookingConfirmationOverlay({
  confirmation,
  onBackHome,
  onBookAnother,
}: {
  confirmation: BookingConfirmation;
  onBackHome: () => void;
  onBookAnother: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-ink/95 px-4 py-6 text-white backdrop-blur-xl md:py-10" role="dialog" aria-modal="true" aria-labelledby="booking-confirmed-title">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-4xl place-items-center">
        <div className="w-full rounded-lg border border-white/[0.14] bg-[linear-gradient(145deg,rgba(27,29,34,0.98),rgba(5,5,6,0.98))] p-4 shadow-[0_30px_120px_rgba(0,0,0,0.55)] md:p-8">
          <div className="grid gap-6 md:grid-cols-[0.8fr_1.2fr] md:items-start">
            <div>
              <p className="inline-flex rounded-lg bg-red px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white">Booking Confirmed</p>
              <h2 id="booking-confirmed-title" className="mt-5 text-4xl font-black uppercase leading-none md:text-6xl">Thank you for booking with DETAILX LA.</h2>
              <p className="mt-5 text-base leading-7 text-ash">
                {confirmation.emailSent ? "Check your email for confirmation details." : "Your booking was received. We'll contact you shortly."}
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row md:flex-col">
                <button className="rounded-lg bg-red px-5 py-4 text-center font-black uppercase text-white transition hover:bg-red-dark" type="button" onClick={onBookAnother}>
                  Book Another Detail
                </button>
                <button className="rounded-lg border border-white/20 px-5 py-4 text-center font-black uppercase text-white transition hover:bg-white/10" type="button" onClick={onBackHome}>
                  Back to Home
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-white p-4 text-ink md:p-5">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-red">Reservation summary</p>
              <div className="mt-4 grid gap-3">
                {confirmation.details.map((detail) => (
                  <div className="rounded-lg bg-smoke px-4 py-3" key={detail.lineNumber}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-black uppercase leading-tight">Detail {detail.lineNumber}: {detail.service}</p>
                        <p className="mt-1 text-sm font-bold text-steel">{detail.vehicleType}</p>
                      </div>
                      <p className="text-right font-black">{detail.estimatedPrice}</p>
                    </div>
                  </div>
                ))}
              </div>
              {confirmation.bonusIncluded ? (
                <div className="mt-4 rounded-lg border border-red/20 bg-red-soft px-4 py-3 text-sm font-black uppercase text-ink">
                  Bonus: {freeWaxBonusLabel}
                </div>
              ) : null}
              <div className="mt-4 grid gap-2 rounded-lg border border-ink/10 p-4 text-sm font-bold text-steel">
                <div className="flex justify-between gap-4"><span>Date</span><span className="text-right text-ink">{confirmation.date}</span></div>
                <div className="flex justify-between gap-4"><span>Time</span><span className="text-right text-ink">{confirmation.time}</span></div>
                <div className="flex justify-between gap-4"><span>Location</span><span className="min-w-0 break-words text-right text-ink">{confirmation.location}</span></div>
                {confirmation.assetDetail ? <div className="flex justify-between gap-4"><span>{confirmation.boatSelected ? "Boat size / length" : "Car make/model"}</span><span className="min-w-0 break-words text-right text-ink">{confirmation.assetDetail}</span></div> : null}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg bg-ink px-4 py-4 text-white">
                <span className="text-sm font-black uppercase text-ash">Estimated total</span>
                <span className="text-2xl font-black">{confirmation.estimatedTotal}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildDetailsFromCounts(counts: ServiceCounts, vehicleType: VehicleType, services: readonly PricedService[]): BookingDetailSelection[] {
  return services.flatMap((service) =>
    Array.from({ length: counts[service.title] }, () => ({
      service: service.title,
      vehicleType,
    }))
  );
}

function buildInitialServiceCounts(services: readonly PricedService[]) {
  return services.reduce((counts, service, index) => {
    counts[service.title] = index === 0 ? 1 : 0;
    return counts;
  }, {} as ServiceCounts);
}

function buildEmptyServiceCounts(services: readonly PricedService[]) {
  return services.reduce((counts, service) => {
    counts[service.title] = 0;
    return counts;
  }, {} as ServiceCounts);
}

function getDetailCount(counts: ServiceCounts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function buildCalendar(cursor: Date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: Array<{ iso: string; label: number; disabled: boolean } | null> = [];

  for (let i = 0; i < firstDay; i += 1) {
    days.push(null);
  }

  for (let label = 1; label <= daysInMonth; label += 1) {
    const date = new Date(year, month, label);
    days.push({
      iso: formatDate(date),
      label,
      disabled: date < today,
    });
  }

  return days;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
