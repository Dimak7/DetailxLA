import { query } from "./db";
import { dateToday, channels, type Row } from "./types";
import { validDate } from "./bookings";
import { AppError } from "./auth";
export function reportRange(params: URLSearchParams) {
  const today = dateToday(),
    range = params.get("range") || "30";
  const start =
    params.get("from") ||
    (range === "year"
      ? today.slice(0, 4) + "-01-01"
      : dateToday(
          new Date(
            Date.now() - (Math.max(1, Number(range) || 30) - 1) * 86400000,
          ),
        ));
  const end = params.get("to") || today;
  if (!validDate(start) || !validDate(end) || start > end)
    throw new AppError("Choose a valid reporting range.");
  return { start, end };
}
export async function report(params: URLSearchParams) {
  const { start, end } = reportRange(params),
    values = [start, end];
  const time =
    "(created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date";
  const payments =
    "(p.paid_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date AND p.status IN ('paid','partially_refunded','refunded')";
  const [
    bookings,
    customers,
    paymentsTotal,
    events,
    leads,
    spend,
    performance,
    series,
    topServices,
  ] = await Promise.all([
    query<Row>(
      `SELECT count(*)::int total,count(*) FILTER(WHERE status='completed')::int completed,count(*) FILTER(WHERE status='cancelled')::int cancelled,count(*) FILTER(WHERE status='no_show')::int no_show,count(*) FILTER(WHERE booking_date>=$3 AND status IN ('new','confirmed'))::int upcoming FROM wl.bookings WHERE ${time}`,
      [...values, dateToday()],
    ),
    query<Row>(
      `SELECT count(*)::int total,count(*) FILTER(WHERE ${time})::int new_customers,count(*) FILTER(WHERE (SELECT count(*) FROM wl.bookings b WHERE b.customer_id=c.id AND status='completed')>1)::int "returning" FROM wl.customers c`,
      values,
    ),
    query<Row>(
      `SELECT COALESCE(SUM(p.amount_cents-p.refunded_cents),0)::int revenue,count(DISTINCT p.booking_id)::int paid_bookings,count(DISTINCT p.customer_id)::int paying_customers FROM wl.payments p WHERE ${payments}`,
      values,
    ),
    query<Row>(
      `SELECT name,count(*)::int count,count(DISTINCT session_id)::int sessions FROM wl.events WHERE ${time} GROUP BY name`,
      values,
    ),
    query<Row>(
      `SELECT count(*)::int count FROM wl.leads WHERE ${time}`,
      values,
    ),
    query<Row>(
      "SELECT COALESCE(SUM(amount_cents),0)::int total FROM wl.ad_spend WHERE spend_date BETWEEN $1 AND $2",
      values,
    ),
    query<Row>(
      `SELECT a.source,a.campaign,
 (SELECT count(*)::int FROM wl.leads l WHERE l.attribution_id=a.id AND (l.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date) leads,
 (SELECT count(*)::int FROM wl.bookings b WHERE b.attribution_id=a.id AND (b.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date) bookings,
 COALESCE((SELECT SUM(p.amount_cents-p.refunded_cents)::int FROM wl.payments p JOIN wl.bookings b ON p.booking_id=b.id WHERE b.attribution_id=a.id AND ${payments}),0)::int revenue FROM wl.attributions a`,
      values,
    ),
    query<Row>(
      `SELECT (p.paid_at AT TIME ZONE 'America/Chicago')::date::text AS day,SUM(p.amount_cents-p.refunded_cents)::int revenue FROM wl.payments p WHERE ${payments} GROUP BY 1 ORDER BY 1`,
      values,
    ),
    query<Row>(
      `SELECT b.service_name,SUM(p.amount_cents-p.refunded_cents)::int revenue,count(DISTINCT b.id)::int bookings FROM wl.payments p JOIN wl.bookings b ON b.id=p.booking_id WHERE ${payments} GROUP BY b.service_name ORDER BY revenue DESC`,
      values,
    ),
  ]);
  const channelSpend = await query<{ channel: string; total: number }>(
    "SELECT channel,SUM(amount_cents)::int total FROM wl.ad_spend WHERE spend_date BETWEEN $1 AND $2 GROUP BY channel",
    values,
  );
  const channelPerformance = channels.map((channel) => {
    const rows = performance.filter((r) => r.source === channel),
      sum = (key: string) => rows.reduce((n, r) => n + Number(r[key]), 0),
      adSpend = channelSpend.find((s) => s.channel === channel)?.total ?? null;
    const l = sum("leads"),
      b = sum("bookings"),
      revenue = sum("revenue");
    return {
      channel,
      leads: l,
      bookings: b,
      revenue,
      spend: adSpend,
      cpl: adSpend != null && l ? adSpend / l : null,
      cpa: adSpend != null && b ? adSpend / b : null,
      roas: adSpend ? revenue / adSpend : null,
    };
  });
  const windows = await query<Row>(
    `SELECT
 COALESCE(SUM(amount_cents-refunded_cents) FILTER(WHERE (paid_at AT TIME ZONE 'America/Chicago')::date=$1::date),0)::int AS today,
 COALESCE(SUM(amount_cents-refunded_cents) FILTER(WHERE (paid_at AT TIME ZONE 'America/Chicago')::date>=date_trunc('week',$1::date)::date),0)::int AS week,
 COALESCE(SUM(amount_cents-refunded_cents) FILTER(WHERE (paid_at AT TIME ZONE 'America/Chicago')::date>=date_trunc('month',$1::date)::date),0)::int AS month,
 COALESCE(SUM(amount_cents-refunded_cents) FILTER(WHERE (paid_at AT TIME ZONE 'America/Chicago')::date>=date_trunc('year',$1::date)::date),0)::int AS year
 FROM wl.payments WHERE status IN ('paid','partially_refunded','refunded')`,
    [dateToday()],
  );
  const revenue = Number(paymentsTotal[0].revenue),
    visits = Number(events.find((e) => e.name === "page_view")?.sessions || 0),
    totalBookings = Number(
      events.find((e) => e.name === "booking_completed")?.sessions || 0,
    );
  return {
    start,
    end,
    bookings: bookings[0],
    customers: customers[0],
    revenue,
    windows: windows[0],
    average_order: Number(paymentsTotal[0].paid_bookings)
      ? revenue / Number(paymentsTotal[0].paid_bookings)
      : 0,
    revenue_per_customer: Number(paymentsTotal[0].paying_customers)
      ? revenue / Number(paymentsTotal[0].paying_customers)
      : 0,
    leads: Number(leads[0].count),
    spend: Number(spend[0].total),
    conversion_rate: visits ? (totalBookings / visits) * 100 : null,
    events,
    channels: channelPerformance,
    campaigns: performance,
    series,
    topServices,
  };
}
