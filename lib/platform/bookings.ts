import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction, type Query } from "./db";
import { settings } from "./settings";
import { hash, AppError, receiptToken } from "./auth";
import { saveAttribution, attributionSchema } from "./attribution";
import { enqueue, enqueueBooking } from "./outbox";
import { metaEvent } from "../integrations/providers";
import { siteUrl } from "./settings";
import {
  dateToday,
  priceFor,
  type Booking,
  type Service,
  type BusinessSettings,
} from "./types";

export const bookingInput = z.object({
  request_key: z.uuid(),
  service_id: z.uuid(),
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
    medium: "",
    campaign: "",
    term: "",
    content: "",
    gclid: "",
    fbclid: "",
    landing_page: "",
    referrer: "",
  }),
  device: z.string().max(100).default(""),
  lead_id: z.uuid().optional(),
});
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
async function free(
  q: Query,
  date: string,
  start: number,
  duration: number,
  buffer: number,
  exclude?: string,
) {
  const end = start + duration + buffer;
  const overlap = (
    await q(
      `SELECT id FROM wl.bookings WHERE booking_date=$1 AND status NOT IN ('cancelled','no_show')
 AND start_minute<$3 AND start_minute+duration_minutes+buffer_minutes>$2 AND ($4::uuid IS NULL OR id<>$4)
 UNION ALL SELECT id FROM wl.blocks WHERE booking_date=$1 AND start_minute<$3 AND end_minute>$2`,
      [date, start, end, exclude || null],
    )
  ).rows;
  return overlap.length === 0;
}
async function validateSlot(
  q: Query,
  date: string,
  start: number,
  service: Service,
  s: BusinessSettings,
  exclude?: string,
) {
  if (!validDate(date)) throw new AppError("Choose a valid date.");
  if (
    !s.days.includes(new Date(date + "T12:00:00Z").getUTCDay()) ||
    start < minute(s.open_time) ||
    start + service.duration_minutes > minute(s.close_time) ||
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
  serviceId: string,
  exclude?: string,
) {
  if (!validDate(date)) throw new AppError("Choose a valid date.");
  const s = await settings(),
    service = (
      await query<Service>(
        "SELECT * FROM wl.services WHERE id=$1 AND active=true",
        [serviceId],
      )
    )[0];
  if (!service) throw new AppError("This service is unavailable.", 404);
  const slots: Array<{ minute: number; available: boolean }> = [];
  if (!s.days.includes(new Date(date + "T12:00:00Z").getUTCDay())) return slots;
  const q: Query = async (sql, p) => ({ rows: await query(sql, p) });
  for (
    let start = Math.ceil(minute(s.open_time) / 30) * 30;
    start + service.duration_minutes <= minute(s.close_time);
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
    s = await settings();
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
    const service = (
      await q<Service>(
        "SELECT * FROM wl.services WHERE id=$1 AND active=true FOR SHARE",
        [input.service_id],
      )
    ).rows[0];
    if (!service) throw new AppError("This service is no longer available.");
    await validateSlot(q, input.date, input.start_minute, service, s);
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
    const price = priceFor(service, input.vehicle_type),
      deposit =
        price == null ? 0 : Math.round((price * s.deposit_percent) / 100);
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
          service.name,
          JSON.stringify(service),
          input.date,
          input.start_minute,
          service.duration_minutes,
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
    const leadId = input.lead_id || randomUUID();
    if (input.lead_id)
      await q(
        "UPDATE wl.leads SET customer_id=$1,status='booked',updated_at=now() WHERE id=$2",
        [customerId, leadId],
      );
    else {
      await q(
        "INSERT INTO wl.leads(id,name,email,phone,status,customer_id,attribution_id) VALUES($1,$2,$3,$4,'booked',$5,$6)",
        [
          leadId,
          input.first_name + " " + input.last_name,
          input.email,
          input.phone,
          customerId,
          attributionId,
        ],
      );
      await q("UPDATE wl.bookings SET lead_id=$1 WHERE id=$2", [leadId, id]);
    }
    await q(
      "INSERT INTO wl.timeline(id,customer_id,booking_id,lead_id,type,body) VALUES($1,$2,$3,$4,'booking_created',$5)",
      [
        randomUUID(),
        customerId,
        id,
        leadId,
        service.name + " reserved for " + input.date,
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
    await q(
      "INSERT INTO wl.events(id,name,session_id,customer_id,booking_id,attribution_id) VALUES($1,'lead_created',$2,$3,$4,$5)",
      ["lead:" + leadId, input.session_id, customerId, id, attributionId],
    );
    await enqueueBooking(q, booking, s, token);
    await enqueue(q, {
      key: "meta:booking:" + id,
      channel: "meta",
      recipient: s.meta_dataset_id || s.meta_pixel_id,
      body: JSON.stringify(
        metaEvent("Lead", "booking:" + id, {
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
 v.year||' '||v.make||' '||v.model vehicle,COALESCE((SELECT SUM(amount_cents-refunded_cents) FROM wl.payments WHERE booking_id=b.id AND status IN ('paid','partially_refunded','refunded')),0)::int paid_cents
 FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id JOIN wl.vehicles v ON v.id=b.vehicle_id WHERE b.id=$1`,
      [id],
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
    if (staff && b.assigned_to !== actor)
      throw new AppError(
        "You can update only your assigned appointments.",
        403,
      );
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
    if (
      data.assigned_to &&
      !(
        await q("SELECT id FROM wl.users WHERE id=$1 AND active=true", [
          data.assigned_to,
        ])
      ).rows.length
    )
      throw new AppError("Choose an active staff member.");
    const next = (
      await q<Booking>(
        `UPDATE wl.bookings SET status=$1,booking_date=$2,start_minute=$3,notes=$4,internal_notes=$5,assigned_to=$6,price_cents=$7,updated_at=now() WHERE id=$8 RETURNING *`,
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
    if (status === "completed" && b.status !== status) {
      await enqueueBooking(q, next, s, token, "follow_up");
      await enqueueBooking(q, next, s, token, "review_request");
    }
    if (b.lead_id && status === "completed")
      await q("UPDATE wl.leads SET status='won' WHERE id=$1", [b.lead_id]);
    return next;
  });
}
