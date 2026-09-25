"use client";
import { Fragment, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Editor,
  Modal,
  action,
  IntegrationStatus,
  type EditorSpec,
  type Field,
  type RecordData as R,
} from "./AdminControls";
import { BookingWizard } from "./BookingWizard";
import {
  money,
  timeLabel,
  dateToday,
  bookingStatuses,
  leadStatuses,
  channels,
  type Session,
  type BusinessSettings,
  type Service,
} from "@/lib/platform/types";
import { layoutOverlappingShifts } from "@/lib/platform/schedule-layout";
import type { report } from "@/lib/platform/reporting";
type Report = Awaited<ReturnType<typeof report>>;
type CalendarShift = R & { start_minute: number; end_minute: number };
const rows = (v: unknown) => (Array.isArray(v) ? v : []) as R[];
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v || 0);
const title = (v: string) =>
  v.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase());
const f = (
  key: string,
  label: string,
  type = "text",
  extra: Partial<Field> = {},
): Field => ({ key, label, type, ...extra });
const status = (v: unknown) => (
  <span className="status-pill">{title(s(v))}</span>
);
const stamp = (v: unknown) =>
  v
    ? new Date(s(v)).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not yet";
const workspaceSections = [
  { name: "Bookings", items: ["calendar", "bookings", "schedule", "services"] },
  { name: "CRM", items: ["customers", "leads", "reviews"] },
  { name: "Team", items: ["employees", "schedule", "hours", "payroll", "performance", "my_schedule"] },
  { name: "Marketing", items: ["marketing", "messages", "gallery"] },
  { name: "Operations", items: ["inventory", "expenses", "payments", "reports", "analytics"] },
];
export function AdminWorkspace({
  section,
  data,
  user,
  business,
}: {
  section: string;
  data: R;
  user: Session;
  business: BusinessSettings;
}) {
  const router = useRouter(),
    params = useSearchParams();
  const [editor, setEditor] = useState<EditorSpec | null>(null),
    [creating, setCreating] = useState(false),
    [lead, setLead] = useState<
      { id: string; name: string; email: string; phone: string } | undefined
    >(),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [scheduleView, setScheduleView] = useState<"week" | "staff" | "day">("week"),
    [scheduleDay, setScheduleDay] = useState("");
  const list = rows(data.rows),
    team = rows(data.team),
    employeeAvailability = rows(data.availability),
    scheduleEmployees = rows(data.employees),
    scheduleShifts = rows(data.shifts),
    scheduleAppointments = rows(data.appointments),
    staff = user.role === "staff";
  useEffect(() => {
    if (params.get("new") === "booking" && ["bookings", "calendar"].includes(section) && !staff) setCreating(true);
  }, [params, section, staff]);
  const teamOptions = [
    { value: "", label: "Unassigned" },
    ...team
      .filter((t) => t.active)
      .map((t) => ({ value: s(t.id), label: s(t.name) })),
  ];
  const detailerOptions = [
    { value: "", label: "No detailer assigned" },
    ...scheduleEmployees.map((employee) => ({
      value: s(employee.user_id),
      label: `${s(employee.name)} - ${s(employee.position)}`,
    })),
  ];
  const rep = data.report as Report | undefined;
  const rosterDays = s(data.week) ? Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(s(data.week) + "T12:00:00Z");
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  }) : [];
  const calendarStartMinute = 420, calendarHours = 14;
  const selectedScheduleDay = rosterDays.includes(scheduleDay)
    ? scheduleDay
    : rosterDays[0] || "";
  const calendarLayouts = new Map(
    rosterDays.map((day) => [
      day,
      layoutOverlappingShifts<CalendarShift>(
        scheduleShifts
          .filter((shift) => s(shift.shift_date) === day && s(shift.status) === "scheduled")
          .map((shift) => ({ ...shift, start_minute: n(shift.start_minute), end_minute: n(shift.end_minute) })),
      ),
    ]),
  );
  const scheduleDayLabel = (day: string, weekday: "short" | "long" = "short") =>
    new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
      weekday,
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  async function run(name: string, d: R, message = "Saved.") {
    setBusy(true);
    setError("");
    try {
      const result = await action(name, d);
      setNotice(message);
      router.refresh();
      if (result?.url) location.assign(s(result.url));
      if (result?.customer_id)
        router.push("/admin/customers?id=" + s(result.customer_id));
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function clock(clockAction: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/employee/clock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: clockAction }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Time clock could not be updated.");
      setNotice("Time clock updated.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function edit(
    title: string,
    action: string,
    initial: R,
    fields: Field[],
    transform?: (d: R) => R,
  ) {
    setEditor({ title, action, initial, fields, transform });
  }
  function serviceEdit(r: R = {}) {
    edit(
      r.id ? "Edit service" : "Create service",
      "save_service",
      {
        name: "",
        slug: "",
        category: "Essential care",
        description: "",
        includes: "",
        price_cents: 0,
        suv_extra_cents: 0,
        truck_extra_cents: 0,
        pricing_mode: "fixed",
        duration_minutes: 120,
        active: true,
        sort_order: list.length,
        image_url: "",
        ...r,
        ...(r.id
          ? {
              includes: Array.isArray(r.includes) ? r.includes.join("\n") : "",
              price_cents: n(r.price_cents) / 100,
              suv_extra_cents: n(r.suv_extra_cents) / 100,
              truck_extra_cents: n(r.truck_extra_cents) / 100,
            }
          : {}),
      },
      [
        f("name", "Service name", "text", { required: true }),
        f("slug", "URL slug", "text", {
          required: true,
          hint: "Lowercase words separated by hyphens",
        }),
        f("category", "Category", "text", { required: true }),
        f("pricing_mode", "Pricing", "select", {
          options: ["fixed", "starting", "quote"],
        }),
        f("price_cents", "Sedan price ($)", "money"),
        f("suv_extra_cents", "SUV additional ($)", "money"),
        f("truck_extra_cents", "Truck additional ($)", "money"),
        f("duration_minutes", "Duration (minutes)", "number", {
          min: 30,
          max: 720,
        }),
        f("sort_order", "Display order", "number"),
        f("active", "Available to book", "checkbox"),
        f("description", "Short description", "textarea", { wide: true }),
        f("includes", "What's included (one per line)", "lines", {
          wide: true,
        }),
        f("image_url", "Service image", "upload"),
      ],
    );
  }
  function bookingEdit(r: R) {
    edit(
      "Manage " + s(r.reference),
      "update_booking",
      {
        id: r.id,
        status: r.status,
        notes: r.notes,
        internal_notes: r.internal_notes,
        ...(!staff
          ? {
              date: r.booking_date,
              start_minute: r.start_minute,
              assigned_to: r.assigned_to || "",
              price_cents: r.price_cents == null ? "" : n(r.price_cents) / 100,
            }
          : {}),
      },
      [
        f("status", "Status", "select", { options: [...bookingStatuses] }),
        ...(!staff
          ? [
              f("date", "Appointment date", "date"),
              f("start_minute", "Start time", "select", {
                options: Array.from({ length: 48 }, (_, i) => ({
                  value: s(i * 30),
                  label: timeLabel(i * 30),
                })),
              }),
              f("assigned_to", "Assigned detailer", "nullable-select", {
                options: detailerOptions,
                hint: "Only active employee accounts are listed.",
              }),
              f("assignment_override", "Manager override for a shift or job conflict", "checkbox", {
                hint: "Use only after reviewing the visible assignment warning.",
              }),
              f("price_cents", "Agreed service price ($)", "text", {
                hint: "Leave empty for consultation pricing. Price changes should be approved by the customer.",
              }),
            ]
          : []),
        f("notes", "Customer notes", "textarea", { wide: true }),
        ...(!staff ? [f("internal_notes", "Internal notes", "textarea", { wide: true })] : []),
      ],
      (d) => ({
        ...d,
        ...(!staff
          ? {
              start_minute: Number(d.start_minute),
              price_cents:
                d.price_cents === ""
                  ? null
                  : Math.round(Number(d.price_cents) * 100),
            }
          : {}),
      }),
    );
  }
  function upsellEdit(r: R) {
    edit("Add upsell to " + s(r.reference), "save_booking_line_item", { booking_id: r.id, kind: "upsell", name: "", quantity: 1, unit_price_cents: 0 }, [
      f("name", "Upsell name", "text", { required: true, hint: "Example: Engine bay detail or pet-hair removal" }),
      f("quantity", "Quantity", "number", { min: 1, max: 1000 }),
      f("unit_price_cents", "Price per item ($)", "money", { min: 0 }),
    ]);
  }
  function discountEdit(r: R) {
    edit("Apply discount to " + s(r.reference), "save_booking_discount", { booking_id: r.id, kind: "fixed", value: 0, reason: "", code: "" }, [
      f("kind", "Discount type", "select", { options: [{ value: "fixed", label: "Fixed dollar amount" }, { value: "percent", label: "Percentage" }] }),
      f("value", "Amount ($) or percentage (%)", "number", { min: 0, hint: "The final discount is calculated securely from the current job total." }),
      f("reason", "Reason", "text", { required: true }),
      f("code", "Discount code (optional)", "text"),
    ], (d) => ({ ...d, value: Math.round(Number(d.value || 0) * 100) }));
  }
  function tipEdit(r: R) {
    edit("Record tip for " + s(r.reference), "record_job_tip", { booking_id: r.id, tip_cents: n(r.tip_cents) / 100 }, [
      f("tip_cents", "Customer tip ($)", "money", { min: 0, hint: "Tips are included in the assigned detailers' payroll." }),
    ]);
  }
  function customerEdit(r: R) {
    edit("Customer details", "save_customer", r, [
      f("first_name", "First name", "text", { required: true }),
      f("last_name", "Last name", "text", { required: true }),
      f("email", "Email", "email", { required: true }),
      f("phone", "Phone"),
      f("notes", "Customer notes", "textarea", { wide: true }),
    ]);
  }
  function leadEdit(r: R = {}) {
    edit(
      r.id ? "Edit lead" : "Add lead",
      "save_lead",
      {
        name: "",
        email: "",
        phone: "",
        source: "Phone",
        campaign: "",
        status: "new",
        notes: "",
        assigned_to: "",
        ...r,
      },
      [
        f("name", "Full name", "text", { required: true }),
        f("email", "Email", "email"),
        f("phone", "Phone"),
        f("source", "Source", "select", { options: [...channels] }),
        f("campaign", "Campaign"),
        f("status", "Status", "select", { options: [...leadStatuses] }),
        f("assigned_to", "Assign to", "nullable-select", {
          options: teamOptions,
        }),
        f("notes", "Notes", "textarea", { wide: true }),
      ],
    );
  }
  function campaignEdit(r: R = {}) {
    edit(
      "Campaign",
      "save_campaign",
      {
        name: "",
        channel: "sms",
        audience: "all",
        subject: "",
        body: "",
        scheduled_at: "",
        ...r,
        ...(r.scheduled_at
          ? {
              scheduled_at: new Date(
                new Date(s(r.scheduled_at)).getTime() -
                  new Date().getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16),
            }
          : {}),
      },
      [
        f("name", "Campaign name", "text", { required: true }),
        f("channel", "Channel", "select", { options: ["sms", "email"] }),
        f("audience", "Consented audience", "select", {
          options: [
            "all",
            "inactive60",
            "inactive90",
            "ceramic",
            "interior",
            "repeat",
          ],
        }),
        f("subject", "Email subject"),
        f("body", "Message", "textarea", {
          required: true,
          wide: true,
          hint: "Use {{customer_name}}. An opt-out footer is added automatically.",
        }),
        f("scheduled_at", "Schedule (your local timezone)", "datetime-local", {
          hint: "Leave empty to save a draft. A running worker is required for scheduled delivery.",
        }),
      ],
    );
  }
  function galleryEdit(r: R = {}) {
    edit(
      "Gallery item",
      "save_gallery",
      {
        title: "",
        caption: "",
        category: "Exterior",
        image_url: "",
        before_url: "",
        sort_order: list.length,
        published: false,
        ...r,
      },
      [
        f("title", "Title", "text", { required: true }),
        f("category", "Category", "select", {
          options: [
            "Interior",
            "Exterior",
            "Paint correction",
            "Ceramic coating",
            "Wheels",
            "Luxury vehicles",
            "Transformations",
          ],
        }),
        f("image_url", "Image / after photo", "upload", { required: true }),
        f("before_url", "Before photo (optional)", "upload"),
        f("caption", "Caption", "textarea", { wide: true }),
        f("sort_order", "Display order", "number"),
        f("published", "Publish on website", "checkbox"),
      ],
    );
  }
  function teamEdit(r: R = {}) {
    edit(
      "Team member",
      "save_user",
      { name: "", email: "", role: "staff", password: "", active: true, ...r },
      [
        f("name", "Name", "text", { required: true }),
        f("email", "Email", "email", { required: true }),
        f("role", "Role", "select", {
          options: ["owner", "admin", "manager", "staff"],
        }),
        f(
          "password",
          r.id
            ? "New password (leave blank to keep)"
            : "Password (12+ characters)",
          "password",
          { required: !r.id },
        ),
        f("active", "Active", "checkbox"),
      ],
    );
  }
  function employeeEdit(r: R = {}) {
    const availability = Array.isArray(r.availability) ? r.availability : Array.from({ length: 7 }, (_, weekday) => ({ weekday, available: weekday > 0 && weekday < 6, start_minute: 480, end_minute: 1020 }));
    edit(r.id ? "Edit employee" : "Add employee", "save_employee", { name: "", phone: "", email: "", password: "", position: "Detailer", hourly_rate_cents: 10, max_weekly_minutes: 2400, hire_date: "", notes: "", active: true, availability, ...r }, [f("name", "Full name", "text", { required: true }), f("phone", "Phone number", "tel", { required: true }), f("email", "Employee login email", "email", { required: true }), f("password", r.user_id ? "New login password (leave blank to keep)" : "Login password (12+ characters)", "password", { required: !r.user_id }), f("position", "Position", "select", { options: ["Manager", "Lead Detailer", "Detailer", "Washer", "Reception", "Admin"] }), f("hourly_rate_cents", "Hourly pay ($)", "money", { hint: "Detailers are paid the standard $10/hr plan in payroll." }), f("max_weekly_minutes", "Weekly hour cap (minutes)", "number", { min: 60, max: 10080, hint: "2,400 minutes = 40 hours" }), f("hire_date", "Hire date", "date"), f("active", "Active employee", "checkbox"), f("availability", "Weekly availability", "availability", { wide: true }), f("notes", "Notes", "textarea", { wide: true })], (d) => ({ ...d, hire_date: d.hire_date || null }));
  }
  function expenseEdit(r: R = {}) {
    edit(r.id ? "Edit expense" : "Add expense", "save_expense", { expense_date: dateToday(), amount_cents: 0, category: "Supplies", vendor: "", description: "", payment_method: "Card", recurrence: "one_time", recurring_start: "", recurring_end: "", receipt_url: "", notes: "", ...r, ...(r.amount_cents != null ? { amount_cents: n(r.amount_cents) / 100 } : {}) }, [f("expense_date", "Date", "date", { required: true }), f("amount_cents", "Amount ($)", "money", { required: true }), f("category", "Category", "select", { options: ["Rent", "Utilities", "Payroll", "Chemicals", "Equipment", "Supplies", "Insurance", "Advertising", "Software", "Vehicle", "Repairs", "Taxes / Fees", "Other"] }), f("vendor", "Vendor"), f("payment_method", "Payment method", "select", { options: ["Card", "Cash", "ACH", "Check", "Other"] }), f("recurrence", "Frequency", "select", { options: [{ value: "one_time", label: "One-time" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }] }), f("recurring_start", "Recurring start", "date"), f("recurring_end", "Recurring end (optional)", "date"), f("receipt_url", "Receipt", "upload"), f("description", "Description", "textarea", { wide: true }), f("notes", "Notes", "textarea", { wide: true })], (d) => ({ ...d, recurring_start: d.recurring_start || null, recurring_end: d.recurring_end || null }));
  }
  function inventoryEdit(r: R = {}) {
    edit(r.id ? "Edit inventory item" : "Add inventory item", "save_inventory_item", { name: "", sku: "", category: "Chemicals", opening_quantity: 0, unit: "units", unit_cost_cents: 0, supplier: "", minimum_stock: 0, reorder_quantity: 0, last_purchase_date: "", notes: "", active: true, ...r, ...(r.unit_cost_cents != null ? { unit_cost_cents: n(r.unit_cost_cents) / 100 } : {}) }, [f("name", "Product name", "text", { required: true }), f("sku", "SKU"), f("category", "Category", "select", { options: ["Chemicals", "Equipment", "Supplies", "Accessories", "Other"] }), ...(!r.id ? [f("opening_quantity", "Opening quantity", "number", { min: 0 })] : []), f("unit", "Unit", "select", { options: ["units", "bottles", "gallons", "ounces", "packs", "towels", "pairs"] }), f("unit_cost_cents", "Cost per unit ($)", "money"), f("supplier", "Supplier"), f("minimum_stock", "Minimum stock", "number", { min: 0 }), f("reorder_quantity", "Reorder quantity", "number", { min: 0 }), f("last_purchase_date", "Last purchase", "date"), f("active", "Active item", "checkbox"), f("notes", "Notes", "textarea", { wide: true })], (d) => ({ ...d, last_purchase_date: d.last_purchase_date || null }));
  }
  function compensationEdit(r: R = {}) {
    const employees = rows(data.employees);
    edit("Employee compensation", "save_employee_compensation", { employee_id: employees[0]?.id || "", compensation_model: "hourly", ...r, default_commission_bps: n(r.default_commission_bps) / 100, flat_job_pay_cents: n(r.flat_job_pay_cents) / 100 }, [f("employee_id", "Employee", "select", { options: employees.map((employee) => ({ value: s(employee.id), label: s(employee.name) })) }), f("compensation_model", "Pay model", "select", { options: ["hourly", "commission", "hourly_commission", "flat_job"] }), f("default_commission_bps", "Default commission (%)", "number", { min: 0, max: 100 }), f("flat_job_pay_cents", "Flat pay per completed job ($)", "money")], (d) => ({ ...d, default_commission_bps: Math.round(n(d.default_commission_bps) * 100) }));
  }
  function payRuleEdit(r: R = {}) {
    edit("Service pay rule", "save_pay_rule", { employee_id: rows(data.employees)[0]?.id || "", service_id: "", rule_type: "commission_percent", active: true, ...r, value: n(r.value) / 100 }, [f("employee_id", "Employee", "select", { options: rows(data.employees).map((employee) => ({ value: s(employee.id), label: s(employee.name) })) }), f("service_id", "Service", "nullable-select", { options: [{ value: "", label: "All services" }, ...rows(data.services).map((service) => ({ value: s(service.id), label: s(service.name) }))] }), f("rule_type", "Rule type", "select", { options: ["commission_percent", "flat_job"] }), f("value", "Rate (% or flat dollars)", "number", { min: 0 }), f("active", "Active", "checkbox")], (d) => ({ ...d, value: Math.round(n(d.value) * 100) }));
  }
  function movementEdit(item: R) {
    edit("Record movement: " + s(item.name), "record_inventory_movement", { item_id: item.id, movement_type: "purchase", direction: "in", quantity: 1, occurred_on: dateToday(), unit_cost_cents: n(item.unit_cost_cents) / 100, supplier: s(item.supplier), notes: "", create_expense: true, expense_amount_cents: 0 }, [f("movement_type", "Movement type", "select", { options: ["purchase", "usage", "adjustment", "return", "waste", "correction"] }), f("direction", "Direction", "select", { options: [{ value: "in", label: "Add stock" }, { value: "out", label: "Remove stock" }] }), f("quantity", "Quantity", "number", { min: 0.0001, required: true }), f("occurred_on", "Date", "date", { required: true }), f("unit_cost_cents", "Unit cost ($)", "money"), f("supplier", "Supplier"), f("create_expense", "Record purchase as operating expense", "checkbox"), f("expense_amount_cents", "Expense amount ($)", "money", { hint: "Leave at zero to calculate quantity x unit cost." }), f("notes", "Notes", "textarea", { wide: true })]);
  }
  function shiftEdit(r: R = {}) {
    const time = (value: unknown) => { const minutes = n(value); return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; };
    edit(r.id ? "Edit daily shift" : "Add worker to daily roster", "save_shift", { employee_id: scheduleEmployees[0]?.id || "", shift_date: s(data.week) || dateToday(), start_minute: "09:00", end_minute: "17:00", break_minutes: 30, status: "scheduled", notes: "", ...r, ...(r.start_minute != null ? { start_minute: time(r.start_minute), end_minute: time(r.end_minute) } : {}) }, [f("employee_id", "Employee", "select", { required: true, options: scheduleEmployees.map((employee) => ({ value: s(employee.id), label: s(employee.name) + " - " + s(employee.position) })) }), f("shift_date", "Shift date", "date", { required: true }), f("start_minute", "Start time", "time", { required: true }), f("end_minute", "End time", "time", { required: true }), f("break_minutes", "Unpaid break (minutes)", "number", { min: 0, max: 720 }), f("status", "Status", "select", { options: ["scheduled", "off", "pto", "sick"] }), f("notes", "Manager notes", "textarea", { wide: true })], (d) => ({ ...d, start_minute: n(String(d.start_minute).split(":")[0]) * 60 + n(String(d.start_minute).split(":")[1]), end_minute: n(String(d.end_minute).split(":")[0]) * 60 + n(String(d.end_minute).split(":")[1]) }));
  }
  function staffingEdit(day: string, required: number) {
    edit("Staffing target for " + day, "save_staffing_requirement", { date: day, required_staff: required }, [f("date", "Date", "date", { required: true }), f("required_staff", "Staff needed", "number", { min: 0, max: 100, required: true })]);
  }
  function templateEdit(r: R) {
    edit("Edit " + title(s(r.key)) + " template", "save_template", r, [
      f("subject", "Subject", "text", { required: true, wide: true }),
      f("body", "Message template", "textarea", {
        required: true,
        wide: true,
        hint: "Variables: {{customer_name}}, {{service_name}}, {{booking_date}}, {{booking_time}}, {{vehicle}}, {{total}}, {{booking_url}}, {{business_name}}.",
      }),
    ]);
  }
  function messageEdit(customer: R) {
    edit(
      "Message " + s(customer.first_name),
      "send_message",
      {
        customer_id: customer.id,
        channel: "email",
        purpose: "transactional",
        subject: "",
        body: "",
      },
      [
        f("channel", "Channel", "select", { options: ["email", "sms"] }),
        f("purpose", "Purpose", "select", {
          options: ["transactional", "marketing"],
        }),
        f("subject", "Subject"),
        f("body", "Message", "textarea", {
          required: true,
          wide: true,
          hint: "Promotional messages require recorded consent. Saving queues delivery.",
        }),
      ],
    );
  }
  function settingsEdit(group: string) {
    const b = data.settings as R;
    const groups: Record<string, Field[]> = {
      Business: [
        f("name", "Business name"),
        f("phone", "Business phone"),
        f("email", "Business email", "email"),
        f("address", "Street address", "text", { wide: true }),
        f("hours_label", "Public hours"),
        f("service_area", "Service area", "textarea", { wide: true }),
      ],
      Booking: [
        f("appointment_mode", "Appointment location", "select", {
          options: ["shop", "mobile", "both"],
        }),
        f("days", "Available weekdays (0=Sun, 6=Sat)", "text", {
          hint: "Comma separated, e.g. 1,2,3,4,5,6",
        }),
        f("open_time", "Open", "time"),
        f("close_time", "Close", "time"),
        f("buffer_minutes", "Buffer (minutes)", "number"),
        f("deposit_percent", "Deposit (%)", "number", { max: 100 }),
        f("cancellation_policy", "Cancellation policy", "textarea", {
          wide: true,
        }),
      ],
      Branding: [
        f("logo_url", "Logo", "upload"),
        f("favicon_url", "Favicon", "upload"),
        f("instagram_url", "Instagram URL", "url"),
        f("google_review_url", "Google review URL", "url"),
      ],
      Tracking: [
        f("google_tag_id", "Google Tag ID (GT-)"),
        f("ga4_id", "GA4 measurement (G-)"),
        f("google_ads_id", "Google Ads ID (AW-)"),
        f("google_ads_label", "Conversion label"),
        f("meta_pixel_id", "Meta Pixel ID"),
        f("meta_dataset_id", "Meta dataset ID"),
        f("meta_token", "Meta CAPI access token", "password", {
          hint: "Leave blank to keep existing secret",
        }),
      ],
      Notifications: [
        f("email_from", "Verified sender (Resend)"),
        f("telegram_chat_id", "Telegram chat ID"),
        f("sms_from", "Twilio phone number"),
        ...[
          "email_key",
          "telegram_token",
          "telegram_webhook",
          "sms_account",
          "sms_token",
        ].map((k) =>
          f(k, title(k), "password", {
            hint: "Leave blank to keep existing secret",
          }),
        ),
      ],
      Payments: [
        f("stripe_key", "Stripe secret key", "password"),
        f("stripe_webhook", "Stripe webhook signing secret", "password"),
      ],
    };
    const credentials = [
      "email_key",
      "telegram_token",
      "telegram_webhook",
      "sms_account",
      "sms_token",
      "stripe_key",
      "stripe_webhook",
      "meta_token",
    ];
    edit(
      group + " settings",
      "save_settings",
      { ...b, days: (b.days as number[]).join(",") },
      groups[group],
      (d) => {
        const cfg = { ...b, ...d };
        const secrets: R = {};
        for (const k of credentials) {
          if (d[k]) secrets[k] = d[k];
          delete cfg[k];
        }
        cfg.days =
          typeof d.days === "string"
            ? s(d.days).split(",").map(Number)
            : b.days;
        return { settings: cfg, credentials: secrets };
      },
    );
  }
  function table(headers: string[], values: React.ReactNode[][]) {
    return values.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {values.map((cells, i) => (
              <tr key={i}>
                {cells.map((x, j) => (
                  <td key={j}>{x}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="empty-state">
        <h3>No records yet</h3>
        <p>
          Real activity will appear here. Try a different filter or create your
          first record.
        </p>
      </div>
    );
  }
  function bookingsTable(values: R[]) {
    return table(
      [
        "Appointment",
        "Customer / vehicle",
        "Date & time",
        "Assignment",
        "Status",
        ...(!staff ? ["Job total"] : []),
        "Actions",
      ],
      values.map((r) => [
        <>
          <strong>{s(r.reference)}</strong>
          <small>{s(r.service_name)}</small>
        </>,
        <>
          {!staff ? (
            <Link
              className="text-link"
              href={"/admin/customers?id=" + s(r.customer_id)}
            >
              {s(r.customer_name)}
            </Link>
          ) : (
            s(r.customer_name)
          )}
          <small>{s(r.vehicle)}</small>
          <small>{s(r.phone)}</small>
        </>,
        <>
          {s(r.booking_date)}
          <small>
            {timeLabel(n(r.start_minute))} CT · {n(r.duration_minutes) / 60}h
          </small>
        </>,
        !staff ? (
          r.assigned_to ? <><strong>{s(scheduleEmployees.find((e) => s(e.user_id) === s(r.assigned_to))?.name) || "Assigned"}</strong><small>Detailer assigned</small></> : <><strong>Unassigned</strong><small>Assign a detailer</small></>
        ) : null,
        status(r.status),
        ...(!staff
          ? [<><strong>{money(r.price_cents == null ? null : n(r.price_cents))}</strong><small>{n(r.tip_cents) ? "Tip " + money(n(r.tip_cents)) : "No tip recorded"}</small></>]
          : []),
        <>
          <button onClick={() => bookingEdit(r)}>Manage</button>
          {!staff && <button onClick={() => upsellEdit(r)}>Add upsell</button>}
          {!staff && <button onClick={() => discountEdit(r)}>Discount</button>}
          {!staff && <button onClick={() => tipEdit(r)}>Tip</button>}
          {!staff && r.status === "completed" && (
            <button
              disabled={busy}
              onClick={() =>
                run(
                  "request_review",
                  { booking_id: r.id },
                  "Review request queued.",
                )
              }
            >
              Request review
            </button>
          )}
        </>,
      ].filter((cell) => cell !== null)),
    );
  }
  const profile = data.profile as {
    customer: R;
    vehicles: R[];
    bookings: R[];
    timeline: R[];
    consents: R[];
  } | null;
  const reportMode = !!rep;
  const workspace = workspaceSections.find((group) => group.items.includes(section));
  return (
    <>
      <div className="admin-heading">
        <div>
          <h1>{title(section)}</h1>
          <p>
            {section === "dashboard"
              ? "Your business, at a glance."
              : section === "marketing"
                ? "Connect the first click to verified revenue."
                : "One connected workspace. Real business records."}
          </p>
        </div>
        {["bookings", "calendar"].includes(section) && !staff && (
          <button
            className="button"
            onClick={() => {
              setLead(undefined);
              setCreating(true);
            }}
          >
            New appointment +
          </button>
        )}
        {section === "services" && (
          <button className="button" onClick={() => serviceEdit()}>
            Add service +
          </button>
        )}
        {section === "leads" && (
          <button className="button" onClick={() => leadEdit()}>
            Add lead +
          </button>
        )}
        {section === "gallery" && (
          <button className="button" onClick={() => galleryEdit()}>
            Add photos +
          </button>
        )}
        {section === "marketing" && (
          <button className="button" onClick={() => campaignEdit()}>
            Create campaign +
          </button>
        )}
        {section === "expenses" && <button className="button" onClick={() => expenseEdit()}>Add expense +</button>}
        {section === "inventory" && <button className="button" onClick={() => inventoryEdit()}>Add inventory item +</button>}
      </div>
      {workspace && <nav className="workspace-tabs" aria-label={workspace.name + " sections"}>{workspace.items.filter((item) => item !== "my_schedule" || user.role !== "staff" || true).map((item) => <Link className={item === section ? "active" : ""} href={"/admin/" + item} key={item}>{title(item)}</Link>)}</nav>}
      {notice && (
        <div className="success-message" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      {section === "employees" && (
        <section className="paper">
          <div className="section-heading"><div><p className="eyebrow">TEAM</p><h2>{list.filter((r) => r.active).length} active employees</h2></div><button className="button" onClick={() => employeeEdit()}>Add employee +</button></div>
          <p className="small-note">Each employee gets a separate staff login and can only view their own schedule and time clock. Scheduled hours are separate from actual paid clocked hours.</p>
          {table(["Employee", "Role", "Phone", "Status", "Rate", "Scheduled this week", "Actions"], list.map((r) => [<><strong>{s(r.name)}</strong><small>{s(r.email)}</small></>, s(r.position), s(r.phone) || "Not set", status(r.active ? "active" : "inactive"), s(r.position).toLowerCase() === "detailer" ? "$10/hr + 30%" : money(n(r.hourly_rate_cents)), (n(r.scheduled_minutes) / 60).toFixed(1) + "h", <button onClick={() => employeeEdit({ ...r, hourly_rate_cents: n(r.hourly_rate_cents) / 100, availability: employeeAvailability.filter((a) => s(a.employee_id) === s(r.id)) })}>Edit</button>]))}
        </section>
      )}
      {section === "schedule" && (
        <>
          <section className="paper">
            <div className="section-heading"><div><p className="eyebrow">WEEKLY ROSTER</p><h2>Schedule week of {s(data.week)}</h2></div><div className="button-row"><button className="button" disabled={busy || !scheduleEmployees.length} onClick={() => run("generate_schedule", { week: s(data.week), start_minute: 540, end_minute: 1020 }, "Draft shifts created from availability.")}>Generate week</button><button disabled={busy} onClick={() => run("publish_schedule", { week: s(data.week) }, "Schedule published. Notification status is recorded below.")}>Publish schedule</button><button onClick={() => shiftEdit()} disabled={!scheduleEmployees.length}>Add shift +</button></div></div>
            <form className="toolbar"><label className="field"><span>Week starts</span><input name="week" type="date" defaultValue={s(data.week)} /></label><button className="button">Load week</button></form>
            <div className="schedule-view-tabs" role="tablist" aria-label="Schedule view">
              {(["week", "staff", "day"] as const).map((view) => <button className={scheduleView === view ? "active" : ""} key={view} onClick={() => setScheduleView(view)} role="tab" aria-selected={scheduleView === view}>{title(view)}</button>)}
            </div>
            {scheduleView === "week" && <div className="staffing-board" aria-label="Weekly staffing board">
              {rosterDays.map((day) => { const shifts = scheduleShifts.filter((shift) => s(shift.shift_date) === day && s(shift.status) === "scheduled"); const target = n(rows(data.staffing).find((item) => s(item.staffing_date) === day)?.required_staff); const jobs = rows(data.workload).find((item) => s(item.booking_date) === day); const visible = shifts.slice(0, 7); return <article className="staffing-day" key={day}><button className="staffing-day-heading" onClick={() => { setScheduleDay(day); setScheduleView("day"); }}><strong>{scheduleDayLabel(day)}</strong><span>{target ? `Staff ${shifts.length}/${target} ${shifts.length >= target ? "Ready" : "Needs staff"}` : `${shifts.length} staff scheduled`}</span><small>{s(jobs?.bookings) || "0"} appointments</small></button><div className="staffing-chips">{visible.map((shift) => <button className="staffing-chip" key={s(shift.id)} onClick={() => shiftEdit(shift)}><strong>{s(shift.name)}</strong><span>{timeLabel(n(shift.start_minute))} - {timeLabel(n(shift.end_minute))}</span></button>)}{shifts.length > visible.length && <button className="staffing-more" onClick={() => { setScheduleDay(day); setScheduleView("day"); }}>+ {shifts.length - visible.length} more</button>}</div><button className="staffing-add" onClick={() => shiftEdit({ shift_date: day, start_minute: 540, end_minute: 1020 })}>+ Add worker</button></article>})}
            </div>}
            {scheduleView === "staff" && <div className="staffing-board-scroll"><div className="staffing-matrix">
              <div className="staffing-matrix-head">Employee</div>{rosterDays.map((day) => <div className="staffing-matrix-head" key={day}>{scheduleDayLabel(day)}</div>)}
              {scheduleEmployees.map((employee) => <Fragment key={s(employee.id)}><div className="staffing-person"><strong>{s(employee.name)}</strong><small>{s(employee.position)}</small></div>{rosterDays.map((day) => { const shift = scheduleShifts.find((item) => s(item.employee_id) === s(employee.id) && s(item.shift_date) === day && s(item.status) === "scheduled"); const available = employeeAvailability.find((item) => s(item.employee_id) === s(employee.id) && n(item.weekday) === new Date(day + "T12:00:00Z").getUTCDay()); return <button className={shift ? "matrix-shift" : "matrix-off"} key={day} onClick={() => shift ? shiftEdit(shift) : shiftEdit({ employee_id: employee.id, shift_date: day, start_minute: available?.available ? n(available.start_minute) : 540, end_minute: available?.available ? n(available.end_minute) : 1020 })}>{shift ? `${timeLabel(n(shift.start_minute))} - ${timeLabel(n(shift.end_minute))}` : "Off"}</button>})}</Fragment>)}
            </div></div>}
            {scheduleView === "day" && <><div className="day-picker" aria-label="Choose schedule day">{rosterDays.map((day) => <button className={day === selectedScheduleDay ? "active" : ""} key={day} onClick={() => setScheduleDay(day)}>{scheduleDayLabel(day)}</button>)}</div><ScheduleDayTimeline day={selectedScheduleDay} shifts={calendarLayouts.get(selectedScheduleDay) || []} appointments={scheduleAppointments.filter((appointment) => s(appointment.booking_date) === selectedScheduleDay)} startMinute={calendarStartMinute} hours={calendarHours} onShiftEdit={shiftEdit} /></>}
          </section>
          <section className="paper"><div className="section-heading"><div><p className="eyebrow">BOOKING DEMAND</p><h2>Appointments this week</h2></div></div>{table(["Date", "Bookings"], rows(data.workload).map((r) => [s(r.booking_date), s(r.bookings)]))}</section>
          <section className="paper"><div className="section-heading"><div><p className="eyebrow">PUBLISH STATUS</p><h2>Employee notifications</h2></div></div>{table(["Employee", "Channel", "Status", "Details"], rows(data.notifications).map((r) => [s(r.name), s(r.channel).toUpperCase(), status(r.status), s(r.error) || "Queued for delivery"]))}{!(data.integrations as R | undefined)?.sms && <p className="small-note">SMS is not configured. Add the Twilio account SID, auth token, and sending number in Settings → Notifications before publishing a future schedule.</p>}</section>
        </>
      )}
      {section === "hours" && (
        <section className="paper">
          <div className="section-heading"><div><p className="eyebrow">TIME REVIEW</p><h2>Actual worked hours</h2></div></div>
          <form className="toolbar"><label className="field"><span>From</span><input name="start" type="date" defaultValue={s(data.start)} /></label><label className="field"><span>To</span><input name="end" type="date" defaultValue={s(data.end)} /></label><button className="button">Load hours</button></form>
          {table(["Employee", "Clock in", "Clock out", "Break", "Worked", "Approval"], list.map((r) => [<><strong>{s(r.name)}</strong><small>{s(r.position)}</small></>, stamp(r.clock_in), r.clock_out ? stamp(r.clock_out) : "Currently clocked in", n(r.break_minutes) + " min", (n(r.worked_minutes) / 60).toFixed(2) + "h", r.approved ? "Approved" : <button disabled={busy || !r.clock_out} onClick={() => run("approve_time", { id: r.id }, "Time entry approved.")}>Approve</button>]))}
        </section>
      )}
      {section === "payroll" && (
        <section className="paper">
          <div className="section-heading"><div><p className="eyebrow">PAYROLL ESTIMATE</p><h2>Worked hours and estimated gross pay</h2></div><div className="button-row"><button onClick={() => compensationEdit()}>Configure pay</button><button onClick={() => payRuleEdit()}>Service rule +</button><a className="button" href={`/api/manage?section=payroll&export=csv&start=${encodeURIComponent(s(data.start))}&end=${encodeURIComponent(s(data.end))}`}>Export CSV</a></div></div>
          <form className="toolbar"><label className="field"><span>From</span><input name="start" type="date" defaultValue={s(data.start)} /></label><label className="field"><span>To</span><input name="end" type="date" defaultValue={s(data.end)} /></label><button className="button">Calculate</button></form>
          <p className="small-note">Paid hours use completed clock entries when present. If none exist for an employee in this period, scheduled shift hours are used as the payable fallback. Detailers use $10/hr + a shared 30% completed-job commission pool + allocated tips.</p>
          {table(["Employee", "Scheduled", "Actual", "Paid hours", "Hourly pay", "Commissionable revenue", "Commission", "Tips", "Adjustments", "Total pay"], list.map((r) => [<><strong>{s(r.name)}</strong><small>{s(r.position)} · {s(r.paid_hours_source) === "actual_clocked" ? "Clocked time" : "Scheduled-hours fallback"}</small></>, (n(r.scheduled_minutes) / 60).toFixed(2) + "h", (n(r.actual_minutes) / 60).toFixed(2) + "h", (n(r.minutes) / 60).toFixed(2) + "h", money(n(r.hourly_earnings_cents)), money(n(r.attributed_revenue)), money(n(r.commission_cents)), money(n(r.tips_cents)), money(n(r.adjustment_cents)), money(n(r.total_earnings_cents))]))}
          <h3>Service-specific rules</h3>{table(["Employee", "Service", "Rule", "Value", "Status", "Action"], rows(data.rules).map((rule) => [s(rule.employee_name),s(rule.service_name) || "All services",title(s(rule.rule_type)),s(rule.rule_type) === "commission_percent" ? (n(rule.value) / 100).toFixed(2) + "%" : money(n(rule.value)),s(rule.active) === "true" || rule.active ? "Active" : "Inactive",<button onClick={() => payRuleEdit(rule)}>Edit</button>]))}
        </section>
      )}
      {section === "performance" && (
        <section className="paper">
          <div className="section-heading"><div><p className="eyebrow">EMPLOYEE PERFORMANCE</p><h2>Factual production metrics</h2></div></div>
          <form className="toolbar"><label className="field"><span>From</span><input name="start" type="date" defaultValue={s(data.start)} /></label><label className="field"><span>To</span><input name="end" type="date" defaultValue={s(data.end)} /></label><button className="button">Calculate</button></form>
          <p className="small-note">Metrics are derived from completed jobs, attributed revenue, allocated tips, and completed clock entries. They are operational facts, not employee scores.</p>
          {table(["Employee", "Paid hours", "Completed jobs", "Revenue attributed", "Commission", "Tips", "Hourly pay", "Total pay", "Revenue / hour", "Average job"], list.map((r) => {
            const hours = n(r.minutes) / 60, jobs = n(r.jobs_completed), revenue = n(r.attributed_revenue);
            return [<><strong>{s(r.name)}</strong><small>{s(r.position)}</small></>, hours.toFixed(2) + "h", s(jobs), money(revenue), money(n(r.commission_cents)), money(n(r.tips_cents)), money(n(r.hourly_earnings_cents)), money(n(r.total_earnings_cents)), hours ? money(Math.round(revenue / hours)) : "No paid hours", jobs ? money(Math.round(revenue / jobs)) : "No completed jobs"];
          }))}
        </section>
      )}
      {section === "my_schedule" && !data.employee && (
        <section className="paper empty-state">
          <p className="eyebrow">EMPLOYEE WORKSPACE</p>
          <h2>This login is not linked to a detailer profile.</h2>
          <p>Your manager can link this account from Employees. Once linked, your published shifts, assigned jobs, and time clock will appear here.</p>
          {user.role !== "staff" && <Link className="button" href="/admin/employees">Open employees</Link>}
        </section>
      )}
      {section === "my_schedule" && !!data.employee && (
        <>
          <section className="paper"><div className="section-heading"><div><p className="eyebrow">MY WORKSPACE</p><h2>{s((data.employee as R | undefined)?.name)}'s schedule</h2></div></div>
            {(() => { const active = rows(data.entries).find((entry) => !entry.clock_out); return <div className="button-row">{!active ? <button className="button" disabled={busy} onClick={() => clock("in")}>Clock in</button> : <><button disabled={busy || Boolean(active.break_started_at)} onClick={() => clock("break_start")}>Start break</button><button disabled={busy || !active.break_started_at} onClick={() => clock("break_end")}>End break</button><button className="button" disabled={busy || Boolean(active.break_started_at)} onClick={() => clock("out")}>Clock out</button></>}</div>; })()}
            {table(["Date", "Shift", "Break", "Notes"], rows(data.shifts).map((r) => [s(r.shift_date), timeLabel(n(r.start_minute)) + " - " + timeLabel(n(r.end_minute)), n(r.break_minutes) + " min", s(r.notes) || "-"]))}
          </section>
          <section className="paper"><div className="section-heading"><div><p className="eyebrow">ASSIGNED WORK</p><h2>Upcoming appointments</h2></div></div>
            {table(["When", "Customer", "Vehicle", "Service", "Location", "Status", "Actions"], rows(data.appointments).map((r) => [<><strong>{s(r.booking_date)}</strong><small>{timeLabel(n(r.start_minute))} - {timeLabel(n(r.start_minute) + n(r.duration_minutes))}</small></>, <><strong>{s(r.customer_name)}</strong><small>{s(r.phone)}</small></>, s(r.vehicle) || "Vehicle details pending", <><strong>{s(r.service_name)}</strong><small>{s(r.reference)} · {money(r.price_cents == null ? null : n(r.price_cents))}</small></>, <><strong>{s(r.location)}</strong><small>{s(r.notes) || "No access notes"}</small></>, status(r.status), <><button onClick={() => bookingEdit(r)}>View job</button>{r.status === "in_progress" ? <button className="button" disabled={busy} onClick={() => run("update_booking", { id: r.id, status: "completed" }, "Job marked complete.")}>Complete job</button> : r.status !== "completed" && r.status !== "cancelled" ? <button className="button" disabled={busy} onClick={() => run("update_booking", { id: r.id, status: "in_progress" }, "Job started.")}>Start job</button> : null}</>]))}
          </section>
          <section className="paper"><h2>Recent time entries</h2>{table(["Clock in", "Clock out", "Break", "Worked"], rows(data.entries).map((r) => [stamp(r.clock_in), r.clock_out ? stamp(r.clock_out) : "In progress", n(r.break_minutes) + " min", (n(r.worked_minutes) / 60).toFixed(2) + "h"]))}</section>
        </>
      )}
      {section === "expenses" && (() => { const summary = data.summary as R; const categoryRows = rows(summary?.byCategory); return <><section className="paper"><form className="toolbar"><label className="field"><span>Period</span><select name="range" defaultValue={params.get("range") || "30"}><option value="1">Today</option><option value="7">This week</option><option value="30">This month</option><option value="90">Last 90 days</option><option value="year">This year</option></select></label><label className="field"><span>From</span><input name="from" type="date" defaultValue={params.get("from") || ""} /></label><label className="field"><span>To</span><input name="to" type="date" defaultValue={params.get("to") || ""} /></label><label className="field"><span>Search</span><input name="search" defaultValue={params.get("search") || ""} placeholder="Vendor, category..." /></label><button className="button">Apply</button></form><div className="stats-grid">{[["Operating expenses", money(n(summary?.total_cents)), `${s(data.start)} to ${s(data.end)}`],["Recurring", money(n(summary?.recurring_cents)), "Occurrences in selected period"],["One-time", money(n(summary?.one_time_cents)), "Recorded in selected period"],["Categories", s(categoryRows.length), "Real expense categories"]].map(([label,value,hint]) => <div className="stat" key={label}><p>{label}</p><strong>{value}</strong><small>{hint}</small></div>)}</div></section><div className="admin-grid"><section className="paper"><h2>Expense by category</h2>{categoryRows.length ? categoryRows.map((row) => <div className="summary-row" key={s(row.category)}><span>{s(row.category)} <small>({s(row.count)})</small></span><strong>{money(n(row.amount_cents))}</strong></div>) : <div className="empty-state"><h3>No expenses yet</h3><p>Start tracking operating expenses to see true operating costs.</p><button className="button" onClick={() => expenseEdit()}>Add expense +</button></div>}</section><section className="paper"><h2>Expense reporting</h2><p className="small-note">Recurring items are calculated for the selected period without creating duplicate records. Expense totals include recorded operating expenses, including linked inventory purchases once.</p><Link className="text-link" href={`/admin/reports?from=${encodeURIComponent(s(data.start))}&to=${encodeURIComponent(s(data.end))}`}>Open profitability report ↗</Link></section></div><section className="paper"><div className="section-heading"><div><p className="eyebrow">OPERATING COSTS</p><h2>Expense records</h2></div></div>{table(["Date","Vendor","Category","Amount","Frequency","Receipt","Actions"], list.map((row) => [s(row.expense_date),<><strong>{s(row.vendor) || "No vendor"}</strong><small>{s(row.description)}</small></>,s(row.category),money(n(row.amount_cents)),title(s(row.recurrence)),row.receipt_url ? <a className="text-link" href={s(row.receipt_url)} target="_blank">View</a> : "-",<><button onClick={() => expenseEdit(row)}>Edit</button><button className="link-button" onClick={() => run("delete_expense", { id: row.id }, "Expense deleted.")}>Delete</button></>]))}</section></> })()}
      {section === "inventory" && (() => { const summary = data.summary as R; return <><section className="paper"><form className="toolbar"><label className="field"><span>Search inventory</span><input name="search" defaultValue={params.get("search") || ""} placeholder="Product, SKU, supplier..." /></label><button className="button">Search</button></form><div className="stats-grid">{[["Inventory items",s(summary?.items),"Active products"],["Inventory value",money(n(summary?.value_cents)),"Quantity x cost basis"],["Low stock",s(summary?.low_stock),"At or below minimum"],["Out of stock",s(summary?.out_of_stock),"Requires attention"]].map(([label,value,hint]) => <div className="stat" key={label}><p>{label}</p><strong>{value}</strong><small>{hint}</small></div>)}</div></section><section className="paper"><div className="section-heading"><div><p className="eyebrow">STOCK CONTROL</p><h2>Inventory</h2></div></div>{table(["Product","Stock","Status","Value","Supplier","Actions"], list.map((item) => [<><strong>{s(item.name)}</strong><small>{s(item.sku) || s(item.category)}</small></>,`${s(item.quantity)} ${s(item.unit)}`,<span className={`inventory-status ${s(item.stock_status)}`}>{title(s(item.stock_status))}</span>,money(n(item.quantity) * n(item.unit_cost_cents)),s(item.supplier) || "-",<><button className="button" onClick={() => movementEdit(item)}>Record movement</button><button onClick={() => inventoryEdit(item)}>Edit</button><Link className="text-link" href={`/admin/inventory?id=${s(item.id)}`}>History</Link></>]))}</section>{params.get("id") && <section className="paper"><div className="section-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Inventory movement history</h2></div></div>{table(["Date","Item","Type","Change","Recorded by","Notes"], rows(data.movements).map((movement) => [s(movement.occurred_on),s(movement.item_name),title(s(movement.movement_type)),`${n(movement.quantity) > 0 ? "+" : ""}${s(movement.quantity)}`,s(movement.user_name) || "System",s(movement.notes) || "-"]))}</section>}</> })()}
      {reportMode && rep && (
        <>
          <form className="toolbar">
            <label className="field">
              <span>Reporting period</span>
              <select name="range" defaultValue={params.get("range") || "30"}>
                {[
                  ["1", "Today"],
                  ["yesterday", "Yesterday"],
                  ["week", "This week"],
                  ["month", "This month"],
                  ["last_month", "Last month"],
                  ["30", "Last 30 days"],
                  ["90", "90 days"],
                  ["year", "This year"],
                ].map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Custom from</span>
              <input
                type="date"
                name="from"
                defaultValue={params.get("from") || ""}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                name="to"
                defaultValue={params.get("to") || ""}
              />
            </label>
            <button className="button">Apply dates</button>
          </form>
          <p className="small-note">
            {rep.start} through {rep.end} · Central Time. Revenue uses verified
            payments less refunds, never unpaid booking estimates.
          </p>
          <div className="stats-grid">
            {[
              ["Net revenue", money(rep.revenue), "Selected period"],
              ["Operating expenses", money(rep.expenses), "Recorded expenses in period"],
              ["Net operating profit", money(rep.net_operating_profit), "Revenue less operating expenses"],
              ["Operating margin", rep.operating_margin == null ? "No paid revenue" : rep.operating_margin.toFixed(1) + "%", "Not tax or full accounting profit"],
              ["Bookings", s(rep.bookings.total), "Created in period"],
              ["New leads", s(rep.leads), "Recorded enquiries & bookings"],
              [
                "Booking conversion",
                rep.conversion_rate == null
                  ? "No visits"
                  : rep.conversion_rate.toFixed(1) + "%",
                "Booked sessions / tracked visitors",
              ],
              [
                "Average paid order",
                money(rep.average_order),
                "Net revenue / paid appointments",
              ],
              [
                "Revenue per payer",
                money(rep.revenue_per_customer),
                "Net revenue / paying customers",
              ],
              [
                "New customers",
                s(rep.customers.new_customers),
                "Created in period",
              ],
              [
                "Returning customers",
                s(rep.customers.returning),
                "2+ completed visits, all time",
              ],
            ].map(([k, v, h]) => (
              <div className="stat" key={k}>
                <p>{k}</p>
                <strong>{v}</strong>
                <small>{h}</small>
              </div>
            ))}
          </div>
          {section === "dashboard" && (
            <>
              <div className="stats-grid">
                {Object.entries(rep.windows).map(([k, v]) => (
                  <div className="stat" key={k}>
                    <p>
                      Revenue{" "}
                      {k === "week"
                        ? "this week"
                        : k === "month"
                          ? "this month"
                          : k === "year"
                            ? "this year"
                            : k}
                    </p>
                    <strong>{money(n(v))}</strong>
                    <small>Verified net payments</small>
                  </div>
                ))}
              </div>
              <div className="stats-grid">
                {[
                  ["Today's jobs", s((data.operations as R | undefined)?.today_jobs), "Scheduled visits"],
                  ["Available detailers", s((data.operations as R | undefined)?.active_detailers), "Active employee profiles"],
                  ["Unassigned jobs", s((data.operations as R | undefined)?.unassigned_jobs), "Need a detailer"],
                ].map(([k, v, h]) => <div className="stat" key={k}><p>{k}</p><strong>{v}</strong><small>{h}</small></div>)}
              </div>
              <div className="admin-grid">
                <section className="paper">
                  <h2>Financial trend</h2>
                  {rep.financial_series.length ? <>{table(["Date", "Revenue", "Expenses", "Net operating profit"], rep.financial_series.map((row) => [s(row.day), money(n(row.revenue)), money(n(row.expenses)), money(n(row.net_operating_profit))]))}<p className="small-note">Revenue is verified payments less refunds. Operating expenses include recorded expenses only; labor is shown separately when time entries exist.</p></> : <div className="empty-state"><p>No financial activity in this period.</p></div>}
                </section>
                <section className="paper">
                  <h2>Today's schedule</h2>
                  {table(
                    ["Time", "Customer", "Service", "Detailer", "Status"],
                    rows(data.today).map((r) => [
                      timeLabel(n(r.start_minute)),
                      s(r.customer_name),
                      s(r.service_name),
                      s(r.detailer_name) || "Unassigned",
                      status(r.status),
                    ]),
                  )}
                  <Link
                    className="text-link"
                    href={"/admin/calendar?date=" + dateToday()}
                  >
                    Open calendar ↗
                  </Link>
                </section>
                <section className="paper">
                  <h2>Unassigned jobs</h2>
                  {table(["When", "Customer", "Service", "Action"], rows(data.unassigned).map((r) => [<><strong>{s(r.booking_date)}</strong><small>{timeLabel(n(r.start_minute))}</small></>, s(r.customer_name), s(r.service_name), <Link className="text-link" href="/admin/bookings">Assign detailer ↗</Link>]))}
                </section>
                <section className="paper">
                  <h2>Booking health</h2>
                  {Object.entries(rep.bookings).map(([k, v]) => (
                    <div className="summary-row" key={k}>
                      <span>{title(k)}</span>
                      <strong>{s(v)}</strong>
                    </div>
                  ))}
                  <div className="summary-row">
                    <span>Customers, all time</span>
                    <strong>{s(rep.customers.total)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Repeat customer share</span>
                    <strong>
                      {n(rep.customers.total)
                        ? (
                            (n(rep.customers.returning) /
                              n(rep.customers.total)) *
                            100
                          ).toFixed(1) + "%"
                        : "No customers"}
                    </strong>
                  </div>
                  <div className="summary-row"><span>Recorded labor cost</span><strong>{money(rep.labor_cost)}</strong></div>
                  <div className="summary-row"><span>Inventory alerts</span><strong>{s((data.inventory as R | undefined)?.low_stock)} low · {s((data.inventory as R | undefined)?.out_of_stock)} out</strong></div>
                </section>
              </div>
            </>
          )}
          <div className="admin-grid">
            <section className="paper">
              <h2>Revenue by payment date</h2>
              {rep.series.length ? (
                <>
                  <div
                    className="chart"
                    role="img"
                    aria-label="Daily net payment revenue"
                  >
                    {rep.series.map((r) => (
                      <div
                        key={s(r.day)}
                        style={{
                          height:
                            Math.max(
                              2,
                              (n(r.revenue) /
                                Math.max(
                                  ...rep.series.map((x) => n(x.revenue)),
                                  1,
                                )) *
                                100,
                            ) + "%",
                        }}
                        title={s(r.day) + ": " + money(n(r.revenue))}
                      />
                    ))}
                  </div>
                  <div className="chart-labels">
                    <span>{rep.start}</span>
                    <span>{rep.end}</span>
                  </div>
                  <details>
                    <summary>View chart data</summary>
                    {table(
                      ["Date", "Revenue"],
                      rep.series.map((r) => [s(r.day), money(n(r.revenue))]),
                    )}
                  </details>
                </>
              ) : (
                <div className="empty-state">
                  <p>No verified payments in this period.</p>
                </div>
              )}
            </section>
            <section className="paper">
              <h2>Customer journey</h2>
              {rep.events.length ? (
                rep.events.map((r) => (
                  <div className="summary-row" key={s(r.name)}>
                    <span>{title(s(r.name))}</span>
                    <strong>{s(r.count)}</strong>
                  </div>
                ))
              ) : (
                <p>No tracked activity yet.</p>
              )}
              <p className="small-note">
                Phone clicks measure intent, not answered calls. Manually record
                actual phone leads in Leads.
              </p>
            </section>
          </div>
          <section className="paper">
            <h2>Channel performance</h2>
            {table(
              [
                "Channel",
                "Leads",
                "Bookings",
                "Revenue",
                "Spend",
                "CPL",
                "CPA",
                "ROAS",
              ],
              rep.channels.map((r) => [
                r.channel,
                s(r.leads),
                s(r.bookings),
                money(r.revenue),
                r.spend == null ? "Not entered" : money(r.spend),
                r.cpl == null ? "—" : money(r.cpl),
                r.cpa == null ? "—" : money(r.cpa),
                r.roas == null ? "—" : r.roas.toFixed(2) + "×",
              ]),
            )}
            <p className="small-note">
              Spend is manually entered unless an ad reporting connector is
              added. Missing spend is not zero spend. Source is linked to the
              actual booking and payment record.
            </p>
          </section>
          {section !== "dashboard" && (
            <>
              <section className="paper">
                <h2>Campaign attribution</h2>
                {table(
                  ["Channel", "Campaign", "Leads", "Bookings", "Revenue"],
                  rep.campaigns
                    .filter((r) => n(r.leads) || n(r.bookings) || n(r.revenue))
                    .map((r) => [
                      s(r.source),
                      s(r.campaign) || "(not tagged)",
                      s(r.leads),
                      s(r.bookings),
                      money(n(r.revenue)),
                    ]),
                )}
              </section>
              <section className="paper">
                <h2>Services by paid revenue</h2>
                {table(
                  ["Service", "Paid bookings", "Revenue"],
                  rep.topServices.map((r) => [
                    s(r.service_name),
                    s(r.bookings),
                    money(n(r.revenue)),
                  ]),
                )}
              </section>
            </>
          )}
          {section === "marketing" && (
            <>
              <section className="paper">
                <div className="section-heading">
                  <h2>Ad spend</h2>
                  <button
                    className="button outline"
                    onClick={() =>
                      edit(
                        "Enter verified ad spend",
                        "save_spend",
                        {
                          channel: "Google Ads",
                          campaign: "",
                          spend_date: dateToday(),
                          amount_cents: 0,
                        },
                        [
                          f("channel", "Channel", "select", {
                            options: [...channels],
                          }),
                          f("campaign", "Campaign"),
                          f("spend_date", "Spend date", "date"),
                          f("amount_cents", "Spend ($)", "money"),
                        ],
                      )
                    }
                  >
                    Record spend +
                  </button>
                </div>
                {table(
                  ["Date", "Channel", "Campaign", "Amount"],
                  rows(data.spend).map((r) => [
                    s(r.spend_date),
                    s(r.channel),
                    s(r.campaign),
                    money(n(r.amount_cents)),
                  ]),
                )}
              </section>
              <section className="paper">
                <h2>Email & SMS campaigns</h2>
                <p className="small-note">
                  Only opted-in recipients are selected. Consent is checked
                  again immediately before delivery. Scheduled sends require the
                  worker service.
                </p>
                {table(
                  [
                    "Campaign",
                    "Audience",
                    "Status",
                    "Scheduled",
                    "Sent / Failed",
                    "Actions",
                  ],
                  rows(data.campaigns).map((r) => [
                    <>
                      {s(r.name)}
                      <small>{s(r.channel)}</small>
                    </>,
                    s(r.audience),
                    status(r.status),
                    stamp(r.scheduled_at),
                    s(r.sent) + " / " + s(r.failed),
                    <>
                      {["draft", "scheduled"].includes(s(r.status)) && (
                        <>
                          <button onClick={() => campaignEdit(r)}>Edit</button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Send this campaign now to its consented audience?",
                                )
                              )
                                void run(
                                  "queue_campaign",
                                  { id: r.id },
                                  "Campaign queued for consented recipients.",
                                );
                            }}
                          >
                            Send now
                          </button>
                        </>
                      )}
                      {!["completed", "cancelled"].includes(s(r.status)) && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(
                              "cancel_campaign",
                              { id: r.id },
                              "Pending campaign messages cancelled.",
                            )
                          }
                        >
                          Cancel
                        </button>
                      )}
                    </>,
                  ]),
                )}
              </section>
              <section className="paper">
                <h2>Integration configuration</h2>
                <IntegrationStatus value={data.integrations as R} />
                <Link className="text-link" href="/admin/settings">
                  Open settings ↗
                </Link>
              </section>
            </>
          )}
        </>
      )}
      {!reportMode &&
        ["bookings", "customers", "leads", "calendar", "payments"].includes(
          section,
        ) && (
          <form className="toolbar">
            <label className="field">
              <span>Search records</span>
              <input
                name="search"
                placeholder="Name, reference..."
                defaultValue={params.get("search") || ""}
              />
            </label>
            {["bookings", "calendar", "payments"].includes(section) && (
              <>
                <label className="field">
                  <span>Date</span>
                  <input
                    type="date"
                    name="date"
                    defaultValue={params.get("date") || ""}
                  />
                </label>
                <label className="field">
                  <span>Status</span>
                  <select
                    name="status"
                    defaultValue={params.get("status") || ""}
                  >
                    <option value="">All statuses</option>
                    {bookingStatuses.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <button className="button">Filter</button>
            <Link className="text-link" href={"/admin/" + section}>
              Clear
            </Link>
          </form>
        )}
      {section === "bookings" && (
        <>
          <div className="filter-tabs">
            {[
              ["", "All"],
              ["?date=" + dateToday(), "Today"],
              ["?view=upcoming", "Upcoming"],
              ["?view=past", "Past"],
              ["?status=completed", "Completed"],
              ["?status=cancelled", "Cancelled"],
              ["?status=no_show", "No-show"],
            ].map(([q, l]) => (
              <Link key={l} href={"/admin/bookings" + q}>
                {l}
              </Link>
            ))}
          </div>
          {bookingsTable(list)}
          <p className="small-note">
            {s(data.total)} matching appointments. Showing up to 100 per page.
          </p>
        </>
      )}
      {section === "calendar" && (
        <>
          <Calendar
            records={list}
            onEdit={bookingEdit}
            date={params.get("date") || dateToday()}
          />
          <div className="paper">
            <h2>Availability blocks</h2>
            {!staff && (
              <button
                className="button outline"
                onClick={() =>
                  edit(
                    "Block appointment time",
                    "block_time",
                    {
                      date: dateToday(),
                      start_minute: 480,
                      end_minute: 1080,
                      reason: "Unavailable",
                    },
                    [
                      f("date", "Date", "date", { required: true }),
                      f("start_minute", "Start", "select", {
                        options: Array.from({ length: 48 }, (_, i) => ({
                          value: s(i * 30),
                          label: timeLabel(i * 30),
                        })),
                      }),
                      f("end_minute", "End", "select", {
                        options: Array.from({ length: 48 }, (_, i) => ({
                          value: s((i + 1) * 30),
                          label: timeLabel((i + 1) * 30),
                        })),
                      }),
                      f("reason", "Reason"),
                    ],
                    (d) => ({
                      ...d,
                      start_minute: Number(d.start_minute),
                      end_minute: Number(d.end_minute),
                    }),
                  )
                }
              >
                Block time +
              </button>
            )}
            {table(
              ["Date", "Time", "Reason", "Action"],
              rows(data.blocks).map((r) => [
                s(r.booking_date),
                timeLabel(n(r.start_minute)) +
                  " – " +
                  timeLabel(n(r.end_minute)),
                s(r.reason),
                !staff && (
                  <button
                    disabled={busy}
                    onClick={() => run("remove_block", { id: r.id })}
                  >
                    Remove
                  </button>
                ),
              ]),
            )}
          </div>
        </>
      )}
      {section === "services" &&
        table(
          [
            "Service",
            "Category",
            "Price / duration",
            "Visibility",
            "Order",
            "Actions",
          ],
          list.map((r) => [
            <strong>{s(r.name)}</strong>,
            s(r.category),
            <>
              {s(r.pricing_mode) === "quote"
                ? "By consultation"
                : money(n(r.price_cents))}
              <small>
                {n(r.duration_minutes) / 60} hours · {s(r.pricing_mode)}
              </small>
            </>,
            status(r.active ? "active" : "disabled"),
            s(r.sort_order),
            <button onClick={() => serviceEdit(r)}>Edit service</button>,
          ]),
        )}
      {section === "customers" && (
        <>
          {profile?.customer && (
            <section className="paper">
              <div className="section-heading">
                <div>
                  <h2>
                    {s(profile.customer.first_name)}{" "}
                    {s(profile.customer.last_name)}
                  </h2>
                  <p>
                    {s(profile.customer.email)} · {s(profile.customer.phone)}
                  </p>
                </div>
                <button
                  className="button"
                  onClick={() => customerEdit(profile.customer)}
                >
                  Edit profile
                </button>
              </div>
              <div className="profile-details">
                <div>
                  <div className="button-row">
                    <a
                      className="text-link"
                      href={"tel:" + s(profile.customer.phone)}
                    >
                      Call
                    </a>
                    <a
                      className="text-link"
                      href={"mailto:" + s(profile.customer.email)}
                    >
                      Email
                    </a>
                    <button
                      className="button outline"
                      onClick={() => messageEdit(profile.customer)}
                    >
                      Send message
                    </button>
                  </div>
                  <dl>
                    <dt>First recorded source / campaign</dt>
                    <dd>
                      {s(profile.customer.source) || "Unknown"} /{" "}
                      {s(profile.customer.campaign) || "Not tagged"}
                    </dd>
                    <dt>Email marketing</dt>
                    <dd>
                      {profile.customer.marketing_email
                        ? "Consented"
                        : "Not consented"}
                    </dd>
                    <dt>SMS marketing</dt>
                    <dd>
                      {profile.customer.sms_opted_out
                        ? "Opted out"
                        : profile.customer.marketing_sms
                          ? "Consented"
                          : "Not consented"}
                    </dd>
                    <dt>Customer notes</dt>
                    <dd>{s(profile.customer.notes) || "No notes"}</dd>
                  </dl>
                  <h3>Vehicles</h3>
                  {profile.vehicles.map((v) => (
                    <p key={s(v.id)}>
                      {s(v.year)} {s(v.make)} {s(v.model)} · {s(v.type)}
                    </p>
                  ))}
                  <button
                    className="button outline"
                    onClick={() =>
                      edit(
                        "Add customer note",
                        "add_note",
                        { customer_id: profile.customer.id, body: "" },
                        [
                          f("body", "Note", "textarea", {
                            required: true,
                            wide: true,
                          }),
                        ],
                      )
                    }
                  >
                    Add timeline note
                  </button>
                  <h3>Consent history</h3>
                  {table(
                    ["Channel", "Choice", "Recorded"],
                    profile.consents.map((c) => [
                      s(c.channel),
                      c.consent ? "Opted in" : "Opted out",
                      stamp(c.created_at),
                    ]),
                  )}
                </div>
                <div>
                  <h3>Connected timeline</h3>
                  <ul className="timeline">
                    {profile.timeline.map((t) => (
                      <li key={s(t.id)}>
                        <strong>{title(s(t.type))}</strong>
                        {s(t.body)}
                        <small>{stamp(t.created_at)}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <h3>Booking history</h3>
              {table(
                ["Reference", "Service", "Date", "Status"],
                profile.bookings.map((b) => [
                  s(b.reference),
                  s(b.service_name),
                  s(b.booking_date),
                  status(b.status),
                ]),
              )}
            </section>
          )}
          {table(
            [
              "Customer",
              "Contact",
              "Bookings",
              "Net lifetime spend",
              "Last / upcoming",
              "Action",
            ],
            list.map((r) => [
              <>
                {s(r.first_name)} {s(r.last_name)}
                <small>Since {stamp(r.created_at)}</small>
              </>,
              <>
                {s(r.email)}
                <small>{s(r.phone)}</small>
              </>,
              s(r.booking_count),
              money(n(r.total_spent)),
              <>
                {s(r.last_booking) || "No past visit"}
                <small>{s(r.upcoming_booking) || "No upcoming visit"}</small>
              </>,
              <Link
                className="text-link"
                href={"/admin/customers?id=" + s(r.id)}
              >
                Open profile ↗
              </Link>,
            ]),
          )}
        </>
      )}
      {section === "leads" &&
        table(
          ["Lead", "Source / campaign", "Status", "Contact", "Actions"],
          list.map((r) => [
            <>
              {s(r.name)}
              <small>{s(r.notes)}</small>
            </>,
            <>
              {s(r.source)}
              <small>{s(r.campaign)}</small>
            </>,
            status(r.status),
            <>
              {!!r.phone && (
                <a className="text-link" href={"tel:" + s(r.phone)}>
                  Call
                </a>
              )}
              <small>
                {!!r.email && <a href={"mailto:" + s(r.email)}>{s(r.email)}</a>}
              </small>
              {!!r.phone && <a href={"sms:" + s(r.phone)}>SMS</a>}
            </>,
            <>
              <button onClick={() => leadEdit(r)}>Edit</button>
              {!r.customer_id && (
                <button
                  disabled={busy}
                  onClick={() => run("convert_lead", { id: r.id })}
                >
                  Create customer
                </button>
              )}
              <button
                onClick={() => {
                  setLead({
                    id: s(r.id),
                    name: s(r.name),
                    email: s(r.email),
                    phone: s(r.phone),
                  });
                  setCreating(true);
                }}
              >
                Book
              </button>
            </>,
          ]),
        )}
      {section === "payments" && (
        <>
          <p className="small-note">
            Payment records are written by verified Stripe webhooks. Checkout
            links do not mark appointments paid.
          </p>
          {table(
            [
              "Appointment",
              "Amount",
              "Refunded",
              "Status",
              "Transaction",
              "Paid",
            ],
            rows(data.payments).map((r) => [
              s(r.reference),
              money(n(r.amount_cents)),
              money(n(r.refunded_cents)),
              status(r.status),
              s(r.stripe_payment_id) || "Pending",
              stamp(r.paid_at),
            ]),
          )}
          <h2>Collect payment</h2>
          {table(
            ["Appointment", "Customer", "Estimate", "Action"],
            list
              .filter((r) => !["cancelled", "no_show"].includes(s(r.status)))
              .map((r) => [
                s(r.reference),
                s(r.customer_name),
                money(r.price_cents == null ? null : n(r.price_cents)),
                <button
                  disabled={busy}
                  onClick={() =>
                    run("create_payment", { booking_id: r.id, kind: "balance" })
                  }
                >
                  Open secure checkout
                </button>,
              ]),
          )}
        </>
      )}
      {section === "messages" && (
        <>
          <IntegrationStatus value={data.integrations as R} />
          {table(
            [
              "Channel / purpose",
              "Recipient",
              "Message",
              "Status",
              "Provider ID",
              "Date / error",
              "Action",
            ],
            list.map((r) => [
              <>
                {s(r.channel)}
                <small>{s(r.purpose)}</small>
              </>,
              s(r.recipient),
              <details>
                <summary>{s(r.subject) || "View message"}</summary>
                <p>{s(r.body)}</p>
              </details>,
              status(r.status),
              s(r.provider_id) || "Not sent",
              <>
                {stamp(r.sent_at || r.created_at)}
                <small>{s(r.error)}</small>
              </>,
              ["failed", "skipped"].includes(s(r.status)) ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    run("retry_message", { id: r.id }, "Message requeued.")
                  }
                >
                  Retry
                </button>
              ) : r.status === "uncertain" ? (
                "Check provider before retrying"
              ) : (
                "—"
              ),
            ]),
          )}
          <section className="paper">
            <h2>Transactional templates</h2>
            {table(
              ["Template", "Subject", "Action"],
              rows(data.templates).map((r) => [
                title(s(r.key)),
                s(r.subject),
                <button onClick={() => templateEdit(r)}>Edit template</button>,
              ]),
            )}
          </section>
        </>
      )}
      {section === "reviews" && (
        <>
          <p className="small-note">
            Requests are tied to completed appointments. Only genuine submitted
            feedback can be published.
          </p>
          {table(
            ["Customer", "Rating", "Feedback", "Status", "Received", "Actions"],
            list.map((r) => [
              s(r.name),
              r.rating ? s(r.rating) + "/5" : "Awaiting",
              s(r.text),
              status(r.status),
              stamp(r.created_at),
              r.rating ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run("publish_review", { id: r.id, status: "published" })
                    }
                  >
                    Publish
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run("publish_review", { id: r.id, status: "hidden" })
                    }
                  >
                    Hide
                  </button>
                </>
              ) : (
                "Awaiting customer"
              ),
            ]),
          )}
        </>
      )}
      {section === "gallery" &&
        table(
          [
            "Photo",
            "Title / caption",
            "Category",
            "Order",
            "Visibility",
            "Actions",
          ],
          list.map((r) => [
            <img
              alt={s(r.title)}
              src={s(r.image_url)}
              style={{ width: 100, height: 75, objectFit: "cover" }}
            />,
            <>
              {s(r.title)}
              <small>{s(r.caption)}</small>
            </>,
            s(r.category),
            s(r.sort_order),
            status(r.published ? "published" : "draft"),
            <>
              <button onClick={() => galleryEdit(r)}>Edit</button>
              <button
                disabled={busy}
                onClick={() => {
                  if (confirm("Remove this gallery entry from the website?"))
                    void run("delete_gallery", { id: r.id });
                }}
              >
                Delete
              </button>
            </>,
          ]),
        )}
      {section === "settings" && (
        <>
          <section className="paper">
            <h2>Business configuration</h2>
            <div className="integration-list">
              {[
                "Business",
                "Booking",
                "Branding",
                "Tracking",
                "Notifications",
                "Payments",
              ].map((g) => (
                <div key={g}>
                  <strong>{g}</strong>
                  <button
                    className="button outline"
                    onClick={() => settingsEdit(g)}
                  >
                    Configure
                  </button>
                </div>
              ))}
            </div>
            <p className="small-note">
              Credentials are encrypted server-side. Blank password fields keep
              existing values. Environment variables can also provide
              configuration. Review all services, contact details and hours
              before launch.
            </p>
          </section>
          <section className="paper">
            <h2>Integration readiness</h2>
            <IntegrationStatus value={data.integrations as R} />
          </section>
          <section className="paper">
            <div className="section-heading">
              <h2>Team & permissions</h2>
              {user.role === "owner" && (
                <button className="button" onClick={() => teamEdit()}>
                  Add team member +
                </button>
              )}
            </div>
            {table(
              ["Name", "Email", "Role", "Status", "Action"],
              rows(data.team).map((r) => [
                s(r.name),
                s(r.email),
                s(r.role),
                status(r.active ? "active" : "disabled"),
                user.role === "owner" && (
                  <button onClick={() => teamEdit(r)}>Edit access</button>
                ),
              ]),
            )}
            <p className="small-note">
              Staff see only their assigned appointments and cannot access
              financial, customer database or marketing reports. Owners manage
              team access. Password changes invalidate existing sessions.
            </p>
          </section>
        </>
      )}
      {!reportMode &&
        [
          "bookings",
          "customers",
          "leads",
          "reviews",
          "messages",
          "payments",
        ].includes(section) && (
          <div className="toolbar">
            {n(params.get("page") || 1) > 1 && (
              <Link
                className="button outline"
                href={
                  "?" +
                  new URLSearchParams({
                    ...Object.fromEntries(params),
                    page: s(n(params.get("page") || 1) - 1),
                  })
                }
              >
                Previous page
              </Link>
            )}
            {list.length === 100 && (
              <Link
                className="button outline"
                href={
                  "?" +
                  new URLSearchParams({
                    ...Object.fromEntries(params),
                    page: s(n(params.get("page") || 1) + 1),
                  })
                }
              >
                Next page
              </Link>
            )}
          </div>
        )}
      {editor && (
        <Editor
          key={editor.title + s(editor.initial.id)}
          spec={editor}
          onClose={() => setEditor(null)}
        />
      )}
      {creating && (
        <Modal
          title={lead ? "Book for " + lead.name : "Create appointment"}
          onClose={() => setCreating(false)}
          wide
        >
          <BookingWizard
            services={rows(data.services) as unknown as Service[]}
            business={business}
            admin
            lead={lead}
            onComplete={() => {
              setCreating(false);
              setNotice("Appointment created.");
              router.refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}
function ScheduleDayTimeline({
  day,
  shifts,
  appointments,
  startMinute,
  hours,
  onShiftEdit,
}: {
  day: string;
  shifts: Array<{ shift: CalendarShift; lane: number; lanes: number }>;
  appointments: R[];
  startMinute: number;
  hours: number;
  onShiftEdit: (shift: R) => void;
}) {
  const bookingLayouts = layoutOverlappingShifts<CalendarShift>(
    appointments.map((appointment) => ({
      ...appointment,
      start_minute: n(appointment.start_minute),
      end_minute: n(appointment.start_minute) + n(appointment.duration_minutes),
    })),
  );
  const eventStyle = (event: { start_minute: number; end_minute: number; lane: number; lanes: number }) => ({
    top: `${Math.max(0, event.start_minute - startMinute)}px`,
    height: `${Math.max(34, event.end_minute - event.start_minute)}px`,
    left: `calc(${(event.lane / event.lanes) * 100}% + 3px)`,
    width: `calc(${100 / event.lanes}% - 6px)`,
  });
  return <div className="day-timeline-scroll"><div className="day-timeline" style={{ "--timeline-height": `${hours * 60}px` } as CSSProperties}><div className="day-time-heading">{scheduleDate(day)}</div><div className="day-track-heading">Staff shifts</div><div className="day-track-heading">Appointments</div><div className="day-time-labels">{Array.from({ length: hours }, (_, hour) => <span key={hour}>{timeLabel(startMinute + hour * 60)}</span>)}</div><div className="day-track" onClick={() => onShiftEdit({ shift_date: day, start_minute: 540, end_minute: 1020 })}>{shifts.map(({ shift, lane, lanes }) => <button className="shift-event" key={s(shift.id)} style={eventStyle({ start_minute: shift.start_minute, end_minute: shift.end_minute, lane, lanes })} onClick={(event) => { event.stopPropagation(); onShiftEdit(shift); }}><strong>{s(shift.name)}</strong><span>{timeLabel(shift.start_minute)} - {timeLabel(shift.end_minute)}</span></button>)}</div><div className="day-track appointment-track">{bookingLayouts.map(({ shift, lane, lanes }) => <Link className="appointment-event" key={s(shift.id)} style={eventStyle({ start_minute: shift.start_minute, end_minute: shift.end_minute, lane, lanes })} href={`/admin/bookings?search=${encodeURIComponent(s(shift.reference))}`}><strong>{s(shift.service_name)}</strong><span>{timeLabel(shift.start_minute)} · {s(shift.customer_name)}</span></Link>)}</div></div></div>;
}
function scheduleDate(day: string) {
  return new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
function Calendar({
  records,
  onEdit,
  date,
}: {
  records: R[];
  onEdit: (r: R) => void;
  date: string;
}) {
  const [view, setView] = useState("week");
  const base = new Date(date + "T12:00:00Z");
  const start = new Date(base);
  if (view === "week") start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  if (view === "month") {
    start.setUTCDate(1);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  }
  const days = Array.from(
    { length: view === "day" ? 1 : view === "week" ? 7 : 42 },
    (_, i) => {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    },
  );
  return (
    <>
      <div className="filter-tabs">
        {["day", "week", "month"].map((v) => (
          <button
            className="button outline"
            key={v}
            onClick={() => setView(v)}
            aria-pressed={v === view}
          >
            {title(v)}
          </button>
        ))}
      </div>
      <p className="small-note">
        Central Time. Select a date above to focus the calendar. Blocks and
        assigned visits are shown below.
      </p>
      <div className="calendar-scroll">
        <div
          className="calendar-grid"
          style={
            view === "day"
              ? { gridTemplateColumns: "1fr", minWidth: 0 }
              : undefined
          }
        >
          {days.map((day) => (
            <div key={day} className="calendar-day">
              <span>
                {new Date(day + "T12:00:00Z").toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </span>
              {records
                .filter((r) => r.booking_date === day)
                .sort((a, b) => n(a.start_minute) - n(b.start_minute))
                .map((r) => (
                  <button
                    className="calendar-event"
                    key={s(r.id)}
                    onClick={() => onEdit(r)}
                  >
                    <strong>
                      {timeLabel(n(r.start_minute))} · {s(r.customer_name)}
                    </strong>
                    {s(r.service_name)}
                    <br />
                    {title(s(r.status))}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
