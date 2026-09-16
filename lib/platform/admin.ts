import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { access, AppError, addUser, passwordHash, receiptToken } from "./auth";
import { settings, saveSettings, integrationStatus, siteUrl } from "./settings";
import {
  createBooking,
  updateBooking,
  validDate,
  bookingById,
} from "./bookings";
import { report } from "./reporting";
import { audiences, queueCampaign, unsubscribeToken } from "./campaigns";
import { enqueue, enqueueBooking } from "./outbox";
import { createCheckout } from "../integrations/payments";
import { saveAttribution } from "./attribution";
import type { Session, Service, Customer, Row } from "./types";
const uuid = z.uuid();
const txt = z.string().trim().max(2000);
const asset = z
  .string()
  .max(500)
  .refine(
    (v) =>
      !v || /^\/(?:api\/media\/[a-f0-9-]+|brand\/[a-zA-Z0-9/_.-]+)$/.test(v),
    "Upload an image first.",
  );
export const serviceSchema = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(120),
  category: z.string().min(2).max(100),
  description: txt,
  includes: z.array(z.string().max(200)).max(30),
  price_cents: z.number().int().min(0).max(10000000),
  suv_extra_cents: z.number().int().min(0).max(1000000),
  truck_extra_cents: z.number().int().min(0).max(1000000),
  pricing_mode: z.enum(["fixed", "starting", "quote"]),
  duration_minutes: z.number().int().min(30).max(720),
  active: z.boolean(),
  sort_order: z.number().int().min(0),
  image_url: asset,
});
export async function adminData(
  section: string,
  p: URLSearchParams,
  user: Session,
) {
  if (!access[section]?.includes(user.role))
    throw new AppError("Your role does not have access.", 403);
  const staff = user.role === "staff",
    limit = 100,
    offset = Math.max(0, Number(p.get("page") || 1) - 1) * limit,
    search = p.get("search") || "";
  const team = await query(
    "SELECT id,name,role,active FROM wl.users ORDER BY name",
  );
  if (
    section === "dashboard" ||
    section === "marketing" ||
    section === "analytics"
  )
    return {
      report: await report(p),
      integrations: await integrationStatus(),
      spend: await query(
        "SELECT * FROM wl.ad_spend ORDER BY spend_date DESC LIMIT 100",
      ),
      campaigns: await query(
        "SELECT c.*,(SELECT count(*)::int FROM wl.messages m WHERE m.campaign_id=c.id AND m.status='sent') sent,(SELECT count(*)::int FROM wl.messages m WHERE m.campaign_id=c.id AND m.status IN ('failed','uncertain')) failed FROM wl.campaigns c ORDER BY created_at DESC LIMIT 100",
      ),
      today: await query(
        "SELECT b.id,b.reference,b.service_name,b.start_minute,b.status,c.first_name||' '||c.last_name customer_name FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id WHERE booking_date=$1 ORDER BY start_minute",
        [(await import("./types")).dateToday()],
      ),
    };
  if (section === "settings")
    return {
      settings: await settings(),
      integrations: await integrationStatus(),
      team: await query(
        "SELECT id,name,email,role,active FROM wl.users ORDER BY name",
      ),
      templates: await query("SELECT * FROM wl.email_templates ORDER BY key"),
    };
  if (section === "services")
    return {
      rows: await query("SELECT * FROM wl.services ORDER BY sort_order,name"),
    };
  if (section === "employees") {
    const week = p.get("week") || (await import("./types")).dateToday();
    return {
      rows: await query(
        `SELECT e.*,COALESCE((SELECT SUM(s.end_minute-s.start_minute-s.break_minutes) FROM wl.employee_shifts s WHERE s.employee_id=e.id AND s.shift_date BETWEEN $1::date::text AND ($1::date+6)::text AND s.status='scheduled'),0)::int scheduled_minutes,
         (SELECT min(s.shift_date) FROM wl.employee_shifts s WHERE s.employee_id=e.id AND s.shift_date>=to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM-DD') AND s.status='scheduled') next_shift
         FROM wl.employees e ORDER BY e.active DESC,e.name`, [week]),
      availability: await query("SELECT * FROM wl.employee_availability ORDER BY employee_id,weekday"),
    };
  }
  if (section === "schedule") {
    const week = p.get("week") || (await import("./types")).dateToday();
    return { week, employees: await query("SELECT * FROM wl.employees WHERE active=true ORDER BY name"), shifts: await query("SELECT s.*,e.name,e.position FROM wl.employee_shifts s JOIN wl.employees e ON e.id=s.employee_id WHERE s.shift_date BETWEEN $1::date::text AND ($1::date+6)::text ORDER BY s.shift_date,s.start_minute", [week]), availability: await query("SELECT * FROM wl.employee_availability"), workload: await query("SELECT booking_date,count(*)::int bookings FROM wl.bookings WHERE booking_date BETWEEN $1::date::text AND ($1::date+6)::text AND status NOT IN ('cancelled','no_show') GROUP BY booking_date", [week]) };
  }
  if (section === "gallery")
    return {
      rows: await query("SELECT * FROM wl.gallery ORDER BY sort_order"),
    };
  if (section === "reviews")
    return {
      rows: await query(
        "SELECT * FROM wl.reviews ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      ),
    };
  if (section === "messages")
    return {
      rows: await query(
        "SELECT * FROM wl.messages ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [limit, offset],
      ),
      integrations: await integrationStatus(),
      templates: await query("SELECT * FROM wl.email_templates ORDER BY key"),
    };
  if (section === "customers") {
    const customers = await query<Customer>(
      `SELECT c.*,
  (SELECT count(*)::int FROM wl.bookings b WHERE b.customer_id=c.id) booking_count,
  COALESCE((SELECT SUM(p.amount_cents-p.refunded_cents)::int FROM wl.payments p WHERE p.customer_id=c.id AND status IN ('paid','partially_refunded','refunded')),0) total_spent,
  (SELECT max(booking_date) FROM wl.bookings b WHERE b.customer_id=c.id AND booking_date<=to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')) last_booking,
  (SELECT min(booking_date) FROM wl.bookings b WHERE b.customer_id=c.id AND booking_date>=to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM-DD') AND status IN ('new','confirmed')) upcoming_booking
  FROM wl.customers c WHERE (first_name||' '||last_name||' '||email||' '||phone) ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      ["%" + search + "%", limit, offset],
    );
    const selected = p.get("id");
    return {
      rows: customers,
      profile: selected
        ? {
            customer: (
              await query(
                "SELECT c.*,a.source,a.campaign FROM wl.customers c LEFT JOIN wl.attributions a ON a.id=c.attribution_id WHERE c.id=$1",
                [uuid.parse(selected)],
              )
            )[0],
            vehicles: await query(
              "SELECT * FROM wl.vehicles WHERE customer_id=$1",
              [selected],
            ),
            bookings: await query(
              "SELECT * FROM wl.bookings WHERE customer_id=$1 ORDER BY booking_date DESC",
              [selected],
            ),
            timeline: await query(
              "SELECT * FROM wl.timeline WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 200",
              [selected],
            ),
            consents: await query(
              "SELECT * FROM wl.consent_events WHERE customer_id=$1 ORDER BY created_at DESC",
              [selected],
            ),
          }
        : null,
    };
  }
  if (section === "leads")
    return {
      rows: await query(
        "SELECT l.*,a.source,a.campaign FROM wl.leads l LEFT JOIN wl.attributions a ON a.id=l.attribution_id WHERE (l.name||' '||l.email||' '||l.phone) ILIKE $1 ORDER BY l.created_at DESC LIMIT $2 OFFSET $3",
        ["%" + search + "%", limit, offset],
      ),
      team,
      services: await query(
        "SELECT * FROM wl.services WHERE active=true ORDER BY sort_order",
      ),
    };
  if (
    section === "bookings" ||
    section === "calendar" ||
    section === "payments"
  ) {
    const date = p.get("date"),
      status = p.get("status") || "",
      view = p.get("view") || "";
    let filters = "";
    const args: unknown[] = ["%" + search + "%"];
    if (staff) {
      args.push(user.user_id);
      filters += " AND b.assigned_to=$" + args.length;
    }
    if (date && section !== "calendar") {
      args.push(date);
      filters += " AND b.booking_date=$" + args.length;
    }
    if (section === "calendar") {
      const focus = date || (await import("./types")).dateToday();
      if (!validDate(focus)) throw new AppError("Choose a valid date.");
      const start = new Date(focus + "T12:00:00Z");
      start.setUTCDate(1);
      start.setUTCDate(start.getUTCDate() - 7);
      const end = new Date(focus + "T12:00:00Z");
      end.setUTCMonth(end.getUTCMonth() + 1, 8);
      args.push(
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      );
      filters +=
        " AND b.booking_date BETWEEN $" +
        (args.length - 1) +
        " AND $" +
        args.length;
    }
    if (status) {
      args.push(status);
      filters += " AND b.status=$" + args.length;
    }
    if (view === "upcoming")
      filters +=
        " AND b.booking_date>=to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM-DD') AND b.status IN ('new','confirmed')";
    if (view === "past")
      filters +=
        " AND b.booking_date<to_char(now() AT TIME ZONE 'America/Chicago','YYYY-MM-DD')";
    const base = `FROM wl.bookings b JOIN wl.customers c ON c.id=b.customer_id JOIN wl.vehicles v ON v.id=b.vehicle_id WHERE (b.reference||' '||c.first_name||' '||c.last_name||' '||b.service_name) ILIKE $1 ${filters}`;
    const count = (
      await query<{ total: number }>("SELECT count(*)::int total " + base, args)
    )[0].total;
    const fields = staff
      ? "b.id,b.reference,b.booking_date,b.start_minute,b.duration_minutes,b.status,b.service_name,b.customer_id,b.notes,b.internal_notes,b.location,b.assigned_to"
      : "b.*";
    args.push(
      section === "calendar" ? 2000 : limit,
      section === "calendar" ? 0 : offset,
    );
    const rows = await query(
      `SELECT ${fields},c.first_name||' '||c.last_name customer_name,c.phone,v.year||' '||v.make||' '||v.model vehicle ${base} ORDER BY b.booking_date DESC,b.start_minute LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );
    return {
      rows,
      total: count,
      team,
      blocks: await query(
        "SELECT * FROM wl.blocks ORDER BY booking_date DESC LIMIT 200",
      ),
      services: await query(
        staff
          ? "SELECT id,name,duration_minutes FROM wl.services WHERE active=true"
          : "SELECT * FROM wl.services WHERE active=true ORDER BY sort_order",
      ),
      payments: staff
        ? []
        : await query(
            "SELECT p.*,b.reference FROM wl.payments p JOIN wl.bookings b ON b.id=p.booking_id ORDER BY p.created_at DESC LIMIT 100",
          ),
    };
  }
  return { rows: [] };
}
const actionSections: Record<string, string> = {
  save_service: "services",
  save_customer: "customers",
  add_note: "customers",
  save_lead: "leads",
  convert_lead: "leads",
  create_booking: "bookings",
  update_booking: "bookings",
  block_time: "calendar",
  remove_block: "calendar",
  save_settings: "settings",
  save_user: "team",
  save_template: "messages",
  send_message: "messages",
  retry_message: "messages",
  save_campaign: "marketing",
  queue_campaign: "marketing",
  cancel_campaign: "marketing",
  save_spend: "marketing",
  save_gallery: "gallery",
  delete_gallery: "gallery",
  publish_review: "reviews",
  request_review: "reviews",
  create_payment: "payments",
  save_employee: "employees",
  save_shift: "schedule",
  delete_shift: "schedule",
  generate_schedule: "schedule",
};
export async function adminAction(action: string, raw: unknown, user: Session) {
  const section = actionSections[action];
  if (!section || !access[section]?.includes(user.role))
    throw new AppError("Your role cannot perform this action.", 403);
  const data = z.record(z.string(), z.unknown()).parse(raw);
  if (action === "save_employee") {
    const e = z.object({ id: uuid.optional(), name: z.string().trim().min(2).max(100), phone: z.string().max(30), email: z.union([z.email(), z.literal("")]), position: z.string().min(2).max(80), hourly_rate_cents: z.number().int().min(0), hire_date: z.string().max(10).nullable(), notes: txt, active: z.boolean(), availability: z.array(z.object({ weekday: z.number().int().min(0).max(6), available: z.boolean(), start_minute: z.number().int().min(0).max(1439), end_minute: z.number().int().min(1).max(1440) })).length(7) }).parse(data);
    const id = e.id || randomUUID();
    await transaction(async (q) => {
      await q("INSERT INTO wl.employees(id,name,email,phone,position,hourly_rate_cents,hire_date,notes,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=$2,email=$3,phone=$4,position=$5,hourly_rate_cents=$6,hire_date=$7,notes=$8,active=$9,updated_at=now()", [id,e.name,e.email,e.phone,e.position,e.hourly_rate_cents,e.hire_date,e.notes,e.active]);
      for (const a of e.availability) await q("INSERT INTO wl.employee_availability(employee_id,weekday,available,start_minute,end_minute) VALUES($1,$2,$3,$4,$5) ON CONFLICT(employee_id,weekday) DO UPDATE SET available=$3,start_minute=$4,end_minute=$5",[id,a.weekday,a.available,a.start_minute,a.end_minute]);
    });
    return { id };
  }
  if (action === "save_shift") {
    const shift = z.object({ id: uuid.optional(), employee_id: uuid, shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start_minute: z.number().int().min(0).max(1439), end_minute: z.number().int().min(1).max(1440), break_minutes: z.number().int().min(0).max(720).default(0), status: z.enum(["scheduled","off","pto","sick"]).default("scheduled"), notes: txt.default("") }).parse(data);
    if (shift.status === "scheduled" && shift.end_minute <= shift.start_minute) throw new AppError("Shift end must follow its start.");
    await query("INSERT INTO wl.employee_shifts(id,employee_id,shift_date,start_minute,end_minute,break_minutes,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET employee_id=$2,shift_date=$3,start_minute=$4,end_minute=$5,break_minutes=$6,status=$7,notes=$8,updated_at=now()", [shift.id || randomUUID(),shift.employee_id,shift.shift_date,shift.start_minute,shift.end_minute,shift.break_minutes,shift.status,shift.notes,user.user_id]);
  }
  if (action === "delete_shift") await query("DELETE FROM wl.employee_shifts WHERE id=$1 AND published=false", [uuid.parse(data.id)]);
  if (action === "generate_schedule") {
    const g = z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start_minute: z.number().int().min(0).max(1439).default(480), end_minute: z.number().int().min(1).max(1440).default(960) }).parse(data);
    if (g.end_minute <= g.start_minute) throw new AppError("Business hours are invalid.");
    const employees = await query<{ id:string }>("SELECT id FROM wl.employees WHERE active=true");
    const availability = await query<{employee_id:string;weekday:number;available:boolean;start_minute:number;end_minute:number}>("SELECT * FROM wl.employee_availability WHERE available=true");
    await transaction(async q => { for (let day=0; day<7; day++) for (const e of employees) { const a=availability.find(x=>x.employee_id===e.id&&x.weekday===day); if (!a) continue; const date=(await q<{d:string}>("SELECT ($1::date+$2)::text d",[g.week,day])).rows[0].d; await q("INSERT INTO wl.employee_shifts(id,employee_id,shift_date,start_minute,end_minute,status,created_by) SELECT $1,$2,$3,$4,$5,'scheduled',$6 WHERE NOT EXISTS(SELECT 1 FROM wl.employee_shifts WHERE employee_id=$2 AND shift_date=$3)",[randomUUID(),e.id,date,Math.max(g.start_minute,a.start_minute),Math.min(g.end_minute,a.end_minute),user.user_id]); } });
  }
  if (action === "save_service") {
    const s = serviceSchema.parse(data),
      id = s.id || randomUUID();
    await query(
      `INSERT INTO wl.services(id,name,slug,category,description,includes,price_cents,suv_extra_cents,truck_extra_cents,pricing_mode,duration_minutes,active,sort_order,image_url)
  VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(id) DO UPDATE SET name=$2,slug=$3,category=$4,description=$5,includes=$6::jsonb,price_cents=$7,suv_extra_cents=$8,truck_extra_cents=$9,pricing_mode=$10,duration_minutes=$11,active=$12,sort_order=$13,image_url=$14,updated_at=now()`,
      [
        id,
        s.name,
        s.slug,
        s.category,
        s.description,
        JSON.stringify(s.includes),
        s.price_cents,
        s.suv_extra_cents,
        s.truck_extra_cents,
        s.pricing_mode,
        s.duration_minutes,
        s.active,
        s.sort_order,
        s.image_url,
      ],
    );
  }
  if (action === "create_booking") {
    if (user.role === "staff")
      throw new AppError("A manager must create appointments.", 403);
    return createBooking(data, true);
  }
  if (action === "update_booking") {
    const b = z
      .object({
        id: uuid,
        status: z.string().optional(),
        date: z.string().optional(),
        start_minute: z.number().int().optional(),
        notes: txt.optional(),
        internal_notes: txt.optional(),
        assigned_to: z.union([uuid, z.null()]).optional(),
        price_cents: z.number().int().min(0).nullable().optional(),
      })
      .parse(data);
    if (
      user.role === "staff" &&
      (b.price_cents !== undefined ||
        b.assigned_to !== undefined ||
        b.date !== undefined ||
        b.start_minute !== undefined)
    )
      throw new AppError(
        "A manager must change pricing, assignment or schedule.",
        403,
      );
    return updateBooking(b.id, b, user.user_id, user.role === "staff");
  }
  if (action === "block_time") {
    const b = z
      .object({
        date: z.string(),
        start_minute: z.number().int().min(0).max(1439),
        end_minute: z.number().int().max(1440),
        reason: txt,
      })
      .parse(data);
    if (!validDate(b.date) || b.end_minute <= b.start_minute)
      throw new AppError("Choose a valid time range.");
    if (user.role === "staff")
      throw new AppError("A manager must change availability.", 403);
    await transaction(async (q) => {
      await q("SELECT id FROM wl.schedule_guard WHERE id=1 FOR UPDATE");
      const conflicts = (
        await q(
          "SELECT id FROM wl.bookings WHERE booking_date=$1 AND status NOT IN ('cancelled','no_show') AND start_minute<$3 AND start_minute+duration_minutes+buffer_minutes>$2",
          [b.date, b.start_minute, b.end_minute],
        )
      ).rows;
      if (conflicts.length)
        throw new AppError(
          "Reschedule the existing appointment before blocking this time.",
        );
      await q(
        "INSERT INTO wl.blocks(id,booking_date,start_minute,end_minute,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), b.date, b.start_minute, b.end_minute, b.reason],
      );
    });
  }
  if (action === "remove_block") {
    if (user.role === "staff")
      throw new AppError("A manager must change availability.", 403);
    await query("DELETE FROM wl.blocks WHERE id=$1", [uuid.parse(data.id)]);
  }
  if (action === "save_customer") {
    const c = z
      .object({
        id: uuid,
        first_name: z.string().min(1).max(80),
        last_name: z.string().min(1).max(80),
        phone: z.string().max(30),
        email: z.email(),
        notes: txt,
      })
      .parse(data);
    await query(
      "UPDATE wl.customers SET first_name=$2,last_name=$3,phone=$4,email=$5,notes=$6,updated_at=now() WHERE id=$1",
      [
        c.id,
        c.first_name,
        c.last_name,
        c.phone,
        c.email.toLowerCase(),
        c.notes,
      ],
    );
    await query(
      "INSERT INTO wl.timeline(id,customer_id,type,body,actor_id) VALUES($1,$2,'customer_updated','Contact details or notes updated',$3)",
      [randomUUID(), c.id, user.user_id],
    );
  }
  if (action === "add_note")
    await query(
      "INSERT INTO wl.timeline(id,customer_id,type,body,actor_id) VALUES($1,$2,'note_added',$3,$4)",
      [
        randomUUID(),
        uuid.parse(data.customer_id),
        txt.min(1).parse(data.body),
        user.user_id,
      ],
    );
  if (action === "save_lead") {
    const l = z
      .object({
        id: uuid.optional(),
        name: z.string().min(2).max(160),
        email: z.union([z.email(), z.literal("")]),
        phone: z.string().max(30),
        status: z.enum([
          "new",
          "contacted",
          "qualified",
          "booked",
          "won",
          "lost",
        ]),
        notes: txt,
        source: z.string().max(100),
        campaign: z.string().max(500).default(""),
        assigned_to: uuid.nullable(),
      })
      .parse(data);
    await transaction(async (q) => {
      const attributionId = await saveAttribution(q, randomUUID(), {
        source: l.source,
        campaign: l.campaign,
      });
      await q(
        "INSERT INTO wl.leads(id,name,email,phone,status,notes,assigned_to,attribution_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=$2,email=$3,phone=$4,status=$5,notes=$6,assigned_to=$7,updated_at=now()",
        [
          l.id || randomUUID(),
          l.name,
          l.email.toLowerCase(),
          l.phone,
          l.status,
          l.notes,
          l.assigned_to,
          attributionId,
        ],
      );
    });
  }
  if (action === "convert_lead") {
    const id = uuid.parse(data.id);
    return transaction(async (q) => {
      const l = (
        await q<Row>("SELECT * FROM wl.leads WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!l) throw new AppError("Lead not found.");
      if (l.customer_id) return { customer_id: l.customer_id };
      const email = z.email().safeParse(l.email);
      if (!email.success)
        throw new AppError("Add a valid email to the lead first.");
      const name = String(l.name).split(" "),
        cid = (
          await q<{ id: string }>(
            "INSERT INTO wl.customers(id,first_name,last_name,email,phone,attribution_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO UPDATE SET updated_at=now() RETURNING id",
            [
              randomUUID(),
              name[0],
              name.slice(1).join(" "),
              email.data.toLowerCase(),
              l.phone,
              l.attribution_id,
            ],
          )
        ).rows[0].id;
      await q(
        "UPDATE wl.leads SET customer_id=$1,updated_at=now() WHERE id=$2",
        [cid, id],
      );
      await q(
        "INSERT INTO wl.timeline(id,customer_id,lead_id,type,body,actor_id) VALUES($1,$2,$3,'lead_converted','Lead converted to customer',$4)",
        [randomUUID(), cid, id, user.user_id],
      );
      return { customer_id: cid };
    });
  }
  if (action === "save_settings")
    return saveSettings(
      data.settings,
      z.record(z.string(), z.string().max(4096)).parse(data.credentials || {}),
    );
  if (action === "save_user") {
    const u = z
      .object({
        id: uuid.optional(),
        name: z.string().min(2).max(80),
        email: z.email(),
        role: z.enum(["owner", "admin", "manager", "staff"]),
        password: z.string().max(128).default(""),
        active: z.boolean().default(true),
      })
      .parse(data);
    if (u.id === user.user_id && (!u.active || u.role !== "owner"))
      throw new AppError("Your current owner account must remain active.");
    if (!u.id) await addUser(u);
    else
      await transaction(async (q) => {
        await q(
          "UPDATE wl.users SET name=$2,email=$3,role=$4,active=$5,updated_at=now() WHERE id=$1",
          [u.id, u.name, u.email.toLowerCase(), u.role, u.active],
        );
        if (u.password) {
          if (u.password.length < 12)
            throw new AppError("Use at least 12 characters.");
          await q("UPDATE wl.users SET password_hash=$2 WHERE id=$1", [
            u.id,
            passwordHash(u.password),
          ]);
        }
        await q("DELETE FROM wl.sessions WHERE user_id=$1", [u.id]);
      });
  }
  if (action === "save_template")
    await query(
      "UPDATE wl.email_templates SET subject=$2,body=$3,updated_at=now() WHERE key=$1",
      [
        z.string().max(80).parse(data.key),
        txt.min(1).parse(data.subject),
        txt.min(1).parse(data.body),
      ],
    );
  if (action === "send_message") {
    const m = z
      .object({
        customer_id: uuid,
        channel: z.enum(["email", "sms"]),
        subject: txt,
        body: txt.min(1),
        purpose: z
          .enum(["transactional", "marketing"])
          .default("transactional"),
      })
      .parse(data);
    const c = (
      await query<Customer>("SELECT * FROM wl.customers WHERE id=$1", [
        m.customer_id,
      ])
    )[0];
    if (!c) throw new AppError("Customer not found.");
    if (
      m.purpose === "marketing" &&
      !(m.channel === "sms"
        ? c.marketing_sms && !c.sms_opted_out
        : c.marketing_email)
    )
      throw new AppError(
        "This customer has not consented to marketing on this channel.",
      );
    const footer =
      m.purpose === "marketing"
        ? m.channel === "sms"
          ? "\nReply STOP to opt out."
          : "\nUnsubscribe: " +
            siteUrl() +
            "/unsubscribe?id=" +
            c.id +
            "&channel=email&token=" +
            (await unsubscribeToken(c.id, "email"))
        : "";
    await transaction((q) =>
      enqueue(q, {
        key: randomUUID(),
        channel: m.channel,
        recipient: m.channel === "email" ? c.email : c.phone,
        subject: m.subject,
        body: m.body + footer,
        customerId: c.id,
        purpose: m.purpose,
      }),
    );
  }
  if (action === "retry_message")
    await query(
      "UPDATE wl.messages SET status='queued',error='',scheduled_at=now() WHERE id=$1 AND status IN ('skipped','failed')",
      [uuid.parse(data.id)],
    );
  if (action === "save_campaign") {
    const c = z
      .object({
        id: uuid.optional(),
        name: z.string().min(2).max(120),
        channel: z.enum(["email", "sms"]),
        audience: z.enum(audiences),
        subject: txt,
        body: txt.min(1),
        scheduled_at: z.string().nullable().default(null),
      })
      .parse(data);
    if (c.scheduled_at && !Number.isFinite(Date.parse(c.scheduled_at)))
      throw new AppError("Invalid campaign schedule.");
    await query(
      "INSERT INTO wl.campaigns(id,name,channel,audience,subject,body,scheduled_at,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET name=$2,channel=$3,audience=$4,subject=$5,body=$6,scheduled_at=$7,status=$8 WHERE wl.campaigns.status IN ('draft','scheduled')",
      [
        c.id || randomUUID(),
        c.name,
        c.channel,
        c.audience,
        c.subject,
        c.body,
        c.scheduled_at,
        c.scheduled_at ? "scheduled" : "draft",
        user.user_id,
      ],
    );
  }
  if (action === "queue_campaign") await queueCampaign(uuid.parse(data.id));
  if (action === "cancel_campaign")
    await transaction(async (q) => {
      const id = uuid.parse(data.id);
      await q("UPDATE wl.campaigns SET status='cancelled' WHERE id=$1", [id]);
      await q(
        "UPDATE wl.messages SET status='cancelled' WHERE campaign_id=$1 AND status IN ('queued','skipped','failed')",
        [id],
      );
    });
  if (action === "save_spend") {
    const s = z
      .object({
        channel: z.string().max(80),
        campaign: z.string().max(500),
        spend_date: z.string(),
        amount_cents: z.number().int().min(0).max(100000000),
      })
      .parse(data);
    if (!validDate(s.spend_date)) throw new AppError("Invalid spend date.");
    await query(
      "INSERT INTO wl.ad_spend(id,channel,campaign,spend_date,amount_cents) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), s.channel, s.campaign, s.spend_date, s.amount_cents],
    );
  }
  if (action === "save_gallery") {
    const g = z
      .object({
        id: uuid.optional(),
        title: z.string().min(2).max(160),
        caption: txt,
        category: z.string().max(80),
        image_url: asset.min(1),
        before_url: asset,
        sort_order: z.number().int().min(0),
        published: z.boolean(),
      })
      .parse(data);
    await query(
      "INSERT INTO wl.gallery(id,title,caption,category,image_url,before_url,sort_order,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET title=$2,caption=$3,category=$4,image_url=$5,before_url=$6,sort_order=$7,published=$8",
      [
        g.id || randomUUID(),
        g.title,
        g.caption,
        g.category,
        g.image_url,
        g.before_url,
        g.sort_order,
        g.published,
      ],
    );
  }
  if (action === "delete_gallery")
    await query("DELETE FROM wl.gallery WHERE id=$1", [uuid.parse(data.id)]);
  if (action === "publish_review")
    await query(
      "UPDATE wl.reviews SET status=$2 WHERE id=$1 AND rating IS NOT NULL AND text<>''",
      [uuid.parse(data.id), z.enum(["published", "hidden"]).parse(data.status)],
    );
  if (action === "request_review") {
    const b = await bookingById(uuid.parse(data.booking_id));
    if (!b || b.status !== "completed")
      throw new AppError(
        "Complete the appointment before requesting a review.",
      );
    const s = await settings(),
      t = await receiptToken(b.id);
    await transaction((q) => enqueueBooking(q, b, s, t, "review_request"));
  }
  if (action === "create_payment")
    return {
      url: await createCheckout(
        uuid.parse(data.booking_id),
        z.enum(["deposit", "balance"]).parse(data.kind || "balance"),
      ),
    };
  return { saved: true };
}
