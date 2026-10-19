"use client";
import { useEffect, useRef, useState } from "react";
import { action, type RecordData } from "./AdminControls";
import { JobPayments } from "./JobPayments";
import { bookingAddOns, bookingCartSelection, defaultServicePackage, servicePackages, type BookingServiceChoice } from "@/lib/booking-options";
import { dateToday, money, timeLabel, type Service, type BusinessSettings } from "@/lib/platform/types";
type Contact = { id: string; first_name: string; last_name: string; phone: string; email: string };
type Vehicle = { id: string; year: number; make: string; model: string; type: string };
export function SalesBookingForm({ services, business, lead, onComplete }: {
  services: Service[]; business: BusinessSettings;
  lead?: { id: string; name: string; email: string; phone: string }; onComplete: () => void;
}) {
  const [contact, setContact] = useState({ first_name: lead?.name.split(" ")[0] || "", last_name: lead?.name.split(" ").slice(1).join(" ") || "", email: lead?.email || "", phone: lead?.phone || "" });
  const [vehicle, setVehicle] = useState({ year: new Date().getFullYear(), make: "", model: "", vehicle_type: "Sedan" });
  const [search, setSearch] = useState(""), [matches, setMatches] = useState<Contact[]>([]), [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [choices, setChoices] = useState<BookingServiceChoice[]>([]), [date, setDate] = useState(dateToday()), [start, setStart] = useState(-1), [slots, setSlots] = useState<Array<{ minute: number; available: boolean }>>([]);
  const [loadingSlots, setLoadingSlots] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notes, setNotes] = useState(""), [agreed, setAgreed] = useState(false), [stream, setStream] = useState("Unassigned"), [saved, setSaved] = useState<RecordData | null>(null);
  const session = useRef(crypto.randomUUID()), request = useRef({ body: "", id: "" });
  const ids = choices.map(c => c.service_id).join(",");
  let selection: ReturnType<typeof bookingCartSelection> | null = null;
  let selectionError = "";
  try { if (choices.length) selection = bookingCartSelection(services, vehicle.vehicle_type, choices); }
  catch (e) { selectionError = e instanceof Error ? e.message : "Review the selected services and upgrades."; }
  useEffect(() => {
    if (search.trim().length < 2) { setMatches([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/manage?section=customers&search=${encodeURIComponent(search.trim())}`, { signal: controller.signal })
        .then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error); return d; })
        .then(d => setMatches(d.rows.slice(0, 6)))
        .catch(e => { if (e.name !== "AbortError") setError("Customer lookup unavailable. Enter the customer's details below."); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);
  useEffect(() => {
    setStart(-1); setSlots([]);
    if (!ids || !date) return;
    const controller = new AbortController(); setLoadingSlots(true); setError("");
    const params = new URLSearchParams({ date }); ids.split(",").forEach(id => params.append("service_id", id));
    fetch("/api/availability?" + params, { signal: controller.signal }).then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error); return d; }).then(d => setSlots(d.slots)).catch(e => { if (e.name !== "AbortError") setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });
    return () => controller.abort();
  }, [ids, date]);
  async function chooseCustomer(c: Contact) {
    setContact({ first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone }); setSearch(""); setMatches([]); setVehicles([]);
    try { const r = await fetch(`/api/manage?section=customers&id=${c.id}`); const d = await r.json(); if (r.ok) setVehicles(d.profile?.vehicles || []); } catch { /* Contact can still be booked. */ }
  }
  function toggle(service: Service) {
    setChoices(current => current.some(c => c.service_id === service.id) ? current.filter(c => c.service_id !== service.id) : [...current, { service_id: service.id, service_package: defaultServicePackage(service.slug), addons: [] }]);
  }
  function changeChoice(id: string, values: Partial<BookingServiceChoice>) { setChoices(current => current.map(c => c.service_id === id ? { ...c, ...values } : c)); }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    if (selectionError) { setError(selectionError); return; }
    if (!choices.length || !slots.some(s => s.available && s.minute === start) || !agreed) { setError("Choose services, an available time, and confirm the customer's agreement."); return; }
    setBusy(true);
    try {
      const base = { ...contact, ...vehicle, services: choices, date, start_minute: start, notes, location: business.address || "Studio", terms: true, marketing_email: false, marketing_sms: false, session_id: session.current, device: "admin", attribution: { source: "Phone", lead_stream: stream, medium: "", campaign: "", gclid: "", gbraid: "", wbraid: "", fbclid: "" }, ...(lead ? { lead_id: lead.id } : {}) };
      const body = JSON.stringify(base); if (body !== request.current.body) request.current = { body, id: crypto.randomUUID() };
      const result = await action("create_booking", { ...base, request_key: request.current.id });
      setSaved(result.booking as RecordData);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save appointment."); } finally { setBusy(false); }
  }
  if (saved) return <div className="sales-booking-success"><h3>Appointment saved · {String(saved.reference)}</h3><p>The booking acknowledgement is queued. Collect the deposit to secure the appointment; quote items need an agreed price first.</p><div className="button-row"><JobPayments booking={{ ...saved, collected_cents: 0, square_environment: business.square_environment }} /><button className="button" onClick={onComplete}>Done — return to bookings</button></div></div>;
  return <form className="sales-booking" onSubmit={submit}>
    <p className="small-note">Phone / walk-in booking · capture the customer, sell the services, reserve a time, then collect the deposit.</p>
    {error && <p className="error-message" role="alert">{error}</p>}
    {selectionError && <p className="error-message" role="alert">{selectionError}</p>}
    <div className="sales-booking-grid">
      <section className="sales-booking-section"><h3>1. Customer & vehicle</h3>
        <label className="field"><span>Find an existing customer</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, phone or email" /></label>
        {matches.length > 0 && <div className="sales-customer-results">{matches.map(c => <button type="button" key={c.id} onClick={() => void chooseCustomer(c)}>{c.first_name} {c.last_name}<small>{c.phone} · {c.email}</small></button>)}</div>}
        <div className="sales-field-grid">{([['first_name','First name'],['last_name','Last name'],['phone','Phone'],['email','Email']] as const).map(([key,label]) => <label className="field" key={key}><span>{label}</span><input type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} value={contact[key]} required onChange={e => setContact({ ...contact, [key]: e.target.value })} /></label>)}</div>
        {vehicles.length > 0 && <label className="field"><span>Saved vehicle</span><select defaultValue="" onChange={e => { const v = vehicles.find(v => v.id === e.target.value); if (v) setVehicle({ year: v.year, make: v.make, model: v.model, vehicle_type: v.type }); }}><option value="">Choose or enter a new vehicle</option>{vehicles.map(v => <option value={v.id} key={v.id}>{v.year} {v.make} {v.model}</option>)}</select></label>}
        <div className="sales-field-grid"><label className="field"><span>Year</span><input type="number" min={1900} max={new Date().getFullYear()+2} required value={vehicle.year} onChange={e => setVehicle({ ...vehicle, year: Number(e.target.value) })} /></label><label className="field"><span>Vehicle size</span><select value={vehicle.vehicle_type} onChange={e => setVehicle({ ...vehicle, vehicle_type: e.target.value })}>{["Sedan","SUV","Truck"].map(v => <option key={v}>{v}</option>)}</select></label>{([['make','Make'],['model','Model']] as const).map(([key,label]) => <label className="field" key={key}><span>{label}</span><input value={vehicle[key]} required onChange={e => setVehicle({ ...vehicle, [key]: e.target.value })} /></label>)}</div>
      </section>
      <section className="sales-booking-section"><h3>2. Services & upgrades</h3>
        <div className="sales-service-list">{services.map(service => { const choice = choices.find(c => c.service_id === service.id); return <div key={service.id} className={choice ? "selected" : ""}><label><input type="checkbox" checked={!!choice} onChange={() => toggle(service)} /><span><strong>{service.name}</strong><small>{service.duration_minutes / 60}h · {service.pricing_mode === "quote" ? "By quote" : money(service.price_cents)}</small></span></label>{choice && <div className="sales-service-options">
          {servicePackages(service.slug).length > 0 && <label className="field"><span>Package</span><select value={choice.service_package} onChange={e => changeChoice(service.id, { service_package: e.target.value })}>{servicePackages(service.slug).map(p => <option value={p.id} key={p.id}>{p.name} · {p.priceCents === null ? "By quote" : money(p.priceCents)}</option>)}</select></label>}
          {bookingAddOns(service.slug).map(addon => <label className="sales-addon" key={addon.id}><input type="checkbox" checked={choice.addons?.includes(addon.id) || false} onChange={e => changeChoice(service.id, { addons: e.target.checked ? [...(choice.addons || []), addon.id] : choice.addons?.filter(id => id !== addon.id) })} /><span>{addon.name}</span><small>{addon.priceCents === null ? "By quote" : money(addon.priceCents)}</small></label>)}
        </div>}</div>; })}</div>
      </section>
      <section className="sales-booking-section"><h3>3. Appointment</h3><div className="sales-field-grid"><label className="field"><span>Date</span><input type="date" min={dateToday()} value={date} required onChange={e => setDate(e.target.value)} /></label><label className="field"><span>Available time (Chicago)</span><select value={start} required disabled={loadingSlots || !choices.length} onChange={e => setStart(Number(e.target.value))}><option value={-1}>{loadingSlots ? "Checking schedule…" : "Choose a time"}</option>{slots.filter(s => s.available).map(s => <option value={s.minute} key={s.minute}>{timeLabel(s.minute)}</option>)}</select></label></div>{choices.length > 0 && !loadingSlots && !slots.some(s => s.available) && <p role="status">No available times. Choose another date or a shorter service combination.</p>}
        <label className="field"><span>Customer / access notes</span><textarea value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} /></label>
        {!lead && <label className="field"><span>Marketing source</span><select value={stream} onChange={e => setStream(e.target.value)}><option value="Unassigned">Organic / direct / unassigned</option><option value="Business Google · 10%">Business Google</option><option value="Business Meta · 10%">Business Meta</option><option value="Dima Google · 25%">Partner Google</option></select></label>}
      </section>
      <section className="sales-booking-section sales-booking-summary"><h3>Sale summary</h3><p>{choices.length} service{choices.length === 1 ? "" : "s"} · {selection?.items.reduce((sum,item) => sum + item.service.duration_minutes, 0) || 0} minutes</p><strong>{selection?.requiresQuote ? "Quote approval required" : money(selection?.totalCents ?? 0)}</strong>{selection?.requiresQuote && <p>{money(selection.knownCents)} in priced items, plus quoted work.</p>}<p>{selection?.requiresQuote ? "Agree all quoted prices before requesting payment." : "50% deposit, remaining balance after the detail. Open Payments after saving to create and text the customer's secure link."}</p>
        <label className="sales-agreement"><input type="checkbox" required checked={agreed} onChange={e => setAgreed(e.target.checked)} /><span>Customer agrees to the <a className="text-link" href="/service-rules" target="_blank" rel="noreferrer">service terms</a>, <a className="text-link" href="/privacy-notice" target="_blank" rel="noreferrer">privacy notice</a> and appointment-related texts. This does not enroll them in marketing.</span></label>
        <button className="button" disabled={busy || loadingSlots || !choices.length || !!selectionError || start < 0}>{busy ? "Saving appointment…" : "Save appointment & collect deposit"}</button>
      </section>
    </div>
  </form>;
}
