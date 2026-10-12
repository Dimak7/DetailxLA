"use client";
import { useEffect, useRef, useState } from "react";
import {
  money,
  dateToday,
  timeLabel,
  type Service,
  type BusinessSettings,
} from "@/lib/platform/types";
import { visitor, track, confirmedConversion } from "./Tracking";
import { bookingDestination } from "@/lib/booking-handoff";
import {
  bookingAddOns,
  bookingCartSelection,
  defaultServicePackage,
  servicePackages,
  vehicleSizeLabel,
  type BookingServiceChoice,
} from "@/lib/booking-options";
type Draft = {
  services: BookingServiceChoice[];
  make: string;
  model: string;
  year: number;
  vehicle_type: string;
  condition: string;
  date: string;
  start_minute: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  location: string;
  notes: string;
  marketing_email: boolean;
  marketing_sms: boolean;
  terms: boolean;
};
export function BookingWizard({
  services,
  business,
  initialService,
  initialPackage,
  admin = false,
  paymentsEnabled = false,
  lead,
  onComplete,
}: {
  services: Service[];
  business: BusinessSettings;
  initialService?: string;
  initialPackage?: string;
  admin?: boolean;
  paymentsEnabled?: boolean;
  lead?: { id: string; name: string; email: string; phone: string };
  onComplete?: () => void;
}) {
  const initialServiceRecord = services.find((s) => s.id === initialService);
  const [step, setStep] = useState(0),
    [draft, setDraft] = useState<Draft>({
      services: initialServiceRecord ? [{
        service_id: initialServiceRecord.id,
        service_package: servicePackages(initialServiceRecord.slug).some((item) => item.id === initialPackage)
          ? initialPackage || ""
          : defaultServicePackage(initialServiceRecord.slug),
        addons: [],
      }] : [],
      make: "",
      model: "",
      year: new Date().getFullYear(),
      vehicle_type: "",
      condition: "",
      date: "",
      start_minute: -1,
      first_name: lead?.name.split(" ")[0] || "",
      last_name: lead?.name.split(" ").slice(1).join(" ") || "",
      email: lead?.email || "",
      phone: lead?.phone || "",
      location: "",
      notes: "",
      marketing_email: false,
      marketing_sms: false,
      terms: false,
    });
  const [slots, setSlots] = useState<
      Array<{ minute: number; available: boolean }>
    >([]),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef({ body: "", id: "" }),
    started = useRef(false),
    stepHeading = useRef<HTMLHeadingElement>(null),
    previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepHeading.current?.focus({ preventScroll: true });
    stepHeading.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [step]);
  const selectedServices = draft.services.flatMap((choice) => {
      const service = services.find((s) => s.id === choice.service_id);
      return service ? [{ service, choice }] : [];
    }),
    service = selectedServices[0]?.service,
    serviceIds = draft.services.map((choice) => choice.service_id).join(","),
    selection = selectedServices.length > 0 && draft.vehicle_type
      ? bookingCartSelection(services, draft.vehicle_type, draft.services)
      : null,
    price = selection?.totalCents ?? null,
    durationMinutes = selectedServices.reduce((total, item) => total + item.service.duration_minutes, 0),
    startingPrice = selectedServices.some(({ service }) => service.pricing_mode === "starting"),
    upgradeCount = draft.services.reduce((total, choice) => total + (choice.addons?.length || 0), 0),
    quoteBased = Boolean(selection?.requiresQuote),
    deposit =
      !quoteBased && paymentsEnabled && price !== null
        ? Math.round((price * business.deposit_percent) / 100)
        : 0;
  function toggleService(selected: Service) {
    setDraft((current) => {
      const removing = current.services.some((choice) => choice.service_id === selected.id);
      if (!removing && current.services.length >= 12) return current;
      const choices = removing
        ? current.services.filter((choice) => choice.service_id !== selected.id)
        : [...current.services.map((choice) => ({ ...choice, addons: (choice.addons || []).filter((id) => id !== selected.slug) })),
            { service_id: selected.id, service_package: defaultServicePackage(selected.slug), addons: [] }];
      choices.sort((a, b) => services.findIndex((s) => s.id === a.service_id) - services.findIndex((s) => s.id === b.service_id));
      return { ...current, services: choices, start_minute: -1 };
    });
    setError("");
    if (!admin) track("service_selected", { service_id: selected.id });
  }
  function setServiceOptions(id: string, patch: Partial<BookingServiceChoice>) {
    setDraft((current) => ({
      ...current,
      services: current.services.map((choice) => choice.service_id === id ? { ...choice, ...patch } : choice),
    }));
    setError("");
  }
  function set<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setError("");
  }
  useEffect(() => {
    if (!admin && !started.current) {
      track("booking_started");
      started.current = true;
    }
  }, [admin]);
  useEffect(() => {
    if (!draft.date || !serviceIds) {
      setSlots([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setSlots([]);
    const params = new URLSearchParams({ date: draft.date });
    serviceIds.split(",").forEach((id) => params.append("service_id", id));
    fetch(
      "/api/availability?" + params.toString(),
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((d) => {
        if (controller.signal.aborted) return;
        if (!d.ok) throw Error(d.error || "Could not load times.");
        setSlots(d.slots);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [draft.date, serviceIds]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (step < 3) {
      if (step === 0 && !selectedServices.length) {
        setError("Choose at least one service to continue.");
        return;
      }
      if (step === 1 && !draft.vehicle_type) {
        setError("Choose your vehicle size to continue.");
        return;
      }
      if (step === 2 && (loading || draft.start_minute < 0 || !slots.some((slot) => slot.minute === draft.start_minute && slot.available))) {
        setError("Choose an available time.");
        return;
      }
      setStep(step + 1);
      return;
    }
    if (!draft.terms) {
      setError("Please agree to the service terms.");
      return;
    }
    setBusy(true);
    try {
      const v = visitor(),
        base = {
          ...draft,
          ...v,
          ...(admin && lead ? { lead_id: lead.id } : {}),
          device: admin ? "admin" : innerWidth < 768 ? "mobile" : "desktop",
        };
      const body = JSON.stringify(base);
      if (key.current.body !== body)
        key.current = { body, id: crypto.randomUUID() };
      const payload = { ...base, request_key: key.current.id };
      if (!admin) track("booking_submitted", { service_ids: draft.services.map((choice) => choice.service_id) });
      const res = await fetch(admin ? "/api/manage" : "/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          admin ? { action: "create_booking", data: payload } : payload,
        ),
      });
      const result = await res.json();
      if (!res.ok || result.ok === false)
        throw Error(
          admin
            ? result.error || "We couldn't reserve this time. Please try again."
            : "Something went wrong while creating your appointment. Please try again.",
        );
      if (admin) {
        onComplete?.();
        return;
      }
      if (!result.booking_id || !result.confirmation_url)
        throw Error(
          "We could not verify the confirmation. Please retry without changing your details.",
        );
      try {
        confirmedConversion(result.booking_id, result.value_cents, result.event_id);
      } catch {
        // Analytics must never prevent a customer reaching their saved booking.
      }
      window.location.assign(await bookingDestination(result, location.origin));
    } catch (e) {
      setError(
        admin && e instanceof Error
          ? e.message
          : "Something went wrong while creating your appointment. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function field(
    label: string,
    k: keyof Draft,
    type = "text",
    required = true,
  ) {
    return (
      <label className="field">
        <span>{label}</span>
        <input
          type={type}
          required={required}
          value={String(draft[k])}
          onChange={(e) =>
            set(
              k,
              (type === "number"
                ? Number(e.target.value)
                : e.target.value) as never,
            )
          }
          {...(k === "year"
            ? { min: 1900, max: new Date().getFullYear() + 2 }
            : {})}
          autoComplete={
            k === "first_name"
              ? "given-name"
              : k === "last_name"
                ? "family-name"
                : k === "email"
                  ? "email"
                  : k === "phone"
                    ? "tel"
                    : "off"
          }
        />
      </label>
    );
  }
  return (
    <div className={admin ? "booking-layout" : "booking-layout wrap"}>
      <form className="booking-main paper" onSubmit={submit}>
        <div className="booking-progress" aria-label="Booking progress">
          {["Services", "Vehicle", "Appointment", "Your details"].map((s, i) => (
            <span
              className={i <= step ? "active" : ""}
              key={s}
              aria-current={i === step ? "step" : undefined}
            >
              0{i + 1} {s}
            </span>
          ))}
        </div>
        {step === 0 && (
          <>
            <h2 ref={stepHeading} tabIndex={-1} className="booking-step-heading">What does your car need?</h2>
            <p>Choose one or more services for the same vehicle. We’ll keep them together in one appointment.</p>
            <p className="small-note" role="status">{selectedServices.length ? `${selectedServices.length} service${selectedServices.length === 1 ? "" : "s"} selected · ${durationMinutes / 60} hours total` : "Select all the care your car needs."}</p>
            {services.map((s) => (
              <label className="service-option" key={s.id}>
                <input
                  type="checkbox"
                  name="services"
                  value={s.id}
                  checked={draft.services.some((choice) => choice.service_id === s.id)}
                  disabled={draft.services.length >= 12 && !draft.services.some((choice) => choice.service_id === s.id)}
                  onChange={() => toggleService(s)}
                />
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.duration_minutes / 60} hours · {s.category}
                  </small>
                </span>
                <span className="option-price">
                  {s.pricing_mode === "starting" ? "From " : ""}
                  {money(s.pricing_mode === "quote" ? null : s.price_cents)}
                </span>
              </label>
            ))}
            {!services.length && (
              <p>
                No services are currently available. Please contact the team.
              </p>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <h2 ref={stepHeading} tabIndex={-1} className="booking-step-heading">Tell us about your vehicle.</h2>
            <div className="form-grid">
              {field("Make", "make")}
              {field("Model", "model")}
              {field("Year", "year", "number")}
              <label className="field">
                <span>Vehicle size</span>
                <select
                  required
                  value={draft.vehicle_type}
                  onChange={(e) => set("vehicle_type", e.target.value)}
                >
                  <option value="" disabled>Select vehicle size</option>
                  {["Sedan", "SUV", "Truck"].map((x) => (
                    <option key={x} value={x}>
                      {vehicleSizeLabel(selectedServices.length === 1 ? service?.slug : undefined, x)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field wide">
                <span>Condition / special care (optional)</span>
                <textarea
                  maxLength={500}
                  value={draft.condition}
                  onChange={(e) => set("condition", e.target.value)}
                  placeholder="Pet hair, stains, delicate materials..."
                />
              </label>
            </div>
            <p className="small-note">
              Vehicle condition may change the scope. We discuss additional work
              before it begins.
            </p>
            {selectedServices.map(({ service: selectedService, choice }) => {
              const packages = servicePackages(selectedService.slug);
              const availableAddOns = bookingAddOns(selectedService.slug).filter((item) => !selectedServices.some(({ service }) => service.slug === item.id));
              if (!packages.length && !availableAddOns.length) return null;
              return (
                <section className="booking-upgrades" key={selectedService.id} aria-labelledby={`options-${selectedService.id}`}>
                  <div className="booking-upgrades-heading">
                    <div><p className="eyebrow">CUSTOMIZE YOUR CARE</p><h3 id={`options-${selectedService.id}`}>{selectedService.name}</h3></div>
                  </div>
                  {packages.length > 0 && (
                    <fieldset className="booking-choice-group">
                      <legend>Choose a package</legend>
                      <div className="booking-package-grid">
                        {packages.map((item) => (
                          <label className="booking-package" key={item.id}>
                            <input type="radio" name={`package-${selectedService.id}`} value={item.id} checked={choice.service_package === item.id} onChange={() => setServiceOptions(selectedService.id, { service_package: item.id })} />
                            <span><strong>{item.name}</strong><small>{item.description}</small></span>
                            <b>{item.priceCents === null ? "By quote" : `${selectedService.pricing_mode === "starting" ? "From " : ""}${money(item.priceCents)}`}</b>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {availableAddOns.length > 0 && (
                    <details className="booking-choice-group booking-optional-upgrades">
                      <summary>Optional upgrades{choice.addons?.length ? ` · ${choice.addons.length} added` : ""}</summary>
                      <div className="booking-addon-grid">
                        {availableAddOns.map((item) => {
                          const selected = (choice.addons || []).includes(item.id);
                          const otherSelection = selectedServices.find(({ choice: other }) => other.service_id !== choice.service_id && other.addons?.includes(item.id));
                          return (
                            <label className="booking-addon" data-selected={selected} data-unavailable={Boolean(otherSelection)} key={item.id}>
                              <input type="checkbox" checked={selected} disabled={Boolean(otherSelection)} onChange={() => setServiceOptions(selectedService.id, { addons: selected ? (choice.addons || []).filter((id) => id !== item.id) : [...(choice.addons || []), item.id] })} />
                              <span><strong>{item.name} · {money(item.priceCents)}</strong><small>{otherSelection ? `Already added with ${otherSelection.service.name}. You only pay for this upgrade once.` : item.description}</small></span>
                              <b>{selected ? "Added" : otherSelection ? "Included" : "+ Add"}</b>
                            </label>
                          );
                        })}
                      </div>
                    </details>
                  )}
                </section>
              );
            })}
          </>
        )}
        {step === 2 && (
          <>
            <h2 ref={stepHeading} tabIndex={-1} className="booking-step-heading">Make a little time.</h2>
            <label className="field">
              <span>Appointment date</span>
              <input
                type="date"
                required
                min={dateToday()}
                max={dateToday(new Date(Date.now() + 365 * 86400000))}
                value={draft.date}
                onChange={(e) => {
                  set("date", e.target.value);
                  set("start_minute", -1);
                }}
              />
            </label>
            <p className="small-note">
              All appointment times are Central Time (Chicago). Estimated
              service time: {durationMinutes / 60} hours for {selectedServices.length === 1 ? "your service" : "all selected services"}.
            </p>
            {loading ? (
              <p role="status">Finding available appointments...</p>
            ) : (
              draft.date && (
                <>
                  <div className="time-grid">
                    {slots.map((s) => (
                      <button
                        key={s.minute}
                        type="button"
                        disabled={!s.available}
                        aria-pressed={draft.start_minute === s.minute}
                        className={
                          draft.start_minute === s.minute ? "selected" : ""
                        }
                        onClick={() => set("start_minute", s.minute)}
                      >
                        {timeLabel(s.minute)}
                      </button>
                    ))}
                  </div>
                  {!slots.some((s) => s.available) && (
                    <p>
                      No times fit your selected services on this date. Try another day or <a className="text-link" href="/contact">contact us to arrange your visit</a>.
                    </p>
                  )}
                </>
              )
            )}
          </>
        )}
        {step === 3 && (
          <>
            <div className="booking-checkout-header">
              <p className="eyebrow">CREATE APPOINTMENT</p>
              <h2 ref={stepHeading} tabIndex={-1} className="booking-step-heading">Almost yours.</h2>
              <p>Review your appointment and add your contact details.</p>
            </div>
            <section className="booking-review" aria-label="Your appointment">
              <p className="eyebrow">YOUR APPOINTMENT</p>
              <div className="booking-review-grid">
                <div><span>Selected services</span>{selection?.items.map((item) => <div className="booking-review-service" key={item.service.id}><strong>{item.service.name}</strong><small>{item.selectedPackage?.name || vehicleSizeLabel(item.service.slug, draft.vehicle_type)} · {money(item.totalCents)}</small></div>)}</div>
                <div><span>When</span><strong>{draft.date}</strong><small>{timeLabel(draft.start_minute)} CT</small></div>
                <div className="booking-review-price"><span>{startingPrice ? "Starting at" : "Your estimate"}</span><strong>{money(price)}</strong>{upgradeCount > 0 && <small>Includes {upgradeCount} upgrade{upgradeCount === 1 ? "" : "s"}</small>}{deposit > 0 && <small>{money(deposit)} due now</small>}</div>
              </div>
            </section>
            <h3 className="booking-details-heading">YOUR DETAILS</h3>
            <div className="form-grid">
              {field("First name", "first_name")}
              {field("Last name", "last_name")}
              {field("Email", "email", "email")}
              {field("Phone", "phone", "tel")}
              {business.appointment_mode !== "shop" && (
                <div className="wide">
                  {field("Service location / address", "location")}
                </div>
              )}
              <label className="field wide">
                <span>Anything else we should know? (optional)</span>
                <textarea
                  value={draft.notes}
                  maxLength={2000}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </label>
            </div>
            <div className="booking-consents">
              <label className="booking-consent optional"><input type="checkbox" checked={draft.marketing_email} onChange={(e) => set("marketing_email", e.target.checked)} /><span><strong>Optional email offers</strong>I would like offers and care tips by email.</span></label>
              <label className="booking-consent optional"><input type="checkbox" checked={draft.marketing_sms} onChange={(e) => set("marketing_sms", e.target.checked)} /><span><strong>Optional promotional texts</strong>I agree to recurring promotional texts. Consent is optional and not a condition of purchase. Message and data rates may apply. Reply STOP to opt out.</span></label>
              <label className="booking-consent required"><input type="checkbox" required checked={draft.terms} onChange={(e) => set("terms", e.target.checked)} /><span><strong>Required to reserve</strong>{admin ? "The customer agrees to" : "I agree to"} the <a className="text-link" href="/service-rules" target="_blank">service terms</a> and <a className="text-link" href="/privacy-notice" target="_blank">privacy notice</a>, and to appointment-related messages.</span></label>
            </div>
          </>
        )}
        {error && (
          <div role="alert" className="error-message">
            {error}
          </div>
        )}
        <div className="booking-actions">
          {step > 0 ? (
            <button
              type="button"
              className="button outline"
              disabled={busy}
              onClick={() => {
                setStep(step - 1);
                setError("");
              }}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button className="button" disabled={busy || !services.length}>
            {busy
              ? deposit > 0
                ? "Opening secure payment..."
                : "Sending request..."
              : step === 3
                ? deposit > 0
                  ? "CONTINUE TO SECURE PAYMENT"
                  : quoteBased
                    ? "REQUEST A QUOTE & APPOINTMENT"
                    : "CONFIRM APPOINTMENT"
                : "Continue"}
          </button>
        </div>
        <p className="small-note">
          {quoteBased
            ? "No payment is collected now. We will inspect the vehicle and confirm the service scope and final quote with you."
            : deposit > 0
              ? `A ${business.deposit_percent}% deposit of ${money(deposit)} is required to confirm this appointment. Card details are entered securely at checkout.`
              : "No card details are required right now. Payment details are confirmed with your appointment."}
        </p>
      </form>
      <aside className="booking-summary paper">
        <p className="eyebrow">YOUR VISIT</p>
        <h3>
          A little time.
          <br />
          <em>A new perspective.</em>
        </h3>
        {!selectedServices.length && <div className="summary-row"><span>Services</span><strong>Choose your care</strong></div>}
        {selectedServices.map(({ service: selectedService }) => {
          const item = selection?.items.find((item) => item.service.id === selectedService.id);
          return <div className="booking-summary-service" key={selectedService.id}>
            <div className="summary-row">
              <span>{selectedService.name}{item?.selectedPackage && <small>{item.selectedPackage.name}</small>}</span>
              <strong>{draft.vehicle_type ? money(item?.baseCents ?? null) : "Choose size"}</strong>
            </div>
            {item?.selectedAddOns.map((addon) => <div className="summary-row summary-addon" key={addon.id}><span>{addon.name}</span><strong>{money(addon.priceCents)}</strong></div>)}
            <button type="button" className="booking-remove-service" disabled={busy} onClick={() => { toggleService(selectedService); setStep(0); }} aria-label={`Remove ${selectedService.name}`}>Remove</button>
          </div>;
        })}
        {durationMinutes > 0 && <div className="summary-row"><span>Total service time</span><strong>{durationMinutes / 60} hours</strong></div>}
        <div className="summary-row">
          <span>Vehicle</span>
          <strong>
            {draft.make
              ? draft.make + " " + draft.model
              : vehicleSizeLabel(service?.slug, draft.vehicle_type)}
          </strong>
        </div>
        <div className="summary-row">
          <span>When</span>
          <strong>
            {draft.date || "Your choice"}
            {draft.start_minute >= 0 && (
              <>
                <br />
                {timeLabel(draft.start_minute)} CT
              </>
            )}
          </strong>
        </div>
        <div className="summary-row summary-total">
          <span>
            {startingPrice ? "From" : "Estimate"}
          </span>
          <strong>{service && !draft.vehicle_type ? "Choose size" : service ? money(price) : "—"}</strong>
        </div>
        {deposit > 0 && (
          <div className="summary-row">
            <span>Due now to confirm</span>
            <strong>{money(deposit)}</strong>
          </div>
        )}
        <p className="small-note">{business.cancellation_policy}</p>
      </aside>
    </div>
  );
}
