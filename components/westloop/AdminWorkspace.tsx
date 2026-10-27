"use client";
import { StudioReports } from "./StudioReports";
import { StudioCollection, StudioSnapshot } from "./StudioCollection";
import { AdminOverview } from "./AdminOverview";
import { GrowthWorkspace } from "./GrowthWorkspace";
import { BookingList } from "./BookingList";
import { PayrollList } from "./PayrollList";
import { StaffWorkspace } from "./StaffWorkspace";
import { adminNavigation, adminSectionLabels } from "@/lib/platform/admin-navigation";
import { JobWorkspace } from "./JobWorkspace";
import { EmployeeResources, EmployeeAccessLink } from "./EmployeeResources";
import { EmployeeJobHistory } from "./EmployeeJobHistory";
import { EmployeePaySettings, PayPlanSummary } from "./EmployeePaySettings";
import { ExpenseEditor } from "./ExpenseEditor";
import type { ExpenseDirectory } from "@/lib/platform/expense-directory";
import {CrmTagLibrary,RecordTags,LeadOutcome} from "./CrmTags";
import {RemoveTeamMember} from "./RemoveTeamMember";
import type {CrmTag} from "@/lib/platform/crm";
import {SpendBars,ProfitChart,MarketingCostReturn} from "./FinanceCharts";
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
import { SalesBookingForm } from "./SalesBookingForm";
import { JobPhotos } from "./JobPhotos";
import { MetaLeadForms } from "./MetaLeadForms";
import { AdsPerformance } from "./AdsPerformance";
import { marketingStreamLabel } from "@/lib/marketing-streams";
import { MarketingCommissions } from "./MarketingCommissions";
import { SquareRevenue } from "./SquareRevenue";
import SquareCustomerHistory from "./SquareCustomerHistory";
import { ArchiveCustomer } from "./ArchiveCustomer";
import type { squareRevenueStatus } from "@/lib/integrations/square-reporting";
import {
  money,
  timeLabel,
  dateToday,
  bookingStatuses,
  leadStatuses,
  channels,
  leadStreams,
  type Session,
  type BusinessSettings,
  type Service,
} from "@/lib/platform/types";
import { layoutOverlappingShifts } from "@/lib/platform/schedule-layout";
import { dateTimeLocalValue } from "@/lib/platform/admin-editor-values";
import type { report } from "@/lib/platform/reporting";
type Report = Awaited<ReturnType<typeof report>>;
type CalendarShift = R & { start_minute: number; end_minute: number };
const rows = (v: unknown) => (Array.isArray(v) ? v : []) as R[];
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v || 0);
const serviceLinePrice = (booking: R, item: R) => {
  const service = rows((booking.service_snapshot as R | undefined)?.selected_services)
    .find((selection) => selection.id === item.service_id);
  return item.quote_pending || (item.kind === "base_service" && service?.base_cents === null) ? "By quote" : money(n(item.quantity) * n(item.unit_price_cents));
};
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
const accessRoleLabel = (role: unknown) =>
  s(role) === "staff" ? "Detailer" : title(s(role));
function crmTagRows(value:unknown):CrmTag[]{return rows(value).map(t=>({id:s(t.id),name:s(t.name),color:s(t.color),archived_at:t.archived_at?s(t.archived_at):null}));}
export function AdminWorkspace({
  section,
  data,
  user,
  business,
  allowedSections,
}: {
  section: string;
  data: R;
  user: Session;
  business: BusinessSettings;
  allowedSections: string[];
}) {
  const router = useRouter(),
    params = useSearchParams();
  const [openedJob, setOpenedJob] = useState<R | null>(null);
  const [paySettings, setPaySettings] = useState<{ employeeId?: string } | null>(null);
  const [employeeHistory, setEmployeeHistory] = useState<{ id: string; name: string; start?: string; end?: string } | null>(null);
  const [expense, setExpense] = useState<R | null>(null);
  const requestedPaymentView = params.get("payment_view");
  const paymentView = ["square", "website", "collect"].includes(requestedPaymentView || "") ? requestedPaymentView! : "square";
  function setPaymentView(view: string) {
    const next = new URLSearchParams(params.toString());
    next.set("payment_view", view);
    router.push(`/admin/payments?${next}`, { scroll: false });
  }
  const [expenseView, setExpenseView] = useState("records");
  const [editor, setEditor] = useState<EditorSpec | null>(null),
    [creating, setCreating] = useState(false),
    [lead, setLead] = useState<
      { id: string; name: string; email: string; phone: string } | undefined
    >(),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [recordFiltersOpen, setRecordFiltersOpen] = useState(() => Boolean(params.get("search") || params.get("date") || params.get("status"))),
    [scheduleView, setScheduleView] = useState<"week" | "staff" | "day">("week"),
    [scheduleDay, setScheduleDay] = useState(""),
    [customerArchiveVersion, setCustomerArchiveVersion] = useState(0);
  const canArchiveCustomers = ["owner", "admin"].includes(user.role);
  const archivedCustomers = params.get("archived") === "1";
  const archivedBookings = section === "bookings" && Boolean(data.archivedBookings);
  function refreshCustomers() {
    setCustomerArchiveVersion(version => version + 1);
    router.refresh();
  }
  const list = rows(data.rows),
    team = rows(data.team),
    employeeAvailability = rows(data.availability),
    scheduleEmployees = rows(data.employees),
    scheduleShifts = rows(data.shifts),
    scheduleAppointments = rows(data.appointments),
    staff = user.role === "staff";
  const newBookingRequested = params.get("new") === "booking";
  useEffect(() => {
    if (newBookingRequested && ["bookings", "calendar"].includes(section) && !staff) setCreating(true);
  }, [newBookingRequested, section, staff]);
  function closeCreating() {
    setCreating(false);
    setLead(undefined);
    if (newBookingRequested) {
      const next = new URLSearchParams(params.toString());
      next.delete("new");
      router.replace(`/admin/${section}${next.size ? "?" + next : ""}`);
    }
  }
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
    selectChanges?: EditorSpec["selectChanges"],
  ) {
    setEditor({ title, action, initial, fields, transform, selectChanges,
      ...(action==="save_expense"?{onSaved:(values:R,result:R|undefined)=>{
        const next=new URLSearchParams(params.toString()),date=s(result?.expense_date||values.expense_date);
        next.delete("search");next.delete("page");
        const outside=date<s(data.start)||date>s(data.end);
        if(outside){next.set("from",date<s(data.start)?date:s(data.start));next.set("to",date>s(data.end)?date:s(data.end));}
        setNotice(outside?"Expense saved. The date range was expanded to include it.":"Expense saved.");
        router.replace("/admin/expenses?"+next.toString());
      }}:{})
    });
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
    const editableStatuses = staff
      ? ["completed", "cancelled", "no_show"].includes(s(r.status))
        ? [s(r.status)]
        : Array.from(new Set([s(r.status), "in_progress", "completed"]))
      : [...bookingStatuses];
    edit(
      "Manage " + s(r.reference),
      "update_booking",
      {
        id: r.id,
        status: r.status,
        notes: r.notes,
        ...(!staff
          ? {
              internal_notes: r.internal_notes,
              date: r.booking_date,
              start_minute: r.start_minute,
              assigned_to: r.assigned_to || "",

            }
          : {}),
      },
      [
        f("status", "Status", "select", { options: editableStatuses }),
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

            }
          : {}),
      }),
    );
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
        lead_stream: "Unassigned",
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
        f("source", "Lead source", "select", {
          options: channels.map(value => ({ value, label: value === "Phone" ? "Phone call · source unknown" : value })),
          hint: "For calls to your regular number, keep Phone when the source is unknown. Select an ad source only when call tracking identifies it.",
        }),
        f("lead_stream", "Lead stream", "select", { options: leadStreams.map(value => ({ value, label: marketingStreamLabel(value) })) }),
        f("campaign", "Campaign"),
        f("status", "Status", "select", { options: leadStatuses.map(value=>({value,label:value==="won"?"Sold":title(value)})) }),
        f("call_customer", "Call Customer tag", "checkbox"),
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
              scheduled_at: dateTimeLocalValue(s(r.scheduled_at)),
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
    if (!allowedSections.includes("team") || (user.role !== "owner" && r.role === "owner")) return;
    edit(
      r.id ? "Edit team access" : "Create team login",
      "save_user",
      { name: "", email: "", role: "staff", password: "", phone: "", position: "Detailer", active: true, ...r },
      [
        f("name", "Name", "text", { required: true }),
        f("email", "Email", "email", { required: true }),
        f("role", "Role", "select", {
          options: (user.role === "owner"
            ? ["owner", "admin", "manager", "staff"]
            : ["admin", "manager", "staff"]
          ).map((role) => ({ value: role, label: role === "staff" ? "Detailer" : title(role) })),
          hint: "Owners and admins have full access. Managers run operations. Detailers see only their own schedule workspace.",
        }),
        f(
          "password",
          r.id
            ? "New password (leave blank to keep)"
            : "Password (12+ characters)",
          "password",
          { required: !r.id },
        ),
        f("phone", "Detailer phone", "tel", {
          required: true,
          hint: "Used for schedule notifications and the linked employee profile.",
          visibleWhen: (values) => values.role === "staff",
        }),
        f("position", "Job title", "select", {
          options: ["Lead Detailer", "Detailer", "Washer", "Reception", "Other"],
          visibleWhen: (values) => values.role === "staff",
        }),
        f("active", "Active", "checkbox"),
      ],
    );
  }
  function employeeEdit(r: R = {}) {
    if (user.role === "manager" && r.user_id && s(r.login_role) !== "staff") return;
    if (user.role !== "owner" && r.login_role === "owner") return;
    const availability = Array.isArray(r.availability) ? r.availability : Array.from({ length: 7 }, (_, weekday) => ({ weekday, available: weekday > 0 && weekday < 6, start_minute: 480, end_minute: 1020 }));
    const canSetRole = allowedSections.includes("team") && !["owner", "admin"].includes(s(r.login_role));
    edit(r.id ? "Edit employee" : "Add employee", "save_employee", { name: "", phone: "", email: "", password: "", position: "Detailer", login_role: "staff", hourly_rate_cents: 10, max_weekly_minutes: 2400, hire_date: "", notes: "", active: true, availability, ...r }, [f("name", "Full name", "text", { required: true }), f("phone", "Phone number", "tel", { required: true }), f("email", "Employee login email", "email", { required: true }), f("password", r.user_id ? "New login password (leave blank to keep)" : r.id ? "Password (only needed for a new login)" : "Login password (12+ characters)", "password", { required: !r.id, hint: r.id && !r.user_id ? "If this email already has a team login, leave blank to keep that password and link the profile." : "Use at least 12 characters. Share the login details directly with this employee." }), f("position", "Position", "select", { options: ["Manager", "Lead Detailer", "Detailer", "Washer", "Reception", "Admin"], hint: "Job title. Dashboard permissions are set by the login access role." }), ...(canSetRole ? [f("login_role", "Login access role", "select", { options: [{ value: "staff", label: "Detailer — My Schedule and time clock only" }, { value: "manager", label: "Manager — operations, employees and payroll" }], hint: "Owner and admin accounts are managed in Team → Team Access." })] : []), f("hourly_rate_cents", "Starting hourly rate ($)", "money", { hint: "New Detailers start on an hourly + 30% plan. Use Pay settings after saving to customize the plan.", visibleWhen: (values) => !values.id }), f("max_weekly_minutes", "Weekly hour cap (minutes)", "number", { min: 60, max: 10080, hint: "2,400 minutes = 40 hours" }), f("hire_date", "Hire date", "date"), f("active", "Active employee", "checkbox"), f("availability", "Weekly availability", "availability", { wide: true }), f("notes", "Notes", "textarea", { wide: true })], (d) => { const { hourly_rate_cents, login_role, ...profile } = d; return { ...profile, ...(canSetRole ? { login_role } : {}), ...(!profile.id ? { hourly_rate_cents } : {}), hire_date: d.hire_date || null }; });
  }
  function expenseEdit(r: R = {}) { setExpense(r); }
  function inventoryEdit(r: R = {}) {
    edit(r.id ? "Edit inventory item" : "Add inventory item", "save_inventory_item", { name: "", sku: "", category: "Chemicals", opening_quantity: 0, unit: "units", unit_cost_cents: 0, supplier: "", minimum_stock: 0, reorder_quantity: 0, last_purchase_date: "", notes: "", active: true, ...r, ...(r.unit_cost_cents != null ? { unit_cost_cents: n(r.unit_cost_cents) / 100 } : {}) }, [f("name", "Product name", "text", { required: true }), f("sku", "SKU"), f("category", "Category", "select", { options: ["Chemicals", "Equipment", "Supplies", "Accessories", "Other"] }), ...(!r.id ? [f("opening_quantity", "Opening quantity", "number", { min: 0, step: 0.0001 })] : []), f("unit", "Unit", "select", { options: ["units", "bottles", "gallons", "ounces", "packs", "towels", "pairs"] }), f("unit_cost_cents", "Cost per unit ($)", "money"), f("supplier", "Supplier"), f("minimum_stock", "Minimum stock", "number", { min: 0, step: 0.0001 }), f("reorder_quantity", "Reorder quantity", "number", { min: 0, step: 0.0001 }), f("last_purchase_date", "Last purchase", "date"), f("active", "Active item", "checkbox"), f("notes", "Notes", "textarea", { wide: true })], (d) => ({ ...d, last_purchase_date: d.last_purchase_date || null }));
  }
  function compensationEdit(r: R = {}) {
    if (!allowedSections.includes("payroll") || staff) return;
    setPaySettings({ employeeId: s(r.employee_id || r.id) || undefined });
  }
  function movementEdit(item: R) {
    edit("Record movement: " + s(item.name), "record_inventory_movement", { item_id: item.id, movement_type: "purchase", direction: "in", quantity: 1, occurred_on: dateToday(), unit_cost_cents: n(item.unit_cost_cents) / 100, supplier: s(item.supplier), notes: "", create_expense: true, expense_amount_cents: 0 }, [f("movement_type", "Movement type", "select", { options: ["purchase", "usage", "adjustment", "return", "waste", "correction"] }), f("direction", "Direction", "select", { options: [{ value: "in", label: "Add stock" }, { value: "out", label: "Remove stock" }] }), f("quantity", "Quantity", "number", { min: 0.0001, step: 0.0001, required: true }), f("occurred_on", "Date", "date", { required: true }), f("unit_cost_cents", "Unit cost ($)", "money"), f("supplier", "Supplier"), f("create_expense", "Record purchase as operating expense", "checkbox"), f("expense_amount_cents", "Expense amount ($)", "money", { hint: "Leave at zero to calculate quantity x unit cost." }), f("notes", "Notes", "textarea", { wide: true })]);
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
  function table(
    headers: string[],
    values: React.ReactNode[][],
    options: { comparison?: boolean; label?: string; className?: string } = {},
  ) {
    return values.length ? (
      <>
      {options.comparison && <p className={`admin-table-hint${options.className ? ` ${options.className}-hint` : ""}`}>Scroll horizontally to compare all columns.</p>}
      <div
        className={`table-scroll admin-table-wrap admin-table-wrap--${options.comparison ? "comparison" : "cards"}${options.className ? ` ${options.className}` : ""}`}
        role={options.comparison ? "region" : undefined}
        tabIndex={options.comparison ? 0 : undefined}
        aria-label={options.comparison ? `${options.label || "Comparison table"}. Scroll horizontally for all columns.` : undefined}
      >
        <table className="admin-record-table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              {headers.map((h) => (
                <th key={h} scope="col" role="columnheader">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {values.map((cells, i) => (
              <tr className="admin-record-row" key={i} role="row">
                {cells.map((x, j) => {
                  const actions = /^(Actions?|Approval)$/.test(headers[j]);
                  return (
                    <td
                      key={j}
                      role="cell"
                      data-label={headers[j]}
                      className={`admin-record-cell${j === 0 ? " admin-record-main" : ""}${actions ? " admin-record-actions" : ""}`}
                    >
                      <div className={`admin-record-value${actions ? " admin-record-actions-content" : ""}`}>{x}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>
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
    return <BookingList records={values} employees={scheduleEmployees} staff={staff} canCollect={!staff && allowedSections.includes("payments")} canViewCustomers={allowedSections.includes("customers")} archived={archivedBookings} squareEnvironment={s(data.squareEnvironment)} onOpen={setOpenedJob} />;
  }
  const profile = data.profile as {
    customer: R;
    vehicles: R[];
    bookings: R[];
    timeline: R[];
    consents: R[];
  } | null;
  const reportMode = !!rep;
  const canViewExpenses = allowedSections.includes("expenses");
  const canViewGrowthReports = allowedSections.includes("analytics") || allowedSections.includes("marketing");
  const workspace = adminNavigation(allowedSections).find((group) => group.sections.includes(section));
  const spendContent = (<section className="paper">
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
                          lead_stream: "Unassigned",
                          campaign: "",
                          spend_date: dateToday(),
                          amount_cents: 0,
                        },
                        [
                          f("channel", "Channel", "select", {
                            options: [...channels],
                          }),
                          f("lead_stream", "Lead stream", "select", {
                            options: leadStreams.map(value => ({ value, label: marketingStreamLabel(value) })),
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
                  ["Date", "Channel", "Lead stream", "Campaign", "Amount"],
                  rows(data.spend).map((r) => [
                    s(r.spend_date),
                    s(r.channel),
                    marketingStreamLabel(s(r.lead_stream)),
                    <span className="compact-id" title={s(r.campaign)}>{s(r.campaign)}</span>,
                    money(n(r.amount_cents)),
                  ]),
                )}
              </section>);
  const campaignContent = (<section className="paper">
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
              </section>);
  return (
    <>
      {!["dashboard", "marketing"].includes(section) && <div className="admin-heading">
        <div>
          <h1>{adminSectionLabels[section] || title(section)}</h1>
          <p>
            {{bookings: "Appointments, assignments and payments in one place.", calendar: "See your upcoming appointments.", employees: "Your people, their work and pay plans.", payroll: "See what each person earned and why.", schedule: "Plan the week and assign your team.", customers: "Customer details and service history.", leads: "Keep track of new enquiries.", services: "Your services, pricing and availability.", hours: "Review clocked time and approve hours.", expenses: "Keep your business costs in view.", payments: "Collected payments and transaction history.", inventory: "Products, stock levels and purchases.", performance: "Work completed and earnings by employee.", team: "Manage who can access your workspace.", my_schedule: "Your shifts, assigned jobs and time clock.", reports: "Revenue, costs and business performance.", analytics: "Understand website activity and acquisition.", reviews: "Customer feedback and review requests."}[section] || "Manage your studio."}
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
            New booking
          </button>
        )}
        {section === "employees" && <button className="button" onClick={()=>employeeEdit()}>Add employee</button>}
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
      </div>}
      {workspace && workspace.sections.length > 1 && !["dashboard", "marketing"].includes(section) && <><nav className="workspace-tabs" aria-label={workspace.label + " sections"}>{workspace.sections.map((item) => <Link className={item === section ? "active" : ""} aria-current={item === section ? "page" : undefined} href={"/admin/" + item} key={item}>{adminSectionLabels[item] || title(item)}</Link>)}</nav><label className="workspace-mobile-select"><span>{workspace.label}</span><select aria-label={`${workspace.label} section`} value={section} onChange={event => router.push(`/admin/${event.target.value}`)}>{workspace.sections.map(item => <option key={item} value={item}>{adminSectionLabels[item] || title(item)}</option>)}</select></label></>}
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
      {section === "dashboard" && rep && <AdminOverview data={data} user={user} allowedSections={allowedSections} />}
      {section === "marketing" && rep && <GrowthWorkspace data={data} business={business} allowedSections={allowedSections} campaignContent={campaignContent} spendContent={spendContent} onCreateCampaign={() => campaignEdit()} />}
      {section === "employees" && <>
        <StudioSnapshot items={[
          {label:"Active team",value:list.filter(r=>r.active).length,detail:"Employee profiles"},
          {label:"Login ready",value:list.filter(r=>r.user_id && r.login_active).length,detail:"Linked active accounts"},
          {label:"Scheduled this week",value:`${(list.reduce((sum,r)=>sum+n(r.scheduled_minutes),0)/60).toFixed(1)}h`,detail:"Across the team"},
          {label:"Custom pay rules",value:rows(data.rules).filter(r=>r.active).length,detail:"Service-specific rates"},
        ]}/>
        <div className="studio-section-bar"><h2>Your people</h2><span>Work, pay & profiles</span></div>
        <StudioCollection cards={list.map(r=>({id:s(r.id),title:s(r.name),subtitle:s(r.position) || "Team member",badge:status(r.active?"active":"inactive"),facts:[
          {label:"Email",value:s(r.email)||"Not set"},{label:"This week",value:`${(n(r.scheduled_minutes)/60).toFixed(1)} hours`},
          {label:"Phone",value:s(r.phone)||"Not set"},{label:"Workspace access",value:!r.user_id?"Not linked":!r.login_active?"Disabled":accessRoleLabel(s(r.login_role)||"staff")},
        ],content:<PayPlanSummary employee={r} rules={rows(data.rules)}/>,actions:<>
          {allowedSections.includes("payroll") && !staff && <button className="button" aria-label={`Work history for ${s(r.name)}`} onClick={()=>setEmployeeHistory({id:s(r.id),name:s(r.name)})}>Work history</button>}
          {((allowedSections.includes("payroll")&&!staff)||user.role==="owner"||(s(r.login_role)!=="owner"&&(user.role!=="manager"||!r.user_id||s(r.login_role)==="staff")))&&<details className="admin-action-menu"><summary aria-label={`Manage employee ${s(r.name)}`}>Manage</summary><div className="admin-action-menu-content">
            {(user.role==="owner"||(s(r.login_role)!=="owner"&&(user.role!=="manager"||!r.user_id||s(r.login_role)==="staff")))&&<button onClick={()=>employeeEdit({...r,hourly_rate_cents:n(r.hourly_rate_cents)/100,availability:employeeAvailability.filter(a=>s(a.employee_id)===s(r.id))})}>Edit profile</button>}
            {allowedSections.includes("payroll")&&!staff&&<button aria-label={`Pay settings for ${s(r.name)}`} onClick={()=>compensationEdit(r)}>Pay settings</button>}
            {(user.role==="owner"||(s(r.login_role)!=="owner"&&(user.role!=="manager"||!r.user_id||s(r.login_role)==="staff")))&&<EmployeeAccessLink employeeId={s(r.id)} employeeName={s(r.name)} email={s(r.email)} hasLogin={!!r.user_id} disabled={!r.active}/>}
          </div></details>}
        </>}))}/>
      </>}
      {section === "employees" && <details className="paper admin-secondary-panel"><summary><span>Training &amp; employee resources</span><small>Videos, checklists and documents</small></summary><div className="admin-secondary-panel-content"><EmployeeResources manage /></div></details>}
      {section === "team" && (
        <>
          <details className="paper admin-secondary-panel"><summary>Roles & access guide</summary><div className="admin-secondary-panel-content">
            <div className="section-heading">
              <div><p className="eyebrow">ACCESS CONTROL</p><h2>Team logins &amp; roles</h2></div>

            </div>
            <p className="small-note">Every person uses their own email and password. Detailer accounts are automatically linked to an employee profile so their published shifts, assigned work and time clock appear in My Schedule.</p>
            <div className="role-permissions-grid">
              <div><strong>Owner</strong><p>Full business access, including finances and team permissions. Only an owner can create or change another owner.</p></div>
              <div><strong>Admin</strong><p>Full business access, including finances and account management. Cannot grant or change owner access.</p></div>
              <div><strong>Manager</strong><p>Runs bookings, customers, employees, schedules, hours, payroll and daily operations. No account management or marketing finances.</p></div>
              <div><strong>Detailer</strong><p>My Schedule only: published shifts, assigned work and personal time clock. No customer lists, business calendar, payroll or reports.</p></div>
            </div>
          </div></details>
          <section className="paper">
            <div className="section-heading"><button className="button" onClick={()=>teamEdit()}>Create login</button><div><p className="eyebrow">AUTHORIZED USERS</p><h2>{list.filter((member) => member.active).length} active logins</h2></div><Link className="text-link" href={params.get("removed")==="1"?"/admin/team":"/admin/team?removed=1"}>{params.get("removed")==="1"?"Hide removed people":"Show removed people"}</Link></div>
            {table(
              ["Team member", "Role", "Employee profile", "Status", "Action"],
              list.map((member) => [
                <><strong>{s(member.name)}</strong><small>{s(member.email)}</small></>,
                accessRoleLabel(member.role),
                member.employee_id ? <><strong>{s(member.position) || "Employee"}</strong><small>{s(member.phone) || "Phone not set"}</small></> : s(member.role) === "staff" ? "Profile missing" : "Not required",
                status(member.removed_at?"removed":member.active ? "active" : "disabled"),
                (user.role === "owner" || member.role !== "owner") ? <>{!member.removed_at&&<button onClick={() => teamEdit(member)}>Edit access</button>}{member.id!==user.user_id&&<RemoveTeamMember id={s(member.id)} name={s(member.name)} removed={!!member.removed_at}/>}</> : "Owner only",
              ]),
            )}
          </section>
        </>
      )}
      {section === "schedule" && (
        <>
          <section className="paper">
            <div className="section-heading"><div><p className="eyebrow">WEEKLY ROSTER</p><h2>Schedule week of {s(data.week)}</h2></div><div className="button-row"><button className="button" onClick={() => shiftEdit()} disabled={!scheduleEmployees.length}>Add shift</button><details className="admin-action-menu"><summary>Schedule actions</summary><div className="admin-action-menu-content"><p className="small-note">Create draft shifts from availability, then publish them to your team.</p><button disabled={busy || !scheduleEmployees.length} onClick={() => run("generate_schedule", { week: s(data.week), start_minute: 540, end_minute: 1020 }, "Draft shifts created from availability.")}>Generate week</button><button disabled={busy} onClick={() => run("publish_schedule", { week: s(data.week) }, "Schedule published. Notification status is recorded below.")}>Publish schedule</button></div></details></div></div>
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
          <details className="paper admin-secondary-panel"><summary><span>Appointments this week</span><small>{rows(data.workload).reduce((total, row) => total + n(row.bookings), 0)} bookings</small></summary><div className="admin-secondary-panel-content">{table(["Date", "Bookings"], rows(data.workload).map((r) => [s(r.booking_date), s(r.bookings)]))}</div></details>
          <details className="paper admin-secondary-panel"><summary><span>Employee notifications</span><small>{rows(data.notifications).length ? `${rows(data.notifications).length} updates` : "No updates yet"}</small></summary><div className="admin-secondary-panel-content">{table(["Employee", "Channel", "Status", "Details"], rows(data.notifications).map((r) => [s(r.name), s(r.channel).toUpperCase(), status(r.status), s(r.error) || "Queued for delivery"]))}{!(data.integrations as R | undefined)?.sms && <p className="small-note">SMS notifications are not connected yet. Published shifts are still available in each employee’s schedule.</p>}</div></details>
        </>
      )}
      {section === "hours" && <>
        <StudioSnapshot items={[{label:"Hours in view",value:`${(list.reduce((sum,r)=>sum+n(r.worked_minutes),0)/60).toFixed(1)}h`},{label:"Completed entries",value:list.filter(r=>r.clock_out).length},{label:"Awaiting approval",value:list.filter(r=>r.clock_out&&!r.approved).length},{label:"Still clocked in",value:list.filter(r=>!r.clock_out).length}]}/>
        <section className="paper">
          <div className="section-heading"><div><p className="eyebrow">TIME REVIEW</p><h2>Actual worked hours</h2></div></div>
          <form className="toolbar"><label className="field"><span>From</span><input name="start" type="date" defaultValue={s(data.start)} /></label><label className="field"><span>To</span><input name="end" type="date" defaultValue={s(data.end)} /></label><button className="button">Load hours</button></form>
          {table(["Employee", "Clock in", "Clock out", "Break", "Worked", "Approval"], list.map((r) => [<><strong>{s(r.name)}</strong><small>{s(r.position)}</small></>, stamp(r.clock_in), r.clock_out ? stamp(r.clock_out) : "Currently clocked in", n(r.break_minutes) + " min", (n(r.worked_minutes) / 60).toFixed(2) + "h", r.approved ? "Approved" : <button disabled={busy || !r.clock_out} onClick={() => run("approve_time", { id: r.id }, "Time entry approved.")}>Approve</button>]))}
        </section>
      </>}
      {section === "payroll" && allowedSections.includes("payroll") && !staff && (
        <section className="paper payroll-workspace">
          <div className="section-heading"><div><p className="eyebrow">PAYROLL ESTIMATE</p><h2>Employee earnings</h2></div><div className="button-row"><button disabled={!rows(data.employees).length} onClick={() => compensationEdit()}>Manage pay plans</button><a className="button" href={`/api/manage?section=payroll&export=csv&start=${encodeURIComponent(s(data.start))}&end=${encodeURIComponent(s(data.end))}`}>Export CSV</a></div></div>
          <form className="toolbar"><label className="field"><span>From</span><input name="start" type="date" defaultValue={s(data.start)} /></label><label className="field"><span>To</span><input name="end" type="date" defaultValue={s(data.end)} /></label><button className="button">Calculate</button></form>
          <details className="payroll-explanation"><summary>How earnings are calculated</summary><p className="small-note">Paid hours use completed clock entries when present. If none exist for an employee in this period, scheduled shift hours are used as the payable fallback. Job pay follows each employee’s saved plan or service rule, using the final service price excluding tips and the employee’s share of the job. Tips are allocated separately.</p></details>
          <PayrollList records={list} employees={rows(data.employees)} rules={rows(data.rules)} onHistory={r => setEmployeeHistory({ id: s(r.id), name: s(r.name), start: s(data.start), end: s(data.end) })} onPaySettings={compensationEdit} />
        </section>
      )}
      {section === "performance" && <>
        <form className="toolbar studio-filter-surface"><label className="field"><span>From</span><input name="start" type="date" defaultValue={s(data.start)}/></label><label className="field"><span>To</span><input name="end" type="date" defaultValue={s(data.end)}/></label><button className="button">Apply dates</button></form>
        <StudioSnapshot items={[{label:"Completed assignments",value:list.reduce((sum,r)=>sum+n(r.jobs_completed),0),detail:"Jobs can have multiple employees"},{label:"Paid hours",value:`${(list.reduce((sum,r)=>sum+n(r.minutes),0)/60).toFixed(1)}h`},{label:"Attributed revenue",value:money(list.reduce((sum,r)=>sum+n(r.attributed_revenue),0))},{label:"Estimated earnings",value:money(list.reduce((sum,r)=>sum+n(r.total_earnings_cents),0))}]}/>
        <StudioCollection cards={list.map(r=>({id:s(r.id),title:s(r.name),subtitle:s(r.position),facts:[{label:"Completed jobs",value:n(r.jobs_completed)},{label:"Estimated earnings",value:money(n(r.total_earnings_cents))},{label:"Paid hours",value:`${(n(r.minutes)/60).toFixed(2)}h`},{label:"Service revenue",value:money(n(r.attributed_revenue))}],content:<details><summary>Earnings & productivity</summary><div className="studio-metric-list">{[["Job commission",money(n(r.commission_cents))],["Tips",money(n(r.tips_cents))],["Hourly pay",money(n(r.hourly_earnings_cents))],["Revenue per hour",n(r.minutes)?money(Math.round(n(r.attributed_revenue)/(n(r.minutes)/60))):"No paid hours"],["Average job",n(r.jobs_completed)?money(Math.round(n(r.attributed_revenue)/n(r.jobs_completed))):"No completed jobs"]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></details>,actions:<button className="button" aria-label={`Work history for ${s(r.name)}`} onClick={()=>setEmployeeHistory({id:s(r.id),name:s(r.name),start:s(data.start),end:s(data.end)})}>Work history</button>}))}/>
        <p className="small-note">Completed jobs, attributed revenue, allocated tips and completed clock entries. These are operational totals, not employee scores.</p>
      </>}
      {section === "my_schedule" && !data.employee && (
        <section className="paper empty-state">
          <p className="eyebrow">EMPLOYEE WORKSPACE</p>
          <h2>This login is not linked to a detailer profile.</h2>
          <p>Your manager can open Employees, edit your profile with the same login email, and enable Active employee. Your published shifts, assigned jobs and time clock will then appear here.</p>
          {user.role !== "staff" && <Link className="button" href="/admin/employees">Open employees</Link>}
        </section>
      )}
      {section === "my_schedule" && !!data.employee && (
        <StaffWorkspace data={data} busy={busy} onClock={clock} onViewJob={bookingEdit} onJobStatus={(job, nextStatus) => { void run("update_booking", { id: job.id, status: nextStatus }, nextStatus === "completed" ? "Job marked complete." : "Job started."); }} />
      )}
      {section === "my_schedule" && <details className="paper admin-secondary-panel"><summary><span>Training &amp; documents</span><small>Videos, checklists and personal resources</small></summary><div className="admin-secondary-panel-content"><EmployeeResources /></div></details>}
      {data.squareEnvironment==="sandbox"&&<p className="notice" role="status"><strong>Square sandbox testing.</strong> Payment links use test money. Sandbox transactions are excluded from live revenue reports.</p>}
      {section === "expenses" && (()=>{const summary=data.summary as R;return <>
        <StudioSnapshot items={[{label:"Operating expenses",value:money(n(summary?.total_cents)),detail:`${s(data.start)} – ${s(data.end)}`},{label:"Recurring",value:money(n(summary?.recurring_cents))},{label:"One-time",value:money(n(summary?.one_time_cents))},{label:"Categories",value:rows(summary?.byCategory).length}]}/>
        <form className="toolbar studio-filter-surface"><label className="field"><span>Period</span><select name="range" defaultValue={params.get("range")||"year"}>{[["1","Today"],["week","This week"],["month","This month"],["30","Last 30 days"],["90","Last 90 days"],["year","This year"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="field"><span>From</span><input name="from" type="date" defaultValue={params.get("from")||""}/></label><label className="field"><span>To</span><input name="to" type="date" defaultValue={params.get("to")||""}/></label><label className="field"><span>Search</span><input name="search" defaultValue={params.get("search")||""} placeholder="Vendor, category…"/></label><button className="button">Apply</button></form>
        <nav className="studio-view-switch" aria-label="Expense view"><button aria-pressed={expenseView==="records"} onClick={()=>setExpenseView("records")}>Expense records</button><button aria-pressed={expenseView==="breakdown"} onClick={()=>setExpenseView("breakdown")}>Spending breakdown</button></nav>
        {expenseView==="records"?<section className="paper"><div className="studio-section-bar"><h2>Expense ledger</h2><span>{list.length} records</span></div>{table(["Vendor & details","Date","Category","Amount","Actions"],list.map(row=>[<><strong>{s(row.vendor)||"No vendor"}</strong><small>{s(row.description)}</small><details><summary>Payment details</summary><p>{s(row.funding_source)} · {s(row.payment_account)||"No account"} · {s(row.payment_method)}</p><p>{title(s(row.recurrence))}</p><p>Marketing source: {({"business-google":"Business Google","business-meta":"Business Meta","dima-google":"Partner Google"} as Record<string,string>)[s(row.marketing_stream)] || marketingStreamLabel(s(row.marketing_stream)) || "Not assigned"}</p>{!!row.receipt_url&&<a href={s(row.receipt_url)} target="_blank" rel="noopener noreferrer">View receipt</a>}</details></>,s(row.expense_date),s(row.category),<strong>{money(n(row.amount_cents))}</strong>,<><button onClick={()=>expenseEdit(row)}>Edit</button><button className="link-button" onClick={()=>run("delete_expense",{id:row.id},"Expense deleted.")}>Delete</button></>]))}</section>:<div className="studio-two-column"><SpendBars title="Where the money goes" items={rows(summary?.byCategory).map(r=>({label:s(r.category),amount_cents:n(r.amount_cents)}))}/><SpendBars title="Top vendors" items={rows(summary?.byVendor).map(r=>({label:s(r.label),amount_cents:n(r.amount_cents)}))}/><SpendBars title="Funding sources" items={rows(summary?.byFunding).map(r=>({label:s(r.label),amount_cents:n(r.amount_cents)}))}/><SpendBars title="Accounts" items={rows(summary?.byAccount).map(r=>({label:s(r.label),amount_cents:n(r.amount_cents)}))}/></div>}
        <details className="paper admin-secondary-panel"><summary><span>All category totals</span><small>{rows(summary?.byCategory).length} categories</small></summary><div className="admin-secondary-panel-content"><p className="small-note">Complete expense totals for {s(data.start)} – {s(data.end)}.</p><div className="studio-metric-list">{rows(summary?.byCategory).map(row=><div key={s(row.category)}><span>{s(row.category)||"Uncategorised"}</span><strong>{money(n(row.amount_cents))}</strong></div>)}</div>{!rows(summary?.byCategory).length&&<p className="small-note">No expenses in this period.</p>}</div></details>
        <details className="paper admin-secondary-panel"><summary>How expenses are counted</summary><div className="admin-secondary-panel-content"><p>Recurring items are calculated for the selected period without duplicate records. Linked inventory purchases count once.</p><Link className="studio-soft-link" href={`/admin/reports?from=${encodeURIComponent(s(data.start))}&to=${encodeURIComponent(s(data.end))}`}>Open profitability report</Link></div></details>
      </>})()}
      {section === "inventory" && (()=>{const summary=data.summary as R;return <>
        <StudioSnapshot items={[{label:"Active products",value:s(summary?.items)},{label:"Stock value",value:money(n(summary?.value_cents)),detail:"Quantity × cost basis"},{label:"Running low",value:s(summary?.low_stock)},{label:"Out of stock",value:s(summary?.out_of_stock)}]}/>
        <form className="toolbar studio-filter-surface"><label className="field"><span>Find a product</span><input name="search" defaultValue={params.get("search")||""} placeholder="Product, SKU or supplier"/></label><button className="button">Search inventory</button></form>
        <StudioCollection kind="stock" cards={list.map(item=>({id:s(item.id),title:s(item.name),subtitle:s(item.sku)||s(item.category),mark:"▧",badge:<span className={`inventory-status ${s(item.stock_status)}`}>{title(s(item.stock_status))}</span>,facts:[{label:"In stock",value:`${s(item.quantity)} ${s(item.unit)}`},{label:"Stock value",value:money(n(item.quantity)*n(item.unit_cost_cents))},{label:"Supplier",value:s(item.supplier)||"Not set"},{label:"Category",value:s(item.category)||"Uncategorised"}],actions:<><button className="button" onClick={()=>movementEdit(item)}>Stock movement</button><details className="admin-action-menu"><summary>Manage</summary><div className="admin-action-menu-content"><button onClick={()=>inventoryEdit(item)}>Edit product</button><Link href={`/admin/inventory?id=${s(item.id)}`} className="text-link">View history</Link></div></details></>}))}/>
        {params.get("id")&&<section className="paper"><h2>Movement history</h2>{table(["Date","Item","Type","Change","Recorded by","Notes"],rows(data.movements).map(m=>[s(m.occurred_on),s(m.item_name),title(s(m.movement_type)),`${n(m.quantity)>0?"+":""}${s(m.quantity)}`,s(m.user_name)||"System",s(m.notes)||"—"]))}</section>}
      </>})()}
      {reportMode && rep && !["dashboard", "marketing"].includes(section) && <StudioReports report={rep} section={section} allowedSections={allowedSections}/>}
      {!reportMode &&
        ["bookings", "customers", "leads", "calendar", "payments"].includes(
          section,
        ) && (section !== "payments" || paymentView === "collect") && (
          <>
          <button
            className="admin-filter-toggle"
            aria-label="Search & filters"
            type="button"
            aria-expanded={recordFiltersOpen}
            aria-controls="admin-record-filters"
            onClick={() => setRecordFiltersOpen((open) => !open)}
          >
            Search &amp; filters
          </button>
          <form id="admin-record-filters" className={`toolbar admin-filter-panel${recordFiltersOpen ? " is-open" : ""}`}>
            {section === "payments" && <input type="hidden" name="payment_view" value={paymentView} />}
            {((section === "customers" && archivedCustomers) || archivedBookings) && <input type="hidden" name="archived" value="1" />}
            <label className="field">
              <span>{section === "payments" ? "Search website appointments" : "Search records"}</span>
              <input
                name="search"
                placeholder="Name, reference..."
                defaultValue={params.get("search") || ""}
              />
            </label>
            {["bookings", "calendar", "payments"].includes(section) && (
              <>
                <label className="field">
                  <span>{section === "payments" ? "Appointment date" : "Date"}</span>
                  <input
                    type="date"
                    name="date"
                    defaultValue={params.get("date") || ""}
                  />
                </label>
                <label className="field">
                  <span>{section === "payments" ? "Appointment status" : "Status"}</span>
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
            <Link className="text-link" href={"/admin/" + section + (section === "payments" ? `?payment_view=${paymentView}` : (section === "customers" && archivedCustomers) || archivedBookings ? "?archived=1" : "")}>
              Clear
            </Link>
          </form>
          </>
        )}
      {section === "bookings" && (
        <>
          <div className="booking-viewbar">
            <label><span>Show</span><select aria-label="Booking view" value={archivedBookings ? "archived" : params.get("status") || (params.get("date") === dateToday() ? "today" : params.get("view") || "all")} onChange={event => {
              const view = event.target.value;
              const query = view === "all" ? "" : view === "today" ? `?date=${dateToday()}` : ["upcoming", "past"].includes(view) ? `?view=${view}` : view === "archived" ? "?archived=1" : `?status=${view}`;
              router.push(`/admin/bookings${query}`);
            }}><option value="all">All bookings</option><option value="today">Today</option><option value="upcoming">Upcoming</option><option value="past">Past appointments</option><option value="new">New</option><option value="confirmed">Booked</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_show">No-shows</option>{canArchiveCustomers && <option value="archived">Archived customer appointments</option>}</select></label>
            <span>{s(data.total)} {n(data.total) === 1 ? "booking" : "bookings"}</span>
          </div>
          {archivedBookings && <p className="small-note">Appointments for archived customers. Payment history remains available in Payments. Restore a customer from Customers → Archived records to return their appointments to the main list.</p>}
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
      {section === "services" && <>
        <StudioSnapshot items={[{label:"Services in view",value:list.length},{label:"Available to book",value:list.filter(r=>r.active).length},{label:"By consultation",value:list.filter(r=>r.pricing_mode==="quote").length},{label:"Categories",value:new Set(list.map(r=>s(r.category))).size}]}/>
        <StudioCollection kind="services" cards={list.map(r=>({id:s(r.id),title:s(r.name),subtitle:s(r.category),mark:"◇",badge:status(r.active?"active":"disabled"),facts:[{label:"Starting price",value:r.pricing_mode==="quote"?"By quote":money(n(r.price_cents))},{label:"Appointment",value:`${n(r.duration_minutes)/60}h`}],content:<span>{title(s(r.pricing_mode))} pricing · Display order {s(r.sort_order)}</span>,actions:<button className="button" onClick={()=>serviceEdit(r)}>Edit service</button>}))}/>
      </>}
      {["customers","leads"].includes(section)&&<details className="studio-tag-library"><summary>Manage labels</summary><CrmTagLibrary tags={crmTagRows(data.tags)}/></details>}
      {section === "customers" && (
        <>
          {canArchiveCustomers && <nav className="filter-tabs" aria-label="Customer records">
            <Link href="/admin/customers" className={!archivedCustomers ? "active" : undefined} aria-current={!archivedCustomers ? "page" : undefined}>Active customers</Link>
            <Link href="/admin/customers?archived=1" className={archivedCustomers ? "active" : undefined} aria-current={archivedCustomers ? "page" : undefined}>Archived records</Link>
          </nav>}
          {archivedCustomers && <p className="small-note">Archived customers are excluded from the active list and promotional campaigns. Their bookings and payments remain available.</p>}
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
                <div className="button-row">
                  <button className="button" onClick={() => customerEdit(profile.customer)}>Edit profile</button>
                  {canArchiveCustomers && <ArchiveCustomer kind="customer" id={s(profile.customer.id)} name={[s(profile.customer.first_name), s(profile.customer.last_name)].filter(Boolean).join(" ") || s(profile.customer.email) || "customer"} archived={Boolean(profile.customer.archived_at)} onChanged={refreshCustomers} />}
                </div>
              </div>
              {Boolean(profile.customer.archived_at) && <p role="status" className="small-note">Archived on {stamp(profile.customer.archived_at)}. This customer is excluded from promotional campaigns.</p>}
              <RecordTags kind="customer" id={s(profile.customer.id)} tags={crmTagRows(profile.customer.tags)} catalog={crmTagRows(data.tags)}/>
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
          <StudioSnapshot items={[{label:"Customers in view",value:list.length},{label:"With appointments",value:list.filter(r=>n(r.booking_count)>0).length},{label:"Upcoming visits",value:list.filter(r=>r.upcoming_booking).length},{label:"Lifetime spend",value:money(list.reduce((total,r)=>total+n(r.total_spent),0)),detail:"Customers in this view"}]}/>
          <StudioCollection cards={list.map(r=>({id:s(r.id),title:[s(r.first_name),s(r.last_name)].filter(Boolean).join(" ")||s(r.email)||"Customer",subtitle:s(r.email)||s(r.phone),facts:[{label:"Visits booked",value:n(r.booking_count)},{label:"Lifetime spend",value:money(n(r.total_spent))},{label:"Last visit",value:s(r.last_booking)||"No past visit"},{label:"Next visit",value:s(r.upcoming_booking)||"Not booked"}],content:<><span>{s(r.phone)}</span><RecordTags kind="customer" id={s(r.id)} tags={crmTagRows(r.tags)} catalog={crmTagRows(data.tags)}/><small>Customer since {stamp(r.created_at)}</small></>,actions:<><Link className="button" href={"/admin/customers?id="+s(r.id)+(archivedCustomers?"&archived=1":"")}>Open profile</Link>{canArchiveCustomers&&<ArchiveCustomer kind="customer" id={s(r.id)} name={[s(r.first_name),s(r.last_name)].filter(Boolean).join(" ")||s(r.email)||"customer"} archived={Boolean(r.archived_at)} onChanged={refreshCustomers}/>}</>}))}/>

        </>
      )}
      {section === "customers" && canArchiveCustomers && <SquareCustomerHistory onImported={refreshCustomers} refreshKey={customerArchiveVersion} />}
      {section === "leads" && <>
        <StudioSnapshot items={[{label:"Enquiries in view",value:list.length},{label:"New",value:list.filter(r=>r.status==="new").length},{label:"Won",value:list.filter(r=>r.status==="won").length},{label:"Callbacks requested",value:list.filter(r=>r.call_customer).length}]}/>
        <StudioCollection kind="leads" cards={list.map(r=>({id:s(r.id),title:s(r.name)||"New enquiry",subtitle:s(r.source)||"Source unknown",badge:status(r.status==="won"?"sold":r.status),facts:[{label:"Phone",value:r.phone?<a href={"tel:"+s(r.phone)}>{s(r.phone)}</a>:"Not provided"},{label:"Email",value:r.email?<a href={"mailto:"+s(r.email)}>{s(r.email)}</a>:"Not provided"}],content:<>
          {!!r.call_customer&&<span className="status-pill">Callback requested</span>}
          <RecordTags kind="lead" id={s(r.id)} tags={crmTagRows(r.tags)} catalog={crmTagRows(data.tags)}/>
          <details><summary>Details & activity</summary><p>{marketingStreamLabel(s(r.lead_stream))}{r.campaign?` · ${s(r.campaign)}`:""}</p><p className="lead-answers">{s(r.notes)||"No notes"}</p>{rows(r.activity).map((a,i)=><p key={i}>{s(a.body)}<small>{stamp(a.created_at)}</small></p>)}</details><LeadOutcome id={s(r.id)}/>
        </>,actions:<><button className="button" onClick={()=>{setLead({id:s(r.id),name:s(r.name),email:s(r.email),phone:s(r.phone)});setCreating(true);}}>Book a visit</button><details className="admin-action-menu"><summary>More</summary><div className="admin-action-menu-content"><button onClick={()=>leadEdit(r)}>Edit enquiry</button>{!r.customer_id&&<button disabled={busy} onClick={()=>run("convert_lead",{id:r.id})}>Create customer</button>}{!!r.phone&&<a className="text-link" href={"sms:"+s(r.phone)}>Send SMS</a>}</div></details></>}))}/>
        <details className="paper admin-secondary-panel"><summary>Phone tracking & connected forms</summary><div className="admin-secondary-panel-content"><p>Calls to one shared number cannot identify a caller’s source. Use Phone call · source unknown until a tracking number or call report confirms it.</p><p className="small-note">Dedicated tracking numbers can forward to your existing number. Website phone clicks measure intent, not answered calls.</p>{allowedSections.includes("marketing")&&<MetaLeadForms/>}</div></details>
      </>}
      {section === "payments" && (
        <>
          <nav className="studio-view-switch" aria-label="Payment view">{[["square","Square transactions"],["website","Website payments"],["collect","Collect a payment"]].map(([id,label])=><button key={id} aria-pressed={paymentView===id} onClick={()=>setPaymentView(id)}>{label}</button>)}</nav>
          {data.square != null && <details className="paper admin-secondary-panel"><summary>Square connection & sync</summary><div className="admin-secondary-panel-content"><SquareRevenue connection={data.square as Awaited<ReturnType<typeof squareRevenueStatus>>}/></div></details>}
          {paymentView==="square"&&<section className="paper">
          <h2>{params.get("squareArchive")==="1"?"All imported Square accounts":"Current Square account transactions"}</h2><p><Link className="text-link" href={params.get("squareArchive")==="1"?"/admin/payments":"/admin/payments?squareArchive=1"}>{params.get("squareArchive")==="1"?"Back to current account":"View previous accounts / imported history"}</Link></p>
          <p className="small-note">Previous-account history is retained in the archive. Only the connected account’s completed production payments in USD count toward current Square revenue. Amounts include tips; processing fees are listed separately.</p>
          {table(
            ["Payment date", "Amount", "Refunded", "Tips", "Fees", "Status", "Source / location", "Transaction"],
            rows(data.squarePayments).map((payment) => [
              stamp(payment.paid_at || payment.created_at),
              `${s(payment.currency)} ${(n(payment.amount_cents) / 100).toFixed(2)}`,
              (n(payment.refunded_cents) / 100).toFixed(2),
              (n(payment.tip_cents) / 100).toFixed(2),
              (n(payment.processor_fee_cents) / 100).toFixed(2),
              <>{status(payment.status)}<small>{s(payment.environment) === "sandbox" ? "Sandbox · excluded" : s(payment.currency) !== "USD" ? "Non-USD · excluded" : "Production"}</small></>,
              <>{s(payment.source_type) || "Square"}<small>{s(payment.location_id)}</small></>,
              <>{s(payment.payment_id)}<small>{s(payment.payment_method)}</small></>,
            ]),
          )}
          <nav className="toolbar" aria-label="Square transaction pages">
            {Number(params.get("squarePage") || 1) > 1 && <Link className="text-link" href={`/admin/payments?${params.get("squareArchive")==="1"?"squareArchive=1&":""}squarePage=${Math.max(1, Number(params.get("squarePage") || 1) - 1)}`}>Newer payments</Link>}
            <span className="small-note">Page {Math.max(1, Number(params.get("squarePage")) || 1)} · up to 100 payments per page</span>
            {rows(data.squarePayments).length === 100 && <Link className="text-link" href={`/admin/payments?${params.get("squareArchive")==="1"?"squareArchive=1&":""}squarePage=${Math.max(1, Number(params.get("squarePage")) || 1) + 1}`}>Older payments</Link>}
          </nav>
          </section>}
          {paymentView==="website"&&<section className="paper"><h2>Website payment records</h2>
          <p className="small-note">
            Website invoices are shown separately for appointment management. Square records above and their matching website invoices count once in revenue. A checkout redirect never marks an appointment paid.
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
              s(r.provider) + (s(r.external_id) ? " · " + s(r.external_id) : " · Pending"),
              stamp(r.paid_at),
            ]),
          )}
          </section>}
          {paymentView==="collect"&&<section className="paper"><h2>Collect payment</h2>
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
          </section>}
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
      {section === "reviews" && <>
        <StudioSnapshot items={[{label:"Requests in view",value:list.length},{label:"Feedback received",value:list.filter(r=>r.rating).length},{label:"Published",value:list.filter(r=>r.status==="published").length},{label:"Awaiting response",value:list.filter(r=>!r.rating).length}]}/>
        <StudioCollection cards={list.map(r=>({id:s(r.id),title:s(r.name)||"Customer",subtitle:stamp(r.created_at),badge:status(r.status),content:<><p className="studio-review-rating">{r.rating?`${s(r.rating)} / 5`:"Awaiting feedback"}</p><p>{s(r.text)||"The customer has not submitted their review yet."}</p></>,actions:r.rating?<><button className="button" disabled={busy} onClick={()=>run("publish_review",{id:r.id,status:"published"})}>Publish</button><button disabled={busy} onClick={()=>run("publish_review",{id:r.id,status:"hidden"})}>Hide</button></>:undefined}))}/>
        <p className="small-note">Review requests belong to completed appointments. Only genuine submitted feedback can be published.</p>
      </>}
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
      {!reportMode &&
        [
          "bookings",
          "customers",
          "leads",
          "reviews",
          "messages",
          "payments",
        ].includes(section) && (section !== "payments" || paymentView === "collect") && (
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
      {paySettings && <EmployeePaySettings employeeId={paySettings.employeeId} onClose={() => setPaySettings(null)} />}
      {employeeHistory && <EmployeeJobHistory employeeId={employeeHistory.id} employeeName={employeeHistory.name} start={employeeHistory.start} end={employeeHistory.end} onClose={() => setEmployeeHistory(null)} />}
      {expense && <ExpenseEditor initial={expense} directory={data.expenseDirectory as ExpenseDirectory} onClose={() => setExpense(null)} />}
      {openedJob && <JobWorkspace booking={openedJob} employees={rows(data.employees)} rules={rows(data.payRules)} services={rows(data.services)} canPay={allowedSections.includes("payroll")} canCollect={allowedSections.includes("payments")} staff={staff} environment={s(data.squareEnvironment)} onClose={() => setOpenedJob(null)} onEditAppointment={(job) => {setOpenedJob(null); bookingEdit(job);}} />}
      {editor && (
        <Editor
          key={editor.title + s(editor.initial.id)}
          spec={editor}
          onClose={() => setEditor(null)}
        />
      )}
      {creating && (
        <Modal
          title={lead ? "Book for " + lead.name : "New booking"}
          onClose={closeCreating}
          wide
        >
          <SalesBookingForm
            services={rows(data.services) as unknown as Service[]}
            business={business}
            lead={lead}
            onComplete={() => {
              closeCreating();
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
      <div className="calendar-scroll" data-view={view}>
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
