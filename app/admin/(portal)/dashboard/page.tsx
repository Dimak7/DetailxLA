import type { ReactNode } from "react";
import Link from "next/link";
import { AdminErrorBanner, AdminPageHeader, FlashMessage, StatusBadge } from "@/components/admin/AdminShell";
import { loadAdminData } from "@/lib/adminPageData";
import {
  addDays,
  formatMoney,
  getBookingAmount,
  getBookingDetails,
  getDashboardAnalytics,
  getDashboardMetrics,
  getDateString,
} from "@/lib/adminData";
import { listBookings, type StoredBooking } from "@/lib/bookingStore";
import { getBusinessMetricsSettings } from "@/lib/businessMetricsStore";
import { listInvoices } from "@/lib/invoiceStore";

export const dynamic = "force-dynamic";

const timelineOptions = [7, 30, 60, 90] as const;

type AnalyticsPoint = {
  date: string;
  revenue: number;
  bookings: number;
};

type NamedValue = {
  label: string;
  value: number;
  displayValue?: string;
};

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ adminStatus?: string; adminMessage?: string; range?: string }>;
}) {
  const params = await searchParams;
  const days = parseTimelineRange(params?.range);
  const [bookingsState, invoicesState, businessSettingsState] = await Promise.all([
    loadAdminData("dashboard bookings", () => listBookings(), [], "Dashboard booking data is temporarily unavailable. The error was logged on the server."),
    loadAdminData("dashboard invoices", () => listInvoices(), [], "Dashboard invoice data is temporarily unavailable. The error was logged on the server."),
    loadAdminData("dashboard business settings", () => getBusinessMetricsSettings(), { marketingExpense: 0, updatedAt: new Date(0).toISOString() }),
  ]);
  const bookings = bookingsState.data;
  const invoices = invoicesState.data;
  const businessSettings = businessSettingsState.data;
  const metrics = getDashboardMetrics(bookings);
  const analytics = getDashboardAnalytics(bookings, { days, marketingExpense: businessSettings.marketingExpense });
  const activeBookings = bookings.filter((booking) => booking.status !== "cancelled");
  const unpaidInvoices = invoices.filter((invoice) => invoice.status !== "paid" && invoice.status !== "cancelled");
  const today = getDateString(new Date());
  const tomorrow = getDateString(addDays(new Date(), 1));
  const upcomingSoon = activeBookings
    .filter((booking) => booking.date === today || booking.date === tomorrow)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 5);
  const recentActivity = [...bookings]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  const serviceBreakdown = getServiceBreakdown(activeBookings);
  const revenueBreakdown = getRevenueBreakdown(activeBookings);
  const clientGrowth = getClientGrowthSeries(activeBookings, days);
  const summaryCards = [
    {
      label: "Total Revenue",
      value: formatMoney(analytics.revenue),
      helper: `${days}-day booked revenue`,
      trend: analytics.series.map((point) => point.revenue),
    },
    {
      label: "Total Clients",
      value: analytics.totalClients.toLocaleString("en-US"),
      helper: "Unique customers in range",
      trend: clientGrowth.map((point) => point.value),
    },
    {
      label: "Completed Jobs",
      value: metrics.completedCount.toLocaleString("en-US"),
      helper: "Finished booking history",
      trend: analytics.series.map((point) => point.bookings),
    },
    {
      label: "Pending Jobs",
      value: metrics.pendingCount.toLocaleString("en-US"),
      helper: "Needs confirmation",
      trend: analytics.series.map((point) => point.bookings),
    },
  ];
  const statusOverview = [
    { label: "Pending", value: metrics.pendingCount, tone: "bg-yellow-100 text-yellow-900" },
    { label: "Confirmed", value: bookings.filter((booking) => booking.status === "confirmed").length, tone: "bg-blue-100 text-blue-900" },
    { label: "Completed", value: metrics.completedCount, tone: "bg-green-100 text-green-900" },
    { label: "Cancelled", value: metrics.cancelledCount, tone: "bg-red-soft text-red" },
    { label: "Unpaid invoices", value: unpaidInvoices.length, tone: "bg-ink text-white" },
  ];

  return (
    <>
      <FlashMessage status={params?.adminStatus} message={params?.adminMessage} />
      <AdminErrorBanner message={bookingsState.error || invoicesState.error || businessSettingsState.error} />
      <AdminPageHeader
        eyebrow="Analytics"
        title="Business Dashboard"
        copy="A compact view of bookings, revenue, clients, and upcoming work."
        action={<Link className="rounded-lg bg-red px-5 py-4 text-center font-black uppercase text-white shadow-sm" href="/admin/schedule">Open Schedule</Link>}
      />

      <section className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-ink/10 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-red">Performance Window</p>
            <h2 className="mt-2 text-2xl font-black uppercase leading-none text-ink">DETAILX operating snapshot</h2>
            <p className="mt-2 text-sm font-bold text-steel">
              {formatDisplayDate(analytics.rangeStart)} - {formatDisplayDate(analytics.rangeEnd)}
            </p>
          </div>
          <TimeframeControl days={days} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <MetricCard key={card.label} {...card} />
          ))}
        </div>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <AnalyticsCard
          eyebrow="Job Activity"
          title="Bookings over time"
          action={<span className="rounded-md bg-smoke px-3 py-2 text-xs font-black uppercase text-steel">{days} days</span>}
        >
          <ActivityChart series={analytics.series} />
        </AnalyticsCard>

        <AnalyticsCard eyebrow="Upcoming" title="Today + Tomorrow">
          <div className="grid gap-3">
            {upcomingSoon.length ? (
              upcomingSoon.map((booking) => <BookingRow booking={booking} key={booking.id} />)
            ) : (
              <EmptyState>No jobs scheduled today or tomorrow.</EmptyState>
            )}
          </div>
        </AnalyticsCard>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-3">
        <AnalyticsCard eyebrow="Services" title="Jobs by type">
          <HorizontalBars items={serviceBreakdown} emptyText="No service mix yet." />
        </AnalyticsCard>

        <AnalyticsCard eyebrow="Revenue" title="Breakdown">
          <RevenueBars items={revenueBreakdown} />
        </AnalyticsCard>

        <AnalyticsCard eyebrow="Clients" title="Growth">
          <ClientGrowthChart series={clientGrowth} />
        </AnalyticsCard>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
        <AnalyticsCard eyebrow="Status" title="Booking queue">
          <div className="grid gap-3">
            {statusOverview.map((item) => (
              <div className="flex items-center justify-between rounded-lg bg-smoke p-3" key={item.label}>
                <span className="text-sm font-black uppercase text-ink">{item.label}</span>
                <span className={`rounded-md px-3 py-1 text-sm font-black uppercase ${item.tone}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </AnalyticsCard>

        <AnalyticsCard eyebrow="Activity" title="Recent bookings">
          <div className="grid gap-3">
            {recentActivity.length ? (
              recentActivity.map((booking) => <BookingRow booking={booking} compact key={booking.id} />)
            ) : (
              <EmptyState>No booking activity yet.</EmptyState>
            )}
          </div>
        </AnalyticsCard>
      </section>
    </>
  );
}

function MetricCard({ label, value, helper, trend }: { label: string; value: string; helper: string; trend: number[] }) {
  return (
    <article className="rounded-lg bg-smoke p-4 ring-1 ring-ink/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-steel">{label}</p>
          <p className="mt-3 text-3xl font-black uppercase leading-none text-ink">{value}</p>
          <p className="mt-2 text-xs font-bold text-steel">{helper}</p>
        </div>
        <span className="h-2 w-2 rounded-full bg-red" aria-hidden="true" />
      </div>
      <MiniSparkline values={trend} />
    </article>
  );
}

function AnalyticsCard({ eyebrow, title, action, children }: { eyebrow: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <article className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-ink/10 md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-red">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-black uppercase leading-none text-ink">{title}</h2>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </article>
  );
}

function BookingRow({ booking, compact = false }: { booking: StoredBooking; compact?: boolean }) {
  const details = getBookingDetails(booking);

  return (
    <Link className="block rounded-lg bg-smoke p-4 transition hover:bg-red-soft" href={`/admin/bookings?search=${encodeURIComponent(booking.email)}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-red">
            {formatDisplayDate(booking.date)} / {booking.time}
          </p>
          <h3 className="mt-1 truncate text-lg font-black uppercase leading-none text-ink">{booking.name}</h3>
          <p className="mt-2 text-sm font-bold text-steel">
            {details.map((detail) => `${shortServiceName(detail.service)} / ${detail.vehicleType}`).join(" + ")}
          </p>
          {!compact ? <p className="mt-1 truncate text-sm text-steel">{booking.address}</p> : null}
        </div>
        <StatusBadge status={booking.status} />
      </div>
    </Link>
  );
}

function TimeframeControl({ days }: { days: number }) {
  return (
    <nav className="inline-grid grid-cols-4 gap-1 rounded-lg bg-smoke p-1 ring-1 ring-ink/10" aria-label="Dashboard timeframe">
      {timelineOptions.map((option) => (
        <Link
          className={`rounded-md px-4 py-2 text-center text-xs font-black uppercase transition ${
            days === option ? "bg-ink text-white shadow-sm" : "text-steel hover:bg-white hover:text-ink"
          }`}
          href={`/admin/dashboard?range=${option}`}
          key={option}
        >
          {option}D
        </Link>
      ))}
    </nav>
  );
}

function ActivityChart({ series }: { series: AnalyticsPoint[] }) {
  const width = 680;
  const height = 250;
  const maxBookings = Math.max(1, ...series.map((point) => point.bookings));
  const maxRevenue = Math.max(1, ...series.map((point) => point.revenue));
  const bars = series.map((point, index) => {
    const x = getPointX(index, series.length, width);
    const barHeight = Math.max(4, (point.bookings / maxBookings) * 142);
    const barWidth = Math.max(5, Math.min(18, width / Math.max(1, series.length) - 5));
    return { ...point, x, barHeight, barWidth };
  });
  const linePoints = series.map((point, index) => {
    const x = getPointX(index, series.length, width);
    const y = 190 - (point.revenue / maxRevenue) * 150;
    return { date: point.date, x, y };
  });
  const line = linePoints.map((point) => `${point.x},${point.y}`).join(" ");
  const area = linePoints.length ? `0,202 ${linePoints.map((point) => `${point.x},${point.y}`).join(" ")} ${width},202` : "";
  const markers = buildAxisMarkers(linePoints);

  return (
    <div className="rounded-lg bg-smoke p-3">
      <svg className="h-64 w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bookings and revenue over time" preserveAspectRatio="none">
        {[0, 1, 2, 3].map((lineIndex) => (
          <line key={lineIndex} x1="0" x2={width} y1={42 + lineIndex * 40} y2={42 + lineIndex * 40} stroke="rgba(5,5,6,0.07)" strokeWidth="1" />
        ))}
        {bars.map((bar) => (
          <rect
            fill="#050506"
            key={bar.date}
            opacity={bar.bookings ? 0.22 : 0.07}
            rx="4"
            x={bar.x - bar.barWidth / 2}
            y={202 - bar.barHeight}
            width={bar.barWidth}
            height={bar.barHeight}
          />
        ))}
        <polygon fill="rgba(193,18,31,0.08)" points={area} />
        <polyline fill="none" points={line} stroke="#c1121f" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        {linePoints.filter((_, index) => index === linePoints.length - 1).map((point) => (
          <circle cx={point.x} cy={point.y} fill="#fff" key={point.date} r="5" stroke="#c1121f" strokeWidth="3" />
        ))}
        <line x1="0" x2={width} y1="212" y2="212" stroke="rgba(5,5,6,0.14)" strokeWidth="1" />
        {markers.map((marker) => (
          <text fill="#73777c" fontSize="13" fontWeight="800" key={marker.date} textAnchor="middle" x={marker.x} y="238">
            {formatChartDate(marker.date)}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-xs font-black uppercase text-steel">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-red" /> Revenue</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-5 rounded-full bg-ink/30" /> Bookings</span>
      </div>
    </div>
  );
}

function ClientGrowthChart({ series }: { series: Array<{ date: string; value: number }> }) {
  const width = 420;
  const height = 170;
  const max = Math.max(1, ...series.map((point) => point.value));
  const points = series.map((point, index) => {
    const x = getPointX(index, series.length, width);
    const y = 122 - (point.value / max) * 92;
    return { ...point, x, y };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const markers = buildAxisMarkers(points);
  const lastPoint = points.at(-1);

  return (
    <div className="rounded-lg bg-smoke p-3">
      <svg className="h-44 w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Client growth" preserveAspectRatio="none">
        <polyline fill="none" points={line} stroke="#050506" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
        {lastPoint ? <circle cx={lastPoint.x} cy={lastPoint.y} fill="#c1121f" r="5" /> : null}
        <line x1="0" x2={width} y1="132" y2="132" stroke="rgba(5,5,6,0.12)" strokeWidth="1" />
        {markers.map((marker) => (
          <text fill="#73777c" fontSize="12" fontWeight="800" key={marker.date} textAnchor="middle" x={marker.x} y="160">
            {formatChartDate(marker.date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function HorizontalBars({ items, emptyText }: { items: NamedValue[]; emptyText: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));

  if (!items.length) {
    return <EmptyState>{emptyText}</EmptyState>;
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div className="grid gap-2" key={item.label}>
          <div className="flex items-center justify-between gap-3 text-xs font-black uppercase text-steel">
            <span>{item.label}</span>
            <span>{item.displayValue || item.value}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-smoke">
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.max(7, (item.value / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RevenueBars({ items }: { items: NamedValue[] }) {
  const max = Math.max(1, ...items.map((item) => item.value));

  if (!items.length) {
    return <EmptyState>No revenue data yet.</EmptyState>;
  }

  return (
    <div className="flex h-48 items-end gap-3 rounded-lg bg-smoke p-4">
      {items.map((item) => (
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2" key={item.label}>
          <div className="flex h-32 w-full items-end justify-center">
            <div className="w-full rounded-t-md bg-red shadow-sm" style={{ height: `${Math.max(8, (item.value / max) * 100)}%` }} />
          </div>
          <p className="w-full truncate text-center text-[10px] font-black uppercase text-steel">{shortServiceName(item.label)}</p>
          <p className="text-[10px] font-black uppercase text-ink">{item.displayValue}</p>
        </div>
      ))}
    </div>
  );
}

function MiniSparkline({ values }: { values: number[] }) {
  const width = 210;
  const height = 42;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = getPointX(index, values.length, width);
    const y = height - (value / max) * 28 - 7;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="mt-4 h-10 w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" points={points} stroke="#c1121f" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
    </svg>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-smoke p-5 text-center text-sm font-bold text-steel">{children}</p>;
}

function parseTimelineRange(value?: string) {
  const parsed = Number(value || 30);
  return timelineOptions.includes(parsed as (typeof timelineOptions)[number]) ? parsed : 30;
}

function getServiceBreakdown(bookings: StoredBooking[]): NamedValue[] {
  const totals = new Map<string, number>();

  bookings.forEach((booking) => {
    getBookingDetails(booking).forEach((detail) => {
      totals.set(detail.service, (totals.get(detail.service) || 0) + 1);
    });
  });

  return Array.from(totals.entries())
    .map(([label, value]) => ({ label: shortServiceName(label), value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function getRevenueBreakdown(bookings: StoredBooking[]): NamedValue[] {
  const totals = new Map<string, number>();

  bookings.forEach((booking) => {
    const details = getBookingDetails(booking);
    const splitAmount = details.length ? Math.round(getBookingAmount(booking) / details.length) : getBookingAmount(booking);
    details.forEach((detail) => {
      totals.set(detail.service, (totals.get(detail.service) || 0) + splitAmount);
    });
  });

  return Array.from(totals.entries())
    .map(([label, value]) => ({ label, value, displayValue: formatMoney(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function getClientGrowthSeries(bookings: StoredBooking[], days: number) {
  const startDate = addDays(new Date(), -(days - 1));
  const sortedBookings = [...bookings].sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set<string>();

  return Array.from({ length: days }, (_, index) => {
    const date = getDateString(addDays(startDate, index));
    sortedBookings
      .filter((booking) => booking.date <= date)
      .forEach((booking) => seen.add((booking.email || booking.phone || booking.name).toLowerCase()));

    return { date, value: seen.size };
  });
}

function buildAxisMarkers<T extends { date: string; x: number }>(points: T[]) {
  if (points.length <= 3) {
    return points;
  }

  return [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].filter(
    (point, index, markers) => markers.findIndex((marker) => marker.date === point.date) === index
  );
}

function getPointX(index: number, length: number, width: number) {
  if (length <= 1) {
    return width / 2;
  }

  return 16 + (index / (length - 1)) * (width - 32);
}

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function formatChartDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

function shortServiceName(value: string) {
  return value
    .replace(" Detail", "")
    .replace("Ceramic Coating", "Ceramic")
    .replace("Paint Correction", "Paint");
}
