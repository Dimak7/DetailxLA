"use client";
import { useEffect, useRef, useState } from "react";
import {
  money,
  priceFor,
  dateToday,
  timeLabel,
  type Service,
  type BusinessSettings,
} from "@/lib/platform/types";
import { visitor, track, confirmedConversion } from "./Tracking";
type Draft = {
  service_id: string;
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
  admin = false,
  lead,
  onComplete,
}: {
  services: Service[];
  business: BusinessSettings;
  initialService?: string;
  admin?: boolean;
  lead?: { id: string; name: string; email: string; phone: string };
  onComplete?: () => void;
}) {
  const [step, setStep] = useState(0),
    [draft, setDraft] = useState<Draft>({
      service_id:
        initialService && services.some((s) => s.id === initialService)
          ? initialService
          : "",
      make: "",
      model: "",
      year: new Date().getFullYear(),
      vehicle_type: "Sedan",
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
    started = useRef(false);
  const service = services.find((s) => s.id === draft.service_id),
    price = service ? priceFor(service, draft.vehicle_type) : null;
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
    if (!draft.date || !draft.service_id) return;
    const controller = new AbortController();
    setLoading(true);
    setSlots([]);
    fetch(
      "/api/availability?date=" +
        draft.date +
        "&service_id=" +
        draft.service_id,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((d) => {
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
  }, [draft.date, draft.service_id]);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (step < 3) {
      if (step === 0 && !service) {
        setError("Choose a service to continue.");
        return;
      }
      if (step === 2 && draft.start_minute < 0) {
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
      if (!admin) track("booking_submitted", { service_id: draft.service_id });
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
      confirmedConversion(
        result.booking_id,
        result.value_cents,
        result.event_id,
      );
      window.location.assign(result.confirmation_url);
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
          {["Service", "Vehicle", "Appointment", "Your details"].map((s, i) => (
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
            <h2>What does your car need?</h2>
            <p>Select your service. Details and pricing stay clear.</p>
            {services.map((s) => (
              <label className="service-option" key={s.id}>
                <input
                  type="radio"
                  name="service"
                  value={s.id}
                  checked={draft.service_id === s.id}
                  onChange={() => {
                    set("service_id", s.id);
                    set("start_minute", -1);
                    if (!admin) track("service_selected", { service_id: s.id });
                  }}
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
            <h2>Tell us about your vehicle.</h2>
            <div className="form-grid">
              {field("Make", "make")}
              {field("Model", "model")}
              {field("Year", "year", "number")}
              <label className="field">
                <span>Vehicle size</span>
                <select
                  value={draft.vehicle_type}
                  onChange={(e) => set("vehicle_type", e.target.value)}
                >
                  {["Sedan", "SUV", "Truck"].map((x) => (
                    <option key={x}>{x}</option>
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
          </>
        )}
        {step === 2 && (
          <>
            <h2>Make a little time.</h2>
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
              service time: {service?.duration_minutes! / 60} hours.
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
                      No appointments on this date. Please choose another day.
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
              <h2>Almost yours.</h2>
              <p>Review your appointment and add your contact details.</p>
            </div>
            <section className="booking-review" aria-label="Your appointment">
              <p className="eyebrow">YOUR APPOINTMENT</p>
              <div className="booking-review-grid">
                <div><span>Care</span><strong>{service?.name}</strong><small>{draft.vehicle_type}</small></div>
                <div><span>When</span><strong>{draft.date}</strong><small>{timeLabel(draft.start_minute)} CT</small></div>
                <div className="booking-review-price"><span>{service?.pricing_mode === "starting" ? "Starting at" : "Your estimate"}</span><strong>{money(price)}</strong></div>
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
              ? "Reserving..."
              : step === 3
                ? "CONFIRM APPOINTMENT"
                : "Continue"}{" "}
            <span>↗</span>
          </button>
        </div>
        <p className="small-note">
          No card details required to reserve.{" "}
          {business.deposit_percent > 0
            ? "Any required deposit is paid securely after confirmation."
            : "Payment details are confirmed with your appointment."}
        </p>
      </form>
      <aside className="booking-summary paper">
        <p className="eyebrow">YOUR VISIT</p>
        <h3>
          A little time.
          <br />
          <em>A new perspective.</em>
        </h3>
        <div className="summary-row">
          <span>Service</span>
          <strong>{service?.name || "Choose your care"}</strong>
        </div>
        <div className="summary-row">
          <span>Vehicle</span>
          <strong>
            {draft.make ? draft.make + " " + draft.model : draft.vehicle_type}
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
            {service?.pricing_mode === "starting" ? "From" : "Estimate"}
          </span>
          <strong>{service ? money(price) : "—"}</strong>
        </div>
        {business.deposit_percent > 0 && price !== null && (
          <div className="summary-row">
            <span>Deposit</span>
            <strong>
              {money(Math.round((price * business.deposit_percent) / 100))}
            </strong>
          </div>
        )}
        <p className="small-note">{business.cancellation_policy}</p>
      </aside>
    </div>
  );
}
