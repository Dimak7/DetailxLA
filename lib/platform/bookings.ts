import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction, type Query } from "./db";
import {
  effectiveDepositPercent,
  paymentProvider,
  settings,
  siteUrl,
} from "./settings";
import { hash, AppError, receiptToken } from "./auth";
import { saveAttribution, attributionSchema } from "./attribution";
import { enqueue, enqueueBooking } from "./outbox";
import { metaEvent } from "../integrations/providers";
import { squareEnvironment } from "../integrations/square-reporting";
import { businessHoursForDay } from "./business-hours";
import { bookingCartSelection } from "../booking-options";
import {
  dateToday,
  type Booking,
  type Service,
  type BusinessSettings,
} from "./types";

const serviceChoiceInput = z.object({
  service_id: z.uuid(),
  service_package: z.string().max(80).default(""),
  addons: z.array(z.string().max(80)).max(12).default([]),
});
export const bookingInput = z.object({
  request_key: z.uuid(),
  service_id: z.uuid().optional(),
  service_package: z.string().max(80).default(""),
  addons: z.array(z.string().max(80)).max(12).default([]),
  services: z.array(serviceChoiceInput).min(1).max(12).optional(),
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z
    .email()
    .max(180)
    .transform((v) => v.toLowerCase().trim()),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d ()-]{10,25}$/)
    .transform((v) => {
      const p = v.replace(/[^\d+]/g, "");
      return p.length === 10 ? "+1" + p : p;
    }),
  make: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(80),
  year: z
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 2),
  vehicle_type: z.enum(["Sedan", "SUV", "Truck"]),
  condition: z.string().max(500).default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_minute: z.number().int().min(0).max(1439),
  notes: z.string().max(2000).default(""),
  location: z.string().max(240).default(""),
  marketing_email: z.boolean().default(false),
  marketing_sms: z.boolean().default(false),
  terms: z.literal(true),
  session_id: z.uuid(),
  attribution: attributionSchema.default({
    source: "",
    lead_stream: "",
    medium: "",
    campaign: "",
    term: "",
    content: "",
    gclid: "",
    gbraid: "",
    wbraid: "",
    fbclid: "",
    landing_page: "",
    referrer: "",
  }),
  device: z.string().max(100).default(""),
  lead_id: z.uuid().optional(),
}).superRefine((input, context) => {
  if (!input.services && !input.service_id)
    context.addIssue({ code: "custom", message: "Choose at least one service.", path: ["services"] });
  if (input.services && new Set(input.services.map((item) => item.service_id)).size !== input.services.length)
    context.addIssue({ code: "custom", message: "Choose each service only once.", path: ["services"] });
});
export function bookingDepositCents(
  service: Service,
  price: number | null,
  business: BusinessSettings,
  provider: "square" | "stripe" | null,
) {
  const requiresQuote =
    service.pricing_mode === "quote" || service.slug === "ceramic-coating";
  if (price == null || requiresQuote || !provider) return 0;
  const percent =
    provider === "square"
      ? effectiveDepositPercent(business)
      : business.deposit_percent;
  return percent > 0 ? Math.round((price * percent) / 100) : 0;
}
export function validDate(value: string) {
  const date = new Date(value + "T12:00:00Z");
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}
const minute = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export function capacityAvailable(start:number,end:number,intervals:Array<{start:number;end:number}>,capacity:number) {
  const events=intervals.filter(item=>item.start<end&&item.end>start).flatMap(item=>[{minute:Math.max(start,item.start),delta:1},{minute:Math.min(end,item.end),delta:-1}]).filter(e=>e.minute>=start&&e.minute<=end).sort((a,b)=>a.minute-b.minute||a.delta-b.delta);
  let occupied=0;
  for(const event of events){occupied+=event.delta;if(occupied>=capacity)return false;}
  return true;
}
async function free(q:Query,date:string,start:number,duration:number,buffer:number,capacity:number,exclude?:string) {
  const end=start+duration+buffer;
  const blocks=await q("SELECT id FROM wl.blocks WHERE booking_date=$1 AND start_minute<$3 AND end_minute>$2",[date,start,end]);
  if(blocks.rows.length)return false;
  const bookings=await q<{start:number;end:number}>("SELECT start_minute AS start,start_minute+duration_minutes+buffer_minutes AS end FROM wl.bookings WHERE booking_date=$1 AND status NOT IN ('cancelled','no_show') AND start_minute<$3 AND start_minute+duration_minutes+buffer_minutes>$2 AND ($4::uuid IS NULL OR id<>$4)",[date,start,end,exclude||null]);
  return capacityAvailable(start,end,bookings.rows,capacity);
}
async function validateSlot(
  q: Query,
  date: string,
  start: number,
  service: Pick<Service, "duration_minutes">,
  s: BusinessSettings,
  exclude?: string,
) {
  if (!validDate(date)) throw new AppError("Choose a valid date.");
  const hours = businessHoursForDay(s, new Date(date + "T12:00:00Z").getUTCDay());
  if (hours && service.duration_minutes > minute(hours.close_time) - minute(hours.open_time))
    throw new AppError("These services need more time than this day's opening hours. Choose another day or contact the studio to arrange separate appointments.");
  if (
    !hours ||
    start < minute(hours.open_time) ||
    start + service.duration_minutes > minute(hours.close_time) ||
    start % 30
  )
    throw new AppError("Choose an available appointment time.");
  const future = (
    await q<{ ok: boolean }>(
      `SELECT (($1::date+$2*interval '1 minute') AT TIME ZONE 'America/Chicago')>now() ok`,
      [date, start],
    )
  ).rows[0].ok;
  if (!future || date > dateToday(new Date(Date.now() + 365 * 86400000)))
    throw new AppError("Choose an appointment within the next year.");
  if (
    !(await free(
      q,
      date,
      start,
      service.duration_minutes,
      s.buffer_minutes,
      s.booking_capacity,
      exclude,
    ))
  )
    throw new AppError(
      "That time is no longer available. Please choose another.",
      409,
    );
}
export async function availability(
  date: string,
  serviceId: string | string[],
  exclude?: string,
) {
  if (!validDate(date)) throw new AppError("Choose a valid date.");
  const serviceIds = z.array(z.uuid()).min(1).max(12).parse(typeof serviceId === "string" ? [serviceId] : serviceId);
  if (new Set(serviceIds).size !== serviceIds.length) throw new AppError("Choose each service only once.");
  const s = await settings();
  const services = await query<Service>("SELECT * FROM wl.services WHERE id=ANY($1::uuid[]) AND active=true", [serviceIds]);
  if (services.length !== serviceIds.length) throw new AppError("One of your selected services is unavailable.", 404);
  const service = { duration_minutes: services.reduce((sum, item) => sum + item.duration_minutes, 0) };
  const slots: Array<{ minute: number; available: boolean }> = [];
  const hours = businessHoursForDay(s, new Date(date + "T12:00:00Z").getUTCDay());
  if (!hours) return slots;
  if (service.duration_minutes > minute(hours.close_time) - minute(hours.open_time))
    throw new AppError("These services need more time than this day's opening hours. Choose another day or contact the studio to arrange separate appointments.");
  const q: Query = async (sql, p) => ({ rows: await query(sql, p) });
  for (
    let start = Math.ceil(minute(hours.open_time) / 30) * 30;
    start + service.duration_minutes <= minute(hours.close_time);
    start += 30
  ) {
    try {
      await validateSlot(q, date, start, service, s, exclude);
      slots.push({ minute: start, available: true });
    } catch (e) {
      if (e instanceof AppError)
        slots.push({ minute: start, available: false });
      else throw e;
    }
  }
  return slots;
}
export async function createBooking(value: unknown, admin = false) {
  const input = bookingInput.parse(value);
  if (!admin && input.lead_id) throw new AppError("Invalid booking request.");
  const fingerprint = hash(JSON.stringify(input)),
    s = await settings(),
    provider = admin ? null : await paymentProvider();
  const id = randomUUID(),
    token = await receiptToken(id);
  const result = await transaction(async (q) => {
    await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
    const previous = (
      await q<Booking & { request_hash: string }>(
        "SELECT * FROM wl.bookings WHERE request_key=$1",
        [input.request_key],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_hash !== fingerprint)
        throw new AppError("This request has already been used.", 409);
      return previous;
    }
    const choices = input.services || [{ service_id: input.service_id!, service_package: input.service_package, addons: input.addons }];
    const services = (
      await q<Service>(
        "SELECT * FROM wl.services WHERE id=ANY($1::uuid[]) AND active=true FOR SHARE",
        [choices.map((choice) => choice.service_id)],
      )
    ).rows;
    let selection: ReturnType<typeof bookingCartSelection>;
    try {
      selection = bookingCartSelection(services, input.vehicle_type, choices);
    } catch (error) {
      throw new AppError(error instanceof Error ? error.message : "Choose valid booking options.");
    }
    const service = selection.items[0].service;
    await validateSlot(q, input.date, input.start_minute, { duration_minutes: selection.durationMinutes }, s);
    if (
      (s.appointment_mode === "mobile" || s.appointment_mode === "both") &&
      input.location.length < 5
    )
      throw new AppError("Please provide your service location.");
    const linkedLead = input.lead_id
      ? (
          await q<{ attribution_id: string | null }>(
            "SELECT attribution_id FROM wl.leads WHERE id=$1",
            [input.lead_id],
          )
        ).rows[0]
      : null;
    if (input.lead_id && !linkedLead)
      throw new AppError("Lead not found.", 404);
    const attributionId =
      linkedLead?.attribution_id ||
      (await saveAttribution(q, input.session_id, input.attribution));
    const old = (
      await q<{ id: string }>("SELECT id FROM wl.customers WHERE email=$1", [
        input.email,
      ])
    ).rows[0];
    const customerId = old?.id || randomUUID();
    if (old)
      await q(
        "UPDATE wl.customers SET first_name=$1,last_name=$2,phone=$3,updated_at=now() WHERE id=$4",
        [input.first_name, input.last_name, input.phone, customerId],
      );
    else
      await q(
        "INSERT INTO wl.customers(id,first_name,last_name,email,phone,attribution_id) VALUES($1,$2,$3,$4,$5,$6)",
        [
          customerId,
          input.first_name,
          input.last_name,
          input.email,
          input.phone,
          attributionId,
        ],
      );
    for (const channel of ["email", "sms"] as const)
      if (
        input[("marketing_" + channel) as "marketing_email" | "marketing_sms"]
      ) {
        await q(
          "INSERT INTO wl.consent_events(id,customer_id,channel,consent,wording,source) VALUES($1,$2,$3,true,$4,'booking form')",
          [
            randomUUID(),
            customerId,
            channel,
            channel === "sms"
              ? "I agree to receive recurring promotional texts. Consent is optional and not a condition of purchase. Message and data rates may apply. Reply STOP to opt out."
              : "I would like offers and care tips by email. I can unsubscribe at any time.",
          ],
        );
        await q(
          channel === "sms"
            ? "UPDATE wl.customers SET marketing_sms=true WHERE id=$1 AND sms_opted_out=false"
            : "UPDATE wl.customers SET marketing_email=true WHERE id=$1",
          [customerId],
        );
      }
    const vid = randomUUID();
    const vehicle = (
      await q<{ id: string }>(
        `INSERT INTO wl.vehicles(id,customer_id,make,model,year,type,condition) VALUES($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT(customer_id,make,model,year,type) DO UPDATE SET condition=$7 RETURNING id`,
        [
          vid,
          customerId,
          input.make,
          input.model,
          input.year,
          input.vehicle_type,
          input.condition,
        ],
      )
    ).rows[0];
    const price = selection.totalCents,
      deposit = selection.requiresQuote ? 0 : bookingDepositCents(service, price, s, provider);
    const itemName = (item: typeof selection.items[number]) => item.selectedPackage
      ? `${item.service.name} · ${item.selectedPackage.name}`
      : item.service.name;
    const serviceName = selection.items.map(itemName).join(" + ");
    const selectedServices = selection.items.map((item) => ({
      ...item.service,
      selected_package: item.selectedPackage || null,
      selected_addons: item.selectedAddOns.map((addOn) => ({ ...addOn, line_item_id: randomUUID() })),
      base_cents: item.baseCents,
      total_cents: item.totalCents,
    }));
    const serviceSnapshot = {
      ...selectedServices[0],
      selected_services: selectedServices,
      requires_quote: selection.requiresQuote,
    };
    const booking = (
      await q<Booking>(
        `INSERT INTO wl.bookings(id,request_key,request_hash,reference,customer_id,vehicle_id,service_id,service_name,service_snapshot,booking_date,start_minute,duration_minutes,buffer_minutes,price_cents,deposit_cents,notes,location,attribution_id,lead_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
        [
          id,
          input.request_key,
          fingerprint,
          "WL-" + id.slice(0, 8).toUpperCase(),
          customerId,
          vehicle.id,
          service.id,
          serviceName,
          JSON.stringify(serviceSnapshot),
          input.date,
          input.start_minute,
          selection.durationMinutes,
          s.buffer_minutes,
          price,
          deposit,
          input.notes,
          input.location || s.address,
          attributionId,
          input.lead_id || null,
        ],
      )
    ).rows[0];
    for (const [index, item] of selection.items.entries()) {
      await q(
        "INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents,quote_pending) VALUES($1,$2,$3,'base_service',$4,1,$5,$6)",
        [randomUUID(), id, item.service.id, itemName(item) + (item.baseCents === null && !itemName(item).includes("By Quote") ? " · By quote" : ""), item.baseCents ?? 0, item.baseCents === null],
      );
      for (const addOn of selectedServices[index].selected_addons)
        await q(
          "INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents,quote_pending) VALUES($1,$2,$3,'upsell',$4,1,$5,$6)",
          [addOn.line_item_id, id, item.service.id, addOn.name, addOn.priceCents ?? 0, addOn.priceCents === null],
        );
    }
    const leadId = input.lead_id || null;
    if (leadId) {
      await q("INSERT INTO wl.customer_tags(customer_id,tag_id,created_by) SELECT $1,tag_id,created_by FROM wl.lead_tags WHERE lead_id=$2 ON CONFLICT DO NOTHING",[customerId,leadId]);
      await q(
        "UPDATE wl.leads SET customer_id=$1,status='booked',call_customer=false,updated_at=now() WHERE id=$2",
        [customerId, leadId],
      );
    }
    await q(
      "INSERT INTO wl.timeline(id,customer_id,booking_id,lead_id,type,body) VALUES($1,$2,$3,$4,'booking_created',$5)",
      [
        randomUUID(),
        customerId,
        id,
        leadId,
        serviceName + " reserved for " + input.date,
      ],
    );
    if (!old)
      await q(
        "INSERT INTO wl.timeline(id,customer_id,type,body) VALUES($1,$2,'customer_created','Customer created from booking')",
        [randomUUID(), customerId],
      );
    await q(
      "INSERT INTO wl.events(id,name,session_id,customer_id,booking_id,attribution_id,device,metadata) VALUES($1,'booking_completed',$2,$3,$4,$5,$6,$7::jsonb)",
      [
        "booking:" + id,
        input.session_id,
        customerId,
        id,
        attributionId,
        input.device,
        JSON.stringify({ value_cents: price, currency: "USD" }),
      ],
    );
    await enqueueBooking(q, booking, s, token, "booking_request");
    await enqueue(q, {
      key: "meta:booking:" + id,
      channel: "meta",
      recipient: s.meta_dataset_id || s.meta_pixel_id,
      body: JSON.stringify(
        metaEvent("Schedule", "booking:" + id, {
          email: input.email,
          phone: input.phone,
          value: price,
          url: siteUrl() + "/booking",
        }),
      ),
      customerId,
      bookingId: id,
    });
    return booking;
  });
  return {
    booking: result,
    token: result.id === id ? token : await receiptToken(result.id),
    event_id: "booking:" + result.id,
  };
}
export async function bookingById(id: string) {
  return (
    await query<Booking>(
      `SELECT b.*,c.first_name||' '||c.last_name customer_name,c.email,c.phone,
 v.year||' '||v.make||' '||v.model vehicle,COALESCE((SELECT SUM(amount_cents-refunded_cents) FROM wl.payments WHERE booking_id=b.id AND status IN ('paid','partially_refunded','refunded') AND (provider<>'square' OR metadata->>'square_environment'=$2)),0)::int paid_cents
 FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id JOIN wl.vehicles v ON v.id=b.vehicle_id WHERE b.id=$1`,
      [id, squareEnvironment()],
    )
  )[0];
}
export async function updateBooking(
  id: string,
  data: {
    status?: string;
    date?: string;
    start_minute?: number;
    notes?: string;
    internal_notes?: string;
    assigned_to?: string | null;
    assignment_override?: boolean;
    price_cents?: number | null;
  },
  actor: string,
  staff = false,
) {
  const s = await settings(),
    token = await receiptToken(id);
  return transaction(async (q) => {
    await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
    const b = (
      await q<Booking>("SELECT * FROM wl.bookings WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!b) throw new AppError("Appointment not found.", 404);
    if (staff && b.assigned_to !== actor) {
      const sharedAssignment = (
        await q(
          `SELECT 1 FROM wl.employee_job_assignments assignment
           JOIN wl.employees employee ON employee.id=assignment.employee_id
           WHERE assignment.booking_id=$1 AND employee.user_id=$2 LIMIT 1`,
          [id, actor],
        )
      ).rows.length;
      if (!sharedAssignment)
        throw new AppError(
          "You can update only your assigned appointments.",
          403,
        );
    }
    if (staff && (
      data.price_cents !== undefined || data.assigned_to !== undefined ||
      data.date !== undefined || data.start_minute !== undefined || data.assignment_override ||
      data.internal_notes !== undefined
    ))
      throw new AppError("A manager must change pricing, assignment, schedule or internal notes.", 403);
    if (staff && data.status && data.status !== b.status && (
      ["completed", "cancelled", "no_show"].includes(b.status) ||
      !["in_progress", "completed"].includes(data.status)
    ))
      throw new AppError("Staff can only start or complete their assigned appointments.", 403);
    const status = data.status || b.status,
      date = data.date || b.booking_date,
      start = data.start_minute ?? b.start_minute;
    if (
      ![
        "new",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ].includes(status)
    )
      throw new AppError("Invalid status.");
    const changed = date !== b.booking_date || start !== b.start_minute;
    if (
      changed ||
      (["cancelled", "no_show"].includes(b.status) &&
        !["cancelled", "no_show"].includes(status))
    )
      await validateSlot(
        q,
        date,
        start,
        { ...b.service_snapshot, duration_minutes: b.duration_minutes },
        s,
        b.id,
      );
    const assignedTo = data.assigned_to === undefined ? b.assigned_to : data.assigned_to;
    if (assignedTo && assignedTo !== b.assigned_to) {
      const employee = (await q<{ id: string; name: string }>(
        "SELECT e.id,e.name FROM wl.employees e JOIN wl.users u ON u.id=e.user_id WHERE e.user_id=$1 AND e.active=true AND u.active=true",
        [assignedTo],
      )).rows[0];
      if (!employee) throw new AppError("Choose an active detailer from Employees.");
      const end = start + b.duration_minutes;
      const conflicts = (await q<{ reference: string; start_minute: number; duration_minutes: number }>(
        `SELECT reference,start_minute,duration_minutes FROM wl.bookings
         WHERE assigned_to=$1 AND booking_date=$2 AND id<>$3
           AND status NOT IN ('cancelled','no_show')
           AND start_minute<$5 AND start_minute+duration_minutes>$4
         ORDER BY start_minute LIMIT 1`,
        [assignedTo, date, id, start, end],
      )).rows;
      const dated = (await q<{ status: string; start_minute: number; end_minute: number }>(
        "SELECT status,start_minute,end_minute FROM wl.employee_shifts WHERE employee_id=$1 AND shift_date=$2 ORDER BY updated_at DESC",
        [employee.id, date],
      )).rows;
      const override = dated.find((item) => item.status !== "scheduled");
      const shift = !override && dated.find((item) => item.status === "scheduled" && item.start_minute <= start && item.end_minute >= end);
      const weekday = new Date(date + "T12:00:00Z").getUTCDay();
      const recurring = !dated.length ? (await q<{ available: boolean; start_minute: number; end_minute: number }>(
        "SELECT available,start_minute,end_minute FROM wl.employee_availability WHERE employee_id=$1 AND weekday=$2",
        [employee.id, weekday],
      )).rows[0] : null;
      const recurringCovers = recurring?.available && recurring.start_minute <= start && recurring.end_minute >= end;
      const warnings = [
        ...(conflicts.length ? [`${employee.name} already has ${conflicts[0].reference} at ${conflicts[0].start_minute} minutes.`] : []),
        ...(override ? [`${employee.name} has a ${override.status.toUpperCase()} date override.`] : []),
        ...(!override && !shift && !recurringCovers ? [`${employee.name} is not scheduled for the appointment hours.`] : []),
      ];
      if (warnings.length && !data.assignment_override)
        throw new AppError(`Assignment warning: ${warnings.join(" ")} Review the schedule or select the manager override.`);
      if (warnings.length && data.assignment_override)
        await q(
          "INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,after_data) VALUES($1,$2,'booking',$3,'assignment_override',$4::jsonb)",
          [randomUUID(), actor, id, JSON.stringify({ assigned_to: assignedTo, warnings, date, start })],
        );
    }
    if(data.price_cents!==undefined&&data.price_cents!==b.price_cents&&(await q("SELECT booking_id FROM wl.square_invoices WHERE booking_id=$1",[id])).rows.length)throw new AppError("This job has a Square invoice. Keep its agreed price consistent with Square.");
    if (data.price_cents !== undefined && data.price_cents !== b.price_cents) {
      const lines = (await q<{ id: string; service_id: string | null; kind: string; quantity: number; unit_price_cents: number; quote_pending: boolean }>(
        "SELECT id,service_id,kind,quantity,unit_price_cents,quote_pending FROM wl.booking_line_items WHERE booking_id=$1 ORDER BY created_at,id FOR UPDATE", [id],
      )).rows;
      if (lines.length) {
        if (data.price_cents === null)
          throw new AppError("Enter an agreed service price for this appointment's existing line items.");
        if (lines.some((line) => line.kind === "upsell" && line.quote_pending))
          throw new AppError("Enter an agreed price for each quoted upgrade in Service prices before setting the appointment total.");
        const baseLines = lines.filter((line) => line.kind === "base_service");
        const upsells = lines.filter((line) => line.kind === "upsell")
          .reduce((sum, line) => sum + line.quantity * line.unit_price_cents, 0);
        const discount = Number((await q<{ amount: string }>(
          "SELECT COALESCE(SUM(amount_cents),0)::text amount FROM wl.booking_discounts WHERE booking_id=$1", [id],
        )).rows[0].amount);
        const baseCents = data.price_cents + discount - upsells;
        if (baseCents < 0)
          throw new AppError("This agreed total would make the base service price negative. Adjust the upsells or discounts instead.");
        const unknownLines = baseLines.filter((line) => b.service_snapshot.selected_services?.some((item) => item.id === line.service_id && item.base_cents === null));
        if (unknownLines.length > 1)
          throw new AppError("Enter a price for each quoted service before setting the agreed total.");
        const allocations = new Map<string, number>();
        if (unknownLines.length === 1) {
          const knownTotal = baseLines.filter((line) => line.id !== unknownLines[0].id).reduce((sum, line) => sum + line.quantity * line.unit_price_cents, 0);
          if (baseCents < knownTotal)
            throw new AppError("The agreed total is below the already priced services and upgrades. Adjust those service prices first.");
          for (const line of baseLines) allocations.set(line.id, line.id === unknownLines[0].id ? baseCents - knownTotal : line.quantity * line.unit_price_cents);
        } else if (baseLines.length === 1) {
          allocations.set(baseLines[0].id, baseCents);
        } else if (baseLines.length > 1) {
          const previousTotal = baseLines.reduce((sum, line) => sum + line.quantity * line.unit_price_cents, 0);
          if (previousTotal === 0 && baseCents > 0)
            throw new AppError("Enter a price for each service before setting the agreed total.");
          let allocated = 0;
          for (const [index, line] of baseLines.entries()) {
            const amount = index === baseLines.length - 1 ? baseCents - allocated : previousTotal ? Math.floor(baseCents * line.quantity * line.unit_price_cents / previousTotal) : 0;
            allocations.set(line.id, amount);
            allocated += amount;
          }
        }
        for (const [lineId, amount] of allocations)
          await q("UPDATE wl.booking_line_items SET quantity=1,unit_price_cents=$2,quote_pending=false,name=regexp_replace(name,' · By quote$','','i') WHERE id=$1", [lineId, amount]);
        if (!baseLines.length)
          await q("INSERT INTO wl.booking_line_items(id,booking_id,service_id,kind,name,quantity,unit_price_cents,created_by) VALUES($1,$2,$3,'base_service',$4,1,$5,$6)", [randomUUID(), id, b.service_id, b.service_name, baseCents, actor]);
        if (b.service_snapshot.selected_services) {
          const selected = b.service_snapshot.selected_services.map((service) => {
            const serviceLines = baseLines.filter((line) => line.service_id === service.id);
            if (!serviceLines.length) return service;
            const base = serviceLines.reduce((sum, line) => sum + (allocations.get(line.id) ?? line.quantity * line.unit_price_cents), 0);
            const upgrades = lines.filter((line) => line.kind === "upsell" && line.service_id === service.id).reduce((sum, line) => sum + line.quantity * line.unit_price_cents, 0);
            return { ...service, base_cents: base, total_cents: base + upgrades };
          });
          await q("UPDATE wl.bookings SET service_snapshot=$2::jsonb WHERE id=$1", [id, JSON.stringify({ ...b.service_snapshot, ...selected[0], selected_services: selected })]);
        }
        await q("INSERT INTO wl.audit_logs(id,actor_id,entity_type,entity_id,action,before_data,after_data) VALUES($1,$2,'booking',$3,'agreed_price_updated',$4::jsonb,$5::jsonb)",
          [randomUUID(), actor, id, JSON.stringify({ price_cents: b.price_cents, base_line_items: baseLines }), JSON.stringify({ price_cents: data.price_cents, base_service_cents: baseCents, upsell_cents: upsells, discount_cents: discount })]);
      }
    }
    if (status === "completed" && b.status !== "completed") {
      const finalPrice = data.price_cents === undefined ? b.price_cents : data.price_cents;
      const pendingQuote = (await q("SELECT id FROM wl.booking_line_items WHERE booking_id=$1 AND quote_pending LIMIT 1", [id])).rows.length > 0;
      if (finalPrice === null || pendingQuote)
        throw new AppError("A manager must agree the final price and resolve quoted items before this appointment can be completed.");
    }
    const next = (
      await q<Booking>(
        `UPDATE wl.bookings SET status=$1,booking_date=$2,start_minute=$3,notes=$4,internal_notes=$5,assigned_to=$6,price_cents=$7,completed_at=CASE WHEN $1='completed' AND completed_at IS NULL THEN now() WHEN $1<>'completed' THEN NULL ELSE completed_at END,updated_at=now() WHERE id=$8 RETURNING *`,
        [
          status,
          date,
          start,
          data.notes ?? b.notes,
          data.internal_notes ?? b.internal_notes,
          data.assigned_to === undefined ? b.assigned_to : data.assigned_to,
          data.price_cents === undefined ? b.price_cents : data.price_cents,
          id,
        ],
      )
    ).rows[0];
    await q(
      "INSERT INTO wl.timeline(id,customer_id,booking_id,type,body,actor_id) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        b.customer_id,
        id,
        "booking_" + status,
        changed
          ? "Appointment rescheduled"
          : data.internal_notes
            ? "Internal note updated"
            : "Appointment updated",
        actor,
      ],
    );
    if (changed || status === "cancelled")
      await q(
        "UPDATE wl.messages SET status='cancelled' WHERE booking_id=$1 AND purpose='reminder' AND status IN ('queued','failed','skipped')",
        [id],
      );
    if (changed)
      await enqueueBooking(
        q,
        next,
        s,
        token,
        "booking_rescheduled",
        randomUUID(),
      );
    if (status === "cancelled" && b.status !== status)
      await enqueueBooking(
        q,
        next,
        s,
        token,
        "booking_cancelled",
        randomUUID(),
      );
    if (status === "confirmed" && b.status !== status)
      await enqueueBooking(
        q,
        next,
        s,
        token,
        "booking_confirmation",
        randomUUID(),
      );
    if (status === "completed" && b.status !== status) {
      await enqueueBooking(q, next, s, token, "follow_up");
      await enqueueBooking(q, next, s, token, "review_request");
    }
    if (b.lead_id && status === "completed")
      await q("UPDATE wl.leads SET status='won',call_customer=false WHERE id=$1", [b.lead_id]);
    return next;
  });
}
