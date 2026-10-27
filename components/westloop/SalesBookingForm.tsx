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
  const [channel, setChannel] = useState<"walk-in" | "phone">(lead ? "phone" : "walk-in");
  const walkIn = channel === "walk-in";
  const [duration, setDuration] = useState(""), [prices, setPrices] = useState<Record<string, string>>({}), [names, setNames] = useState<Record<string, string>>({}), [discount, setDiscount] = useState("0");
  const [loadingSlots, setLoadingSlots] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notes, setNotes] = useState(""), [agreed, setAgreed] = useState(false), [stream, setStream] = useState("Unassigned"), [saved, setSaved] = useState<RecordData | null>(null);
  const [serviceToAdd, setServiceToAdd] = useState("");
  const [customOpen, setCustomOpen] = useState(false), [customCategory, setCustomCategory] = useState(""), [customName, setCustomName] = useState(""), [customPrice, setCustomPrice] = useState("");
  const [customIds, setCustomIds] = useState<string[]>([]), [savedVehicle, setSavedVehicle] = useState("");
  const customerRequest = useRef(0);
  const formRef = useRef<HTMLFormElement>(null), panelRef = useRef<HTMLDivElement>(null);
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
  const totalLabel = netTotal === null ? (choices.length ? "Enter prices" : "—") : money(netTotal);

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
  function applyVehicle(v: Vehicle) {
    setSavedVehicle(v.id);
    setVehicle({ year: v.year, make: v.make, model: v.model, vehicle_type: v.type });
  }
  async function chooseCustomer(c: Contact) {
    const lookup = ++customerRequest.current;
    setContact({ first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone });
    setSearch(""); setMatches([]); setVehicles([]); setSavedVehicle("");
    setVehicle({ year: new Date().getFullYear(), make: "", model: "", vehicle_type: "Sedan" });
    try {
      const r = await fetch(`/api/manage?section=customers&id=${c.id}`);
      const d = await r.json();
      if (r.ok && lookup === customerRequest.current) {
        const found: Vehicle[] = d.profile?.vehicles || [];
        setVehicles(found);
        if (found.length === 1) applyVehicle(found[0]);
      }
    } catch { /* Contact can still be booked with manually entered vehicle details. */ }
  }
  function addService(id: string) {
    const service = services.find(item => item.id === id);
    if (!service) return showIssue("Choose a service to add.", "service_picker");
    if (choices.some(choice => choice.service_id === id)) return showIssue("That service is already on this job. Edit its price below.", `price_${id}`);
    if (choices.length >= 12) return showIssue("A booking can contain up to 12 services.", "service_picker");
    setChoices(current => [...current, { service_id: id, service_package: defaultServicePackage(service.slug), addons: [] }]);
    setServiceToAdd(""); setError("");
    return true;
  }
  function addCustomJob() {
    if (!services.some(service => service.id === customCategory)) return showIssue("Choose the service category for this custom job.", "custom_category");
    if (customName.trim().length < 2 || customName.trim().length > 160) return showIssue("Enter a clear job name, such as Hand wash.", "custom_name");
    if (cents(customPrice) === null) return showIssue("Enter the agreed price for this custom job.", "custom_price");
    if (!addService(customCategory)) return;
    setNames(current => ({ ...current, [customCategory]: customName.trim() }));
    setPrices(current => ({ ...current, [customCategory]: customPrice }));
    setCustomIds(current => [...current, customCategory]);
    setCustomOpen(false); setCustomCategory(""); setCustomName(""); setCustomPrice("");
  }
  function removeService(id: string) {
    setChoices(current => current.filter(choice => choice.service_id !== id));
    setCustomIds(current => current.filter(value => value !== id));
    setNames(current => { const next = { ...current }; delete next[id]; return next; });
    setPrices(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id && !key.startsWith(`${id}:`))));
  }
  function changeChoice(id: string, values: Partial<BookingServiceChoice>) {
    setChoices(current => current.map(c => c.service_id === id ? { ...c, ...values } : c));
    if (values.service_package !== undefined) setPrices(current => { const next = { ...current }; delete next[id]; return next; });
  }
  function showIssue(message: string, field?: string) {
    setError(message);
    requestAnimationFrame(() => {
      const target = field ? formRef.current?.elements.namedItem(field) : null;
      if (target instanceof HTMLElement) {
        let details = target.closest("details");
        while (details) { details.open = true; details = details.parentElement?.closest("details") || null; }
        target.focus();
      }
      else panelRef.current?.focus();
    });
    return false;
  }
  function validateCustomer() {
    for (const [key, label] of [["first_name", "first name"], ["last_name", "last name"]] as const) {
      if (!contact[key].trim() || contact[key].trim().length > 80) return showIssue(`Enter the customer's ${label} (up to 80 characters).`, key);
    }
    if (!/^\+?[\d ()-]{10,25}$/.test(contact.phone.trim())) return showIssue("Enter a valid customer phone number, including the area code.", "phone");
    if (contact.email.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return showIssue("Enter a valid customer email address.", "email");
    if (!Number.isInteger(vehicle.year) || vehicle.year < 1900 || vehicle.year > new Date().getFullYear() + 2) return showIssue("Enter a valid vehicle year.", "year");
    for (const key of ["make", "model"] as const) {
      if (!vehicle[key].trim() || vehicle[key].trim().length > 80) return showIssue(`Enter the vehicle ${key} (up to 80 characters).`, key);
    }
    if (!["Sedan", "SUV", "Truck"].includes(vehicle.vehicle_type)) return showIssue("Choose the vehicle size.", "vehicle_type");
    return true;
  }
  function validateServices() {
    if (!choices.length) return showIssue("Select at least one service for this booking.", "service_picker");
    if (selectionError) return showIssue(selectionError, "service_picker");
    for (const choice of choices) {
      const name = names[choice.service_id]?.trim() || "";
      if ((customIds.includes(choice.service_id) && name.length < 2) || (name && name.length < 2)) return showIssue("Enter a job name with at least two characters.", `name_${choice.service_id}`);
      const price = selectedPrices.find(item => item.service_id === choice.service_id);
      if (!price || price.amount_cents === null) return showIssue("Enter the agreed price for each service.", `price_${choice.service_id}`);
      const missingAddon = price.addons.find(addon => addon.amount_cents === null);
      if (missingAddon) return showIssue("Enter the agreed price for each selected upgrade.", `price_${choice.service_id}:${missingAddon.addon_id}`);
    }
    return true;
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (busy) return;
    if (serviceToAdd) { showIssue("Add the selected service before saving, or clear the selection.", "service_picker"); return; }
    if (customOpen && (customCategory || customName || customPrice)) { showIssue("Add the custom job before saving, or clear its fields.", "custom_name"); return; }
    if (!validateCustomer() || !validateServices()) return;
    if (!validDiscount) { showIssue("Enter a discount no greater than the subtotal.", "discount"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < dateToday() || (walkIn && date !== dateToday())) { showIssue("Choose a valid appointment date. Walk-in jobs must be booked for today.", "date"); return; }
    if (!validDuration) { showIssue("Reserve between 30 and 720 minutes for this job.", "duration"); return; }
    if (loadingSlots || !slots.some(slot => slot.available && slot.minute === start)) { showIssue("Choose an available start time for this job.", "start"); return; }
    if (!agreed) { showIssue("Confirm the customer's agreement to the prices and appointment terms.", "agreed"); return; }
    setBusy(true);
    try {
      const base = {
        ...contact, ...vehicle, services: choices, date, start_minute: start, notes, location: business.address || "Studio", terms: true,
        marketing_email: false, marketing_sms: false, session_id: session.current, device: "admin",
        attribution: { source: channel === "walk-in" ? "Walk-in" : "Phone", lead_stream: stream, medium: "", campaign: "", gclid: "", gbraid: "", wbraid: "", fbclid: "" },
        admin_sale: { walk_in: walkIn, duration_minutes: durationMinutes, prices: selectedPrices, discount_cents: discountCents },
        ...(lead ? { lead_id: lead.id } : {}),
      };
      const body = JSON.stringify(base); if (body !== request.current.body) request.current = { body, id: crypto.randomUUID() };
      const result = await action("create_booking", { ...base, request_key: request.current.id });
      setSaved(result.booking as RecordData);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save appointment."); } finally { setBusy(false); }
  }
  const progress = <ol className={styles.steps} aria-label="Booking progress">
    <li aria-current={!saved ? "step" : undefined}><span aria-hidden="true">{saved ? "✓" : "1"}</span><strong>Booking details</strong></li>
    <li aria-current={saved ? "step" : undefined}><span aria-hidden="true">2</span><strong>Payment</strong></li>
  </ol>;
  if (saved) return <div className={`sales-booking-success ${styles.success}`}>
    {progress}
    <div className={styles.savedHeading} role="status"><span className={styles.savedCheck} aria-hidden="true">✓</span><div><h3>{walkIn ? "Walk-in job" : "Appointment"} saved</h3><p>{String(saved.reference)} · {contact.first_name} {contact.last_name}</p></div></div>
    <p className={styles.paymentIntro}>Next, collect payment or finish and collect it later. Saving the booking does not charge the customer.</p>
    <JobPayments embedded compact booking={{ ...saved, collected_cents: 0, square_environment: business.square_environment }} />
    <div className={styles.doneRow}><button className="button" onClick={onComplete}>Done — return to bookings</button></div>
  </div>;
  return <form ref={formRef} className={`sales-booking ${styles.form}`} onSubmit={submit} noValidate>
    {progress}
    <div className={styles.modeRow}><div className={styles.mode} role="group" aria-label="Booking source">
      <button type="button" disabled={busy} aria-pressed={channel === "walk-in"} onClick={() => { setChannel("walk-in"); setDate(dateToday()); }}>Walk-in</button>
      <button type="button" disabled={busy} aria-pressed={channel === "phone"} onClick={() => setChannel("phone")}>Phone booking</button>
    </div><p>{walkIn ? "Customer is here. Add the work, then take payment." : "Reserve a visit for today or another date, then collect a deposit or payment."}</p></div>
    <fieldset className={styles.inputFields} disabled={busy} aria-label="Booking details"><div ref={panelRef} tabIndex={-1} className={styles.detailsGrid}>
      {error && <p className={`error-message ${styles.error}`} role="alert">{error}</p>}
      {selectionError && selectionError !== error && <p className={`error-message ${styles.error}`} role="alert">{selectionError}</p>}
      <section className={styles.section} aria-labelledby="sale-customer-title">
        <div className={styles.sectionHeading}><h3 id="sale-customer-title">Customer &amp; vehicle</h3><span>1</span></div>
        <label className="field"><span>Find a returning customer</span><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, phone or email" /></label>
        {matches.length > 0 && <div className={styles.customerResults}>{matches.map(c => <button type="button" key={c.id} onClick={() => void chooseCustomer(c)}><strong>{c.first_name} {c.last_name}</strong><small>{c.phone} · {c.email}</small></button>)}</div>}
        <div className={styles.fieldGrid}>{([['first_name','First name'],['last_name','Last name'],['phone','Phone'],['email','Email']] as const).map(([key,label]) => <label className="field" key={key}><span>{label}</span><input name={key} maxLength={key === "email" ? 180 : key === "phone" ? 25 : 80} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"} autoComplete={key === "first_name" ? "given-name" : key === "last_name" ? "family-name" : key === "phone" ? "tel" : "email"} value={contact[key]} required onChange={e => setContact({ ...contact, [key]: e.target.value })} /></label>)}</div>
        <h4 className={styles.subheading}>Vehicle</h4>
        {vehicles.length > 0 && <label className="field"><span>{vehicles.length === 1 ? "Saved vehicle selected" : "Choose a saved vehicle"}</span><select value={savedVehicle} onChange={e => { const v = vehicles.find(v => v.id === e.target.value); if (v) applyVehicle(v); else { setSavedVehicle(""); setVehicle({ year: new Date().getFullYear(), make: "", model: "", vehicle_type: "Sedan" }); } }}><option value="">Enter a new vehicle</option>{vehicles.map(v => <option value={v.id} key={v.id}>{v.year} {v.make} {v.model}</option>)}</select></label>}
        <div className={styles.fieldGrid}><label className="field"><span>Year</span><input name="year" type="number" min={1900} max={new Date().getFullYear()+2} required value={vehicle.year} onChange={e => { setSavedVehicle(""); setVehicle({ ...vehicle, year: Number(e.target.value) }); }} /></label><label className="field"><span>Vehicle size</span><select name="vehicle_type" value={vehicle.vehicle_type} onChange={e => { setSavedVehicle(""); setVehicle({ ...vehicle, vehicle_type: e.target.value }); }}>{["Sedan","SUV","Truck"].map(v => <option key={v}>{v}</option>)}</select></label>{([['make','Make'],['model','Model']] as const).map(([key,label]) => <label className="field" key={key}><span>{label}</span><input name={key} maxLength={80} value={vehicle[key]} required onChange={e => { setSavedVehicle(""); setVehicle({ ...vehicle, [key]: e.target.value }); }} /></label>)}</div>
      </section>
      <section className={styles.section} aria-labelledby="sale-services-title">
        <div className={styles.sectionHeading}><h3 id="sale-services-title">Services &amp; price</h3><span>2</span></div>
        <div className={styles.servicePicker}><label className="field"><span>Choose a service</span><select name="service_picker" value={serviceToAdd} onChange={e => setServiceToAdd(e.target.value)}><option value="">Select a service…</option>{services.map(service => <option key={service.id} value={service.id} disabled={choices.some(choice => choice.service_id === service.id)}>{service.name}{choices.some(choice => choice.service_id === service.id) ? " · Added" : service.pricing_mode === "quote" ? " · By quote" : ` · ${money(service.price_cents)}`}</option>)}</select></label><button type="button" disabled={busy || !serviceToAdd} onClick={() => addService(serviceToAdd)}>Add service</button></div>
        <button className={styles.customToggle} type="button" aria-expanded={customOpen} aria-controls="custom-job-fields" onClick={() => setCustomOpen(!customOpen)}>Custom job <span aria-hidden="true">{customOpen ? "−" : "+"}</span></button>
        {customOpen && <fieldset id="custom-job-fields" className={styles.customFields}><legend>Agreed work, such as a $25 hand wash</legend><label className="field"><span>Service category</span><select name="custom_category" value={customCategory} onChange={e => setCustomCategory(e.target.value)}><option value="">Choose a category…</option>{services.map(service => <option key={service.id} value={service.id} disabled={choices.some(choice => choice.service_id === service.id)}>{service.name}{choices.some(choice => choice.service_id === service.id) ? " · Already added" : ""}</option>)}</select></label><label className="field"><span>Job name</span><input name="custom_name" maxLength={160} value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Hand wash" /></label><label className="field"><span>Agreed price ($)</span><input name="custom_price" type="number" inputMode="decimal" min="0" max="100000" step="0.01" value={customPrice} onChange={e => setCustomPrice(e.target.value)} placeholder="25.00" /></label><p>The job name is what appears on the booking. Choose the category that matches the work for service reporting and pay rules.</p><button type="button" disabled={busy} onClick={addCustomJob}>Add custom job</button></fieldset>}
        {!choices.length && <div className={styles.emptyServices}><ServiceSymbol slug="detail"/><p>Add the service the customer wants, or create a custom job with an agreed price.</p></div>}
        <div className={styles.selectedServices}>{choices.map(choice => {
          const service = services.find(service => service.id === choice.service_id)!;
          const item = selection?.items.find(item => item.service.id === service.id);
          const isCustom = customIds.includes(service.id);
          return <article className={styles.serviceCard} key={service.id}>
            <div className={styles.serviceCardHeading}><span className={styles.serviceSymbol}><ServiceSymbol slug={service.slug}/></span><div><h4>{names[service.id]?.trim() || service.name}</h4><p>{isCustom ? `Custom job · ${service.name}` : `${service.duration_minutes / 60}h estimated`}</p></div><button type="button" aria-label={`Remove ${names[service.id]?.trim() || service.name}`} onClick={() => removeService(service.id)}>Remove</button></div>
            {servicePackages(service.slug).length > 0 && <label className="field"><span>Package</span><select value={choice.service_package} onChange={e => changeChoice(service.id, { service_package: e.target.value })}>{servicePackages(service.slug).map(p => <option value={p.id} key={p.id}>{p.name} · {p.priceCents === null ? "By quote" : money(p.priceCents)}</option>)}</select></label>}
            <div className={styles.fieldGrid}><label className="field"><span>{isCustom ? "Job name" : "Job name (optional)"}</span><input name={`name_${service.id}`} value={names[service.id] || ""} minLength={2} maxLength={160} required={isCustom} placeholder={service.name} onChange={e => setNames(current => ({ ...current, [service.id]: e.target.value }))} /></label><label className="field"><span>Agreed service price ($)</span><input name={`price_${service.id}`} type="number" inputMode="decimal" min="0" max="100000" step="0.01" required value={prices[service.id] ?? dollars(item?.baseCents)} placeholder="Enter agreed price" onChange={e => setPrices(current => ({ ...current, [service.id]: e.target.value }))} /></label></div>
            {bookingAddOns(service.slug).length > 0 && <details className={styles.upgrades}><summary>Upgrades {choice.addons?.length ? `· ${choice.addons.length} selected` : "(optional)"}</summary>{bookingAddOns(service.slug).map(addon => { const selected = choice.addons?.includes(addon.id) || false, key = `${service.id}:${addon.id}`; return <div key={addon.id}><label className={styles.addon}><input type="checkbox" checked={selected} onChange={e => changeChoice(service.id, { addons: e.target.checked ? [...(choice.addons || []), addon.id] : choice.addons?.filter(id => id !== addon.id) })} /><span>{addon.name}</span><small>{addon.priceCents === null ? "By quote" : money(addon.priceCents)}</small></label>{selected && <label className="field"><span>{addon.name} price ($)</span><input name={`price_${key}`} type="number" inputMode="decimal" min="0" max="100000" step="0.01" required value={prices[key] ?? dollars(addon.priceCents)} placeholder="Enter agreed price" onChange={e => setPrices(current => ({ ...current, [key]: e.target.value }))} /></label>}</div>; })}</details>}
          </article>;
        })}</div>
      </section>
      <section className={styles.section} aria-labelledby="sale-time-title">
        <div className={styles.sectionHeading}><h3 id="sale-time-title">{walkIn ? "Today's visit" : "Visit date & time"}</h3><span>3</span></div>
        <div className={styles.fieldGrid}><label className="field"><span>Date</span><input name="date" type="date" min={dateToday()} max={walkIn ? dateToday() : undefined} value={date} disabled={walkIn} required onChange={e => setDate(e.target.value)} /></label><label className="field"><span>Reserved time (minutes)</span><input name="duration" type="number" min="30" max="720" step="1" value={duration} placeholder={String(selection?.durationMinutes || 30)} onChange={e => setDuration(e.target.value)} /></label><label className={`field ${styles.fullWidth}`}><span>Start time (Chicago)</span><select name="start" value={start} required disabled={loadingSlots || !choices.length || !validDuration} onChange={e => setStart(Number(e.target.value))}><option value={-1}>{loadingSlots ? "Checking schedule…" : "Choose a time"}</option>{slots.filter(slot => slot.available).map(slot => <option value={slot.minute} key={slot.minute}>{timeLabel(slot.minute)}</option>)}</select></label></div>
        {choices.length > 0 && !validDuration && <p className="error-message">Reserve between 30 and 720 minutes for this job.</p>}
        {choices.length > 0 && validDuration && !loadingSlots && !slots.some(slot => slot.available) && <p role="status">No available times. Review the reserved duration{walkIn ? "." : " or choose another date."}</p>}
        {walkIn && <p className={styles.smallNote}>The next available time is selected automatically. You can also choose an earlier time today for a job already in progress.</p>}
        <details className={styles.extra}><summary>Notes &amp; lead source</summary><label className="field"><span>Customer / access notes</span><textarea value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} /></label>
          {!lead && <label className="field"><span>Marketing source</span><select value={stream} onChange={e => setStream(e.target.value)}><option value="Unassigned">Organic / direct / unassigned</option><option value="Business Google · 10%">Business Google</option><option value="Business Meta · 10%">Business Meta</option><option value="Dima Google · 25%">Partner Google</option></select></label>}
        </details>
      </section>
      <section className={`${styles.section} ${styles.summary}`} aria-labelledby="sale-total-title">
        <div className={styles.sectionHeading}><h3 id="sale-total-title">Total &amp; payment</h3><span>4</span></div>
        <dl className={styles.totals}><div><dt>Services &amp; upgrades</dt><dd>{allPriced ? money(subtotal) : choices.length ? "Enter agreed prices" : "Choose services"}</dd></div>{discountCents !== null && discountCents > 0 && <div><dt>Discount</dt><dd>−{money(discountCents)}</dd></div>}</dl>
        <details className={styles.extra}><summary>{discountCents ? "Edit discount" : "Add a discount"}</summary><label className="field"><span>Discount on services ($)</span><input name="discount" type="number" inputMode="decimal" min="0" max={subtotal / 100} step="0.01" required value={discount} onChange={e => setDiscount(e.target.value)} /></label></details>
        {!validDiscount && <p className="error-message">The discount must be between $0 and the subtotal.</p>}
        <dl className={`${styles.totals} ${styles.grandTotal}`}><div><dt>Agreed service total</dt><dd><strong>{totalLabel}</strong></dd></div></dl>
        <p className={styles.smallNote}>Collect by Square or cash on the next screen. Tips stay separate from the service price.</p>
        <details className={styles.extra}><summary>Deposits &amp; employee pay</summary><p>Employee percentage pay uses the full service price after discounts. A deposit reduces the customer’s balance, not the employee’s commission.</p><p>{walkIn ? "No deposit is required for a walk-in. Collect the service balance after saving." : "Choose the deposit or full balance when collecting payment."}</p></details>
        <label className={styles.agreement}><input name="agreed" type="checkbox" required checked={agreed} onChange={e => setAgreed(e.target.checked)} /><span>Customer agrees to the prices, <a className="text-link" href="/service-rules" target="_blank" rel="noopener noreferrer">service terms</a>, <a className="text-link" href="/privacy-notice" target="_blank" rel="noopener noreferrer">privacy notice</a> and appointment texts. No marketing signup.</span></label>
      </section>
    </div></fieldset>
    <div className={styles.saveBar}><div><span>{choices.length ? `${choices.length} service${choices.length === 1 ? "" : "s"}` : "New booking"}</span><strong>{totalLabel}</strong></div><button className="button" disabled={busy || loadingSlots}>{busy ? "Saving…" : "Save & continue to payment"}</button></div>
  </form>;
}
