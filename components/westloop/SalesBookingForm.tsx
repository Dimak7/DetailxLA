"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { action, type RecordData } from "./AdminControls";
import { JobPayments } from "./JobPayments";
import { bookingAddOns, bookingCartSelection, defaultServicePackage, servicePackages, type BookingServiceChoice } from "@/lib/booking-options";
import { dateToday, money, timeLabel, type Service, type BusinessSettings } from "@/lib/platform/types";
import styles from "./SalesBookingForm.module.css";

type Contact = { id: string; first_name: string; last_name: string; phone: string; email: string };
type Vehicle = { id: string; year: number; make: string; model: string; type: string };
const dollars = (amount: number | null | undefined) => amount == null ? "" : (amount / 100).toFixed(2);
function cents(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= 10000000 ? amount : null;
}
function chicagoMinute() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Number(parts.find(p => p.type === "hour")?.value) * 60 + Number(parts.find(p => p.type === "minute")?.value);
}
function ServiceSymbol({ slug }: { slug: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {slug.includes("ceramic") ? <><path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Z"/><path d="m8 12 3 3 5-6"/></> : slug.includes("paint") ? <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/><path d="M20 3v4m-2-2h4"/></> : <><path d="m5 8 2-4h10l2 4 2 3v7H3v-7l2-3ZM5 8h14M3 12h18M6 18v3m12-3v3"/><path d="M6 15h2m8 0h2"/></>}
  </svg>;
}

export function SalesBookingForm({ services, business, lead, onComplete }: {
  services: Service[]; business: BusinessSettings;
  lead?: { id: string; name: string; email: string; phone: string }; onComplete: () => void;
}) {
  const [contact, setContact] = useState({ first_name: lead?.name.split(" ")[0] || "", last_name: lead?.name.split(" ").slice(1).join(" ") || "", email: lead?.email || "", phone: lead?.phone || "" });
  const [vehicle, setVehicle] = useState({ year: new Date().getFullYear(), make: "", model: "", vehicle_type: "Sedan" });
  const [search, setSearch] = useState(""), [matches, setMatches] = useState<Contact[]>([]), [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [choices, setChoices] = useState<BookingServiceChoice[]>([]), [date, setDate] = useState(dateToday()), [start, setStart] = useState(-1), [slots, setSlots] = useState<Array<{ minute: number; available: boolean }>>([]);
  const [walkIn, setWalkIn] = useState(!lead), [duration, setDuration] = useState(""), [prices, setPrices] = useState<Record<string, string>>({}), [names, setNames] = useState<Record<string, string>>({}), [discount, setDiscount] = useState("0");
  const [loadingSlots, setLoadingSlots] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notes, setNotes] = useState(""), [agreed, setAgreed] = useState(false), [stream, setStream] = useState("Unassigned"), [saved, setSaved] = useState<RecordData | null>(null);
  const [step, setStep] = useState(0);
  const formRef = useRef<HTMLFormElement>(null), panelRef = useRef<HTMLDivElement>(null);
  const stepLabels = ["Customer", "Services", "Schedule & payment"];
  const session = useRef(crypto.randomUUID()), request = useRef({ body: "", id: "" });
  const ids = choices.map(c => c.service_id).join(",");
  let selection: ReturnType<typeof bookingCartSelection> | null = null;
  let selectionError = "";
  try { if (choices.length) selection = bookingCartSelection(services, vehicle.vehicle_type, choices); }
  catch (e) { selectionError = e instanceof Error ? e.message : "Review the selected services and upgrades."; }
  const durationMinutes = duration === "" ? selection?.durationMinutes || 0 : Number(duration);
  const validDuration = Number.isInteger(durationMinutes) && durationMinutes >= 30 && durationMinutes <= 720;
  const selectedPrices = selection?.items.map(item => ({
    service_id: item.service.id,
    name: names[item.service.id]?.trim() || undefined,
    amount_cents: cents(prices[item.service.id] ?? dollars(item.baseCents)),
    addons: item.selectedAddOns.map(addon => ({ addon_id: addon.id, amount_cents: cents(prices[`${item.service.id}:${addon.id}`] ?? dollars(addon.priceCents)) })),
  })) || [];
  const allPriced = selectedPrices.length > 0 && selectedPrices.every(item => item.amount_cents !== null && item.addons.every(addon => addon.amount_cents !== null));
  const subtotal = selectedPrices.reduce((sum, item) => sum + (item.amount_cents || 0) + item.addons.reduce((sum, addon) => sum + (addon.amount_cents || 0), 0), 0);
  const discountCents = cents(discount);
  const validDiscount = discountCents !== null && discountCents <= subtotal;
  const netTotal = allPriced && validDiscount ? subtotal - discountCents : null;

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
    setStart(-1); setSlots([]); setLoadingSlots(false);
    if (!ids || !date || !validDuration) return;
    const controller = new AbortController(); setLoadingSlots(true); setError("");
    const params = new URLSearchParams({ date, walk_in: String(walkIn), duration_minutes: String(durationMinutes) });
    ids.split(",").forEach(id => params.append("service_id", id));
    fetch("/api/admin/booking-availability?" + params, { signal: controller.signal, cache: "no-store" })
      .then(async r => { const d = await r.json(); if (!r.ok) throw Error(d.error); return d; })
      .then(d => {
        setSlots(d.slots);
        if (walkIn) {
          const now = Math.floor(chicagoMinute() / 30) * 30;
          setStart(d.slots.find((slot: { minute: number; available: boolean }) => slot.available && slot.minute >= now)?.minute ?? -1);
        }
      }).catch(e => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });
    return () => controller.abort();
  }, [ids, date, walkIn, durationMinutes, validDuration]);
  async function chooseCustomer(c: Contact) {
    setContact({ first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone }); setSearch(""); setMatches([]); setVehicles([]);
    try { const r = await fetch(`/api/manage?section=customers&id=${c.id}`); const d = await r.json(); if (r.ok) setVehicles(d.profile?.vehicles || []); } catch { /* Contact can still be booked. */ }
  }
  function toggle(service: Service) {
    setChoices(current => current.some(c => c.service_id === service.id) ? current.filter(c => c.service_id !== service.id) : [...current, { service_id: service.id, service_package: defaultServicePackage(service.slug), addons: [] }]);
  }
  function changeChoice(id: string, values: Partial<BookingServiceChoice>) {
    setChoices(current => current.map(c => c.service_id === id ? { ...c, ...values } : c));
    if (values.service_package !== undefined) setPrices(current => { const next = { ...current }; delete next[id]; return next; });
  }
  function showIssue(message: string, atStep: number, field?: string) {
    setStep(atStep); setError(message);
    requestAnimationFrame(() => {
      const target = field ? formRef.current?.elements.namedItem(field) : null;
      if (target instanceof HTMLElement) target.focus();
      else panelRef.current?.focus();
    });
    return false;
  }
  function validateCustomer() {
    for (const [key, label] of [["first_name", "first name"], ["last_name", "last name"]] as const) {
      if (!contact[key].trim() || contact[key].trim().length > 80) return showIssue(`Enter the customer's ${label} (up to 80 characters).`, 0, key);
    }
    if (!/^\+?[\d ()-]{10,25}$/.test(contact.phone.trim())) return showIssue("Enter a valid customer phone number, including the area code.", 0, "phone");
    if (contact.email.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return showIssue("Enter a valid customer email address.", 0, "email");
    if (!Number.isInteger(vehicle.year) || vehicle.year < 1900 || vehicle.year > new Date().getFullYear() + 2) return showIssue("Enter a valid vehicle year.", 0, "year");
    for (const key of ["make", "model"] as const) {
      if (!vehicle[key].trim() || vehicle[key].trim().length > 80) return showIssue(`Enter the vehicle ${key} (up to 80 characters).`, 0, key);
    }
    if (!["Sedan", "SUV", "Truck"].includes(vehicle.vehicle_type)) return showIssue("Choose the vehicle size.", 0, "vehicle_type");
    return true;
  }
  function validateServices() {
    if (!choices.length) return showIssue("Select at least one service for this booking.", 1);
    if (selectionError) return showIssue(selectionError, 1);
    if (!allPriced) return showIssue("Enter the agreed price for every service and selected upgrade.", 1);
    return true;
  }
  function goToStep(next: number) {
    if (busy) return;
    if (next > step && (!validateCustomer() || (next > 1 && !validateServices()))) return;
    setError(""); setStep(next);
    requestAnimationFrame(() => panelRef.current?.focus());
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (busy) return;
    if (step < 2) { goToStep(step + 1); return; }
    if (!validateCustomer() || !validateServices()) return;
    if (!validDiscount) { showIssue("Enter a discount no greater than the subtotal.", 2, "discount"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < dateToday() || (walkIn && date !== dateToday())) { showIssue("Choose a valid appointment date. Walk-in jobs must be booked for today.", 2, "date"); return; }
    if (!validDuration) { showIssue("Reserve between 30 and 720 minutes for this job.", 2, "duration"); return; }
    if (loadingSlots || !slots.some(slot => slot.available && slot.minute === start)) { showIssue("Choose an available start time for this job.", 2, "start"); return; }
    if (!agreed) { showIssue("Confirm the customer's agreement to the prices and appointment terms.", 2, "agreed"); return; }
    setBusy(true);
    try {
      const base = {
        ...contact, ...vehicle, services: choices, date, start_minute: start, notes, location: business.address || "Studio", terms: true,
        marketing_email: false, marketing_sms: false, session_id: session.current, device: "admin",
        attribution: { source: walkIn ? "Walk-in" : "Phone", lead_stream: stream, medium: "", campaign: "", gclid: "", gbraid: "", wbraid: "", fbclid: "" },
        admin_sale: { walk_in: walkIn, duration_minutes: durationMinutes, prices: selectedPrices, discount_cents: discountCents },
        ...(lead ? { lead_id: lead.id } : {}),
      };
      const body = JSON.stringify(base); if (body !== request.current.body) request.current = { body, id: crypto.randomUUID() };
      const result = await action("create_booking", { ...base, request_key: request.current.id });
      setSaved(result.booking as RecordData);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save appointment."); } finally { setBusy(false); }
  }
  if (saved) return <div className="sales-booking-success"><h3>{walkIn ? "Walk-in job" : "Appointment"} saved · {String(saved.reference)}</h3><p>Agreed service total: <strong>{money(Number(saved.price_cents))}</strong>.</p><p>Collect by Square or record a cash payment. Add the customer's tip with that payment so it is recorded once.</p><div><JobPayments embedded booking={{ ...saved, collected_cents: 0, square_environment: business.square_environment }} /><button className="button" onClick={onComplete}>Done — return to bookings</button></div></div>;
  return <form ref={formRef} className={`sales-booking ${styles.form}`} onSubmit={submit} noValidate>
    <div className={styles.mode} aria-label="Booking type"><button type="button" disabled={busy} aria-pressed={walkIn} onClick={() => { setWalkIn(true); setDate(dateToday()); }}>Walk-in now</button><button type="button" disabled={busy} aria-pressed={!walkIn} onClick={() => setWalkIn(false)}>Book for later</button></div>
    <nav className={styles.steps} aria-label="Booking steps">{stepLabels.map((label, index) => <button key={label} type="button" disabled={busy} aria-current={step === index ? "step" : undefined} onClick={() => goToStep(index)}><span aria-hidden="true">{index + 1}</span><strong>{label}</strong></button>)}</nav>
    <div ref={panelRef} tabIndex={-1} className={`${styles.panel} ${step === 2 ? styles.finalStep : ""}`} aria-label={`Step ${step + 1}: ${stepLabels[step]}`}>
      {error && <p className={`error-message ${styles.error}`} role="alert">{error}</p>}
      {selectionError && step === 1 && selectionError !== error && <p className={`error-message ${styles.error}`} role="alert">{selectionError}</p>}
      {step === 0 && <section className="sales-booking-section"><div className={styles.sectionIntro}><span>THE CUSTOMER</span><h3>Who are we booking?</h3><p>Find a returning customer or start with their details.</p></div>
        <label className="field"><span>Find an existing customer</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, phone or email" /></label>
        {matches.length > 0 && <div className="sales-customer-results">{matches.map(c => <button type="button" key={c.id} onClick={() => void chooseCustomer(c)}>{c.first_name} {c.last_name}<small>{c.phone} · {c.email}</small></button>)}</div>}
        <div className="sales-field-grid">{([['first_name','First name'],['last_name','Last name'],['phone','Phone'],['email','Email']] as const).map(([key,label]) => <label className="field" key={key}><span>{label}</span><input name={key} maxLength={key === "email" ? 180 : key === "phone" ? 25 : 80} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} autoComplete={key === "first_name" ? "given-name" : key === "last_name" ? "family-name" : key === "phone" ? "tel" : "email"} value={contact[key]} required onChange={e => setContact({ ...contact, [key]: e.target.value })} /></label>)}</div>
        <h4 className={styles.subheading}>Their vehicle</h4>
        {vehicles.length > 0 && <label className="field"><span>Saved vehicle</span><select defaultValue="" onChange={e => { const v = vehicles.find(v => v.id === e.target.value); if (v) setVehicle({ year: v.year, make: v.make, model: v.model, vehicle_type: v.type }); }}><option value="">Choose or enter a new vehicle</option>{vehicles.map(v => <option value={v.id} key={v.id}>{v.year} {v.make} {v.model}</option>)}</select></label>}
        <div className="sales-field-grid"><label className="field"><span>Year</span><input name="year" type="number" min={1900} max={new Date().getFullYear()+2} required value={vehicle.year} onChange={e => setVehicle({ ...vehicle, year: Number(e.target.value) })} /></label><label className="field"><span>Vehicle size</span><select name="vehicle_type" value={vehicle.vehicle_type} onChange={e => setVehicle({ ...vehicle, vehicle_type: e.target.value })}>{["Sedan","SUV","Truck"].map(v => <option key={v}>{v}</option>)}</select></label>{([['make','Make'],['model','Model']] as const).map(([key,label]) => <label className="field" key={key}><span>{label}</span><input name={key} maxLength={80} value={vehicle[key]} required onChange={e => setVehicle({ ...vehicle, [key]: e.target.value })} /></label>)}</div>
      </section>}
      {step === 1 && <section className="sales-booking-section"><div className={styles.sectionIntro}><span>THE WORK</span><h3>Choose their services.</h3><p>Select one or more services, then confirm their prices.</p></div>
        <details className={styles.help}><summary>Booking a custom job, such as a $25 wash?</summary><p>Select the closest service, change its job name and enter the agreed price. Upgrades keep their own prices.</p></details>
        <div className="sales-service-list">{services.map(service => { const choice = choices.find(c => c.service_id === service.id), item = selection?.items.find(item => item.service.id === service.id); return <div key={service.id} className={choice ? "selected" : ""}><label><span className={styles.serviceSymbol}><ServiceSymbol slug={service.slug}/></span><span className={styles.serviceCopy}><strong>{service.name}</strong><small>{service.duration_minutes / 60}h · {service.pricing_mode === "quote" ? "By quote" : money(service.price_cents)}</small></span><input type="checkbox" checked={!!choice} onChange={() => toggle(service)} /></label>{choice && <div className="sales-service-options">
          {servicePackages(service.slug).length > 0 && <label className="field"><span>Package</span><select value={choice.service_package} onChange={e => changeChoice(service.id, { service_package: e.target.value })}>{servicePackages(service.slug).map(p => <option value={p.id} key={p.id}>{p.name} · {p.priceCents === null ? "By quote" : money(p.priceCents)}</option>)}</select></label>}
          <label className="field"><span>Job name (optional)</span><input value={names[service.id] || ""} maxLength={160} placeholder={service.name} onChange={e => setNames(current => ({ ...current, [service.id]: e.target.value }))} /></label>
          <label className="field"><span>Agreed service price ($)</span><input type="number" inputMode="decimal" min="0" max="100000" step="0.01" required value={prices[service.id] ?? dollars(item?.baseCents)} placeholder="Enter agreed price" onChange={e => setPrices(current => ({ ...current, [service.id]: e.target.value }))} /></label>
          {bookingAddOns(service.slug).length > 0 && <details className={styles.upgrades}><summary>Optional upgrades · {choice.addons?.length || 0} selected</summary>{bookingAddOns(service.slug).map(addon => { const selected = choice.addons?.includes(addon.id) || false, key = `${service.id}:${addon.id}`; return <div key={addon.id}><label className="sales-addon"><input type="checkbox" checked={selected} onChange={e => changeChoice(service.id, { addons: e.target.checked ? [...(choice.addons || []), addon.id] : choice.addons?.filter(id => id !== addon.id) })} /><span>{addon.name}</span><small>{addon.priceCents === null ? "By quote" : money(addon.priceCents)}</small></label>{selected && <label className="field"><span>{addon.name} price ($)</span><input type="number" inputMode="decimal" min="0" max="100000" step="0.01" required value={prices[key] ?? dollars(addon.priceCents)} placeholder="Enter agreed price" onChange={e => setPrices(current => ({ ...current, [key]: e.target.value }))} /></label>}</div>; })}</details>}
        </div>}</div>; })}</div>
      </section>}
      {step === 2 && <><section className="sales-booking-section"><h3>{walkIn ? "Today's job" : "Schedule the appointment"}</h3><div className={styles.customerSummary}><strong>{contact.first_name} {contact.last_name}</strong><span>{vehicle.year} {vehicle.make} {vehicle.model}</span><button type="button" onClick={() => goToStep(0)}>Edit</button></div><div className="sales-field-grid"><label className="field"><span>Date</span><input name="date" type="date" min={dateToday()} max={walkIn ? dateToday() : undefined} value={date} disabled={walkIn} required onChange={e => setDate(e.target.value)} /></label><label className="field"><span>Reserved time (minutes)</span><input name="duration" type="number" min="30" max="720" step="1" value={duration} placeholder={String(selection?.durationMinutes || 30)} onChange={e => setDuration(e.target.value)} /></label><label className={`field ${styles.time}`}><span>{walkIn ? "Job start time" : "Available time"} (Chicago)</span><select name="start" value={start} required disabled={loadingSlots || !choices.length || !validDuration} onChange={e => setStart(Number(e.target.value))}><option value={-1}>{loadingSlots ? "Checking schedule…" : "Choose a time"}</option>{slots.filter(slot => slot.available).map(slot => <option value={slot.minute} key={slot.minute}>{timeLabel(slot.minute)}</option>)}</select></label></div>
        {choices.length > 0 && !validDuration && <p className="error-message">Reserve between 30 and 720 minutes for this job.</p>}
        {choices.length > 0 && validDuration && !loadingSlots && !slots.some(slot => slot.available) && <p role="status">No available times. Review the reserved duration or choose another date.</p>}
        {walkIn && <p className="small-note">Today's earlier times are available for recording a walk-in. Opening hours, blocked times and bay capacity still apply.</p>}
        <details className={styles.help}><summary>Notes &amp; lead source</summary><label className="field"><span>Customer / access notes</span><textarea value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} /></label>
        {!lead && <label className="field"><span>Marketing source</span><select value={stream} onChange={e => setStream(e.target.value)}><option value="Unassigned">Organic / direct / unassigned</option><option value="Business Google · 10%">Business Google</option><option value="Business Meta · 10%">Business Meta</option><option value="Dima Google · 25%">Partner Google</option></select></label>}
        </details>
      </section>
      <section className="sales-booking-section sales-booking-summary"><h3>Review &amp; save</h3><p>{choices.length} service{choices.length === 1 ? "" : "s"} · {durationMinutes || 0} minutes reserved</p>
        <div className={styles.selectedSummary}>{selection?.items.map(item => <div key={item.service.id}><strong>{names[item.service.id]?.trim() || item.service.name}</strong>{item.selectedAddOns.length > 0 && <small>{item.selectedAddOns.map(addon => addon.name).join(", ")}</small>}</div>)}<button type="button" onClick={() => goToStep(1)}>Edit services</button></div>
        <dl className={styles.totals}><div><dt>Services & upgrades</dt><dd>{allPriced ? money(subtotal) : "Enter all agreed prices"}</dd></div></dl>
        <label className="field"><span>Discount on services ($)</span><input name="discount" type="number" inputMode="decimal" min="0" max={subtotal / 100} step="0.01" required value={discount} onChange={e => setDiscount(e.target.value)} /></label>
        {!validDiscount && <p className="error-message">The discount must be between $0 and the subtotal.</p>}
        <dl className={styles.totals}><div><dt>Agreed service total</dt><dd><strong>{money(netTotal)}</strong></dd></div></dl>
        <p>Save first, then collect payment by Square or cash and add any tip.</p>
        <details className={styles.help}><summary>How deposits, tips &amp; employee pay work</summary><p>Employee percentage pay uses service prices after discounts. Tips are separate and can be entered when collecting payment.</p><p>{walkIn ? "Collect the full service balance after saving. Cash payments and Square payments are tracked separately from tips." : "The deposit and remaining balance will be shown in Payments after saving. A deposit reduces what the customer owes; it does not reduce the employee's commission basis."}</p></details>
        <label className="sales-agreement"><input name="agreed" type="checkbox" required checked={agreed} onChange={e => setAgreed(e.target.checked)} /><span>Customer agrees to these prices, the <a className="text-link" href="/service-rules" target="_blank" rel="noopener noreferrer">service terms</a>, <a className="text-link" href="/privacy-notice" target="_blank" rel="noopener noreferrer">privacy notice</a> and appointment-related texts. This does not enroll them in marketing.</span></label>
        <button className="button" disabled={busy || loadingSlots || !allPriced || !validDiscount || !validDuration || !!selectionError || start < 0}>{busy ? "Saving…" : walkIn ? "Save job & collect payment" : "Save appointment & collect payment"}</button>
      </section></>}
    </div>
    <div className={styles.stepFooter}><div>{step > 0 && <button type="button" disabled={busy} onClick={() => goToStep(step - 1)}>Back</button>}<span>Step {step + 1} of 3</span></div>{step < 2 ? <button type="button" className="button" onClick={() => goToStep(step + 1)}>{step === 0 ? "Continue to services" : "Continue to schedule"}</button> : <span className={styles.footerNote}>Payment comes after saving</span>}</div>
  </form>;
}
