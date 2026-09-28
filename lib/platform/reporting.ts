import { query } from "./db";
import { dateToday, channels, type Row } from "./types";
import { validDate } from "./bookings";
import { AppError } from "./auth";
import { expenseSummary } from "./finance";
export function reportRange(params: URLSearchParams) {
  const today = dateToday(),
    range = params.get("range") || "30";
  const offset = (days: number) => dateToday(new Date(Date.now() - days * 86400000));
  const todayDate = new Date(today + "T12:00:00Z");
  const weekStart = new Date(todayDate); weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7);
  const monthStart = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1, 12));
  const previousMonthStart = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - 1, 1, 12));
  const previousMonthEnd = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 0, 12));
  const preset = range === "yesterday" ? { start: offset(1), end: offset(1) } : range === "week" ? { start: dateToday(weekStart), end: today } : range === "month" ? { start: dateToday(monthStart), end: today } : range === "last_month" ? { start: dateToday(previousMonthStart), end: dateToday(previousMonthEnd) } : range === "year" ? { start: today.slice(0, 4) + "-01-01", end: today } : { start: offset(Math.max(1, Number(range) || 30) - 1), end: today };
  const start = params.get("from") || preset.start;
  const end = params.get("to") || preset.end;
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
    salesTotal,
    events,
    leads,
    spend,
    performance,
    series,
    topServices,
    square,
    labor,
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
      `SELECT COALESCE(SUM(p.amount_cents-p.refunded_cents),0)::bigint revenue,
        COALESCE(SUM(p.amount_cents-p.refunded_cents) FILTER(WHERE p.booking_id IS NOT NULL),0)::bigint booking_revenue,
        COALESCE(SUM(p.amount_cents-p.refunded_cents) FILTER(WHERE p.customer_id IS NOT NULL),0)::bigint customer_revenue,
        COALESCE(SUM(p.refunded_cents),0)::bigint refunds,
        COALESCE(SUM(p.processor_fee_cents),0)::bigint processor_fees,
        count(DISTINCT p.booking_id)::int paid_bookings,count(DISTINCT p.customer_id)::int paying_customers
       FROM wl.revenue_payments p WHERE ${payments}`,
      values,
    ),
    query<Row>(
      `SELECT COALESCE(SUM(b.price_cents),0)::int net_sales,COALESCE(SUM(b.tip_cents),0)::int tips,
        COALESCE(SUM((SELECT SUM(quantity*unit_price_cents) FROM wl.booking_line_items li WHERE li.booking_id=b.id AND li.kind='upsell')),0)::int upsells,
        COALESCE(SUM((SELECT SUM(amount_cents) FROM wl.booking_discounts d WHERE d.booking_id=b.id)),0)::int discounts,
        COALESCE(SUM(GREATEST(0,b.price_cents-COALESCE((SELECT SUM(p.amount_cents-p.refunded_cents) FROM wl.revenue_payments p WHERE p.booking_id=b.id AND p.status IN ('paid','partially_refunded','refunded')),0))),0)::int outstanding,
        count(*)::int completed_jobs FROM wl.bookings b WHERE b.status='completed' AND (COALESCE(b.completed_at,b.updated_at) AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date`,
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
    query<{ source: string; campaign: string; leads: number; bookings: number; revenue: number | string }>(
      `SELECT a.source,a.campaign,
 (SELECT count(*)::int FROM wl.leads l WHERE l.attribution_id=a.id AND (l.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date) leads,
 (SELECT count(*)::int FROM wl.bookings b WHERE b.attribution_id=a.id AND (b.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date) bookings,
 COALESCE((SELECT SUM(p.amount_cents-p.refunded_cents)::bigint FROM wl.revenue_payments p JOIN wl.bookings b ON p.booking_id=b.id WHERE b.attribution_id=a.id AND ${payments}),0)::bigint revenue FROM wl.attributions a`,
      values,
    ),
    query<{ day: string; revenue: number | string }>(
      `SELECT (p.paid_at AT TIME ZONE 'America/Chicago')::date::text AS day,SUM(p.amount_cents-p.refunded_cents)::bigint revenue FROM wl.revenue_payments p WHERE ${payments} GROUP BY 1 ORDER BY 1`,
      values,
    ),
    query<{ service_name: string; revenue: number | string; bookings: number }>(
      `SELECT b.service_name,SUM(p.amount_cents-p.refunded_cents)::bigint revenue,count(DISTINCT b.id)::int bookings FROM wl.revenue_payments p JOIN wl.bookings b ON b.id=p.booking_id WHERE ${payments} GROUP BY b.service_name ORDER BY revenue DESC`,
      values,
    ),
    query<Row>(
      `SELECT COALESCE(SUM(p.amount_cents),0)::bigint gross,
        COALESCE(SUM(p.refunded_cents),0)::bigint refunds,
        COALESCE(SUM(p.amount_cents-p.refunded_cents),0)::bigint net,
        COALESCE(SUM(p.processor_fee_cents),0)::bigint fees,
        COALESCE(SUM(p.tip_cents),0)::bigint tips,
        count(*)::int transaction_count,
        COALESCE(SUM(p.amount_cents-p.refunded_cents) FILTER(WHERE p.booking_id IS NULL),0)::bigint unlinked_total,
        count(*) FILTER(WHERE p.booking_id IS NULL)::int unlinked_transaction_count
       FROM wl.revenue_payments p WHERE p.provider='square' AND ${payments}`,
      values,
    ),
    query<Row>(
      `SELECT COALESCE(SUM(GREATEST(0,round(EXTRACT(EPOCH FROM (t.clock_out-t.clock_in))/60)-t.break_minutes)*e.hourly_rate_cents/60),0)::int cost
       FROM wl.time_entries t JOIN wl.employees e ON e.id=t.employee_id
       WHERE t.clock_out IS NOT NULL AND (t.clock_in AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date`,
      values,
    ),
  ]);
  const expenses = await expenseSummary(start, end);
  const channelSpend = await query<{ channel: string; total: number }>(
    "SELECT channel,SUM(amount_cents)::int total FROM wl.ad_spend WHERE spend_date BETWEEN $1 AND $2 GROUP BY channel",
    values,
  );
  const googleAds = (
    await query<Row>(
      `SELECT
        (SELECT count(DISTINCT a.session_id)::int FROM wl.attributions a
          WHERE a.source='Google Ads' AND (a.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date) sessions,
        (SELECT count(DISTINCT a.session_id)::int FROM wl.attributions a
          WHERE a.source='Google Ads' AND (a.gclid<>'' OR a.gbraid<>'' OR a.wbraid<>'')
            AND (a.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date) click_sessions,
        (SELECT count(DISTINCT e.session_id)::int FROM wl.events e JOIN wl.attributions a ON a.id=e.attribution_id
          WHERE a.source='Google Ads' AND e.name='booking_started'
            AND (e.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date) booking_starts,
        (SELECT count(*)::int FROM wl.bookings b JOIN wl.attributions a ON a.id=b.attribution_id
          WHERE a.source='Google Ads' AND b.status NOT IN ('cancelled','no_show')
            AND (b.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date) bookings,
        COALESCE((SELECT SUM(b.price_cents)::int FROM wl.bookings b JOIN wl.attributions a ON a.id=b.attribution_id
          WHERE a.source='Google Ads' AND b.status NOT IN ('cancelled','no_show')
            AND (b.created_at AT TIME ZONE 'America/Chicago')::date BETWEEN $1::date AND $2::date),0)::int booked_value,
        COALESCE((SELECT SUM(p.amount_cents-p.refunded_cents)::bigint FROM wl.revenue_payments p
          JOIN wl.bookings b ON b.id=p.booking_id JOIN wl.attributions a ON a.id=b.attribution_id
          WHERE a.source='Google Ads' AND ${payments}),0)::bigint paid_revenue`,
      values,
    )
  )[0];
  const googleAdsSpend =
    channelSpend.find((entry) => entry.channel === "Google Ads")?.total ?? null;
  const channelPerformance = channels.map((channel) => {
    const rows = performance.filter((r) => r.source === channel),
      sum = (key: "leads" | "bookings" | "revenue") => rows.reduce((n, r) => n + Number(r[key]), 0),
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
 COALESCE(SUM(amount_cents-refunded_cents) FILTER(WHERE (paid_at AT TIME ZONE 'America/Chicago')::date=$1::date),0)::bigint AS today,
 COALESCE(SUM(amount_cents-refunded_cents) FILTER(WHERE (paid_at AT TIME ZONE 'America/Chicago')::date BETWEEN date_trunc('week',$1::date)::date AND $1::date),0)::bigint AS week,
 COALESCE(SUM(amount_cents-refunded_cents) FILTER(WHERE (paid_at AT TIME ZONE 'America/Chicago')::date BETWEEN date_trunc('month',$1::date)::date AND $1::date),0)::bigint AS month,
 COALESCE(SUM(amount_cents-refunded_cents) FILTER(WHERE (paid_at AT TIME ZONE 'America/Chicago')::date BETWEEN date_trunc('year',$1::date)::date AND $1::date),0)::bigint AS year
 FROM wl.revenue_payments WHERE status IN ('paid','partially_refunded','refunded')`,
    [dateToday()],
  );
  const revenue = Number(paymentsTotal[0].revenue),
    netSales = Number(salesTotal[0].net_sales),
    visits = Number(events.find((e) => e.name === "page_view")?.sessions || 0),
    totalBookings = Number(
      events.find((e) => e.name === "booking_completed")?.sessions || 0,
    );
  const financialSeries = new Map<string, { day: string; revenue: number; expenses: number }>();
  for (const row of series) financialSeries.set(String(row.day), { day: String(row.day), revenue: Number(row.revenue), expenses: 0 });
  for (const row of expenses.byDay) {
    const current = financialSeries.get(row.day) || { day: row.day, revenue: 0, expenses: 0 };
    current.expenses = row.amount_cents;
    financialSeries.set(row.day, current);
  }
  return {
    start,
    end,
    bookings: bookings[0],
    customers: customers[0],
    revenue,
    net_sales: netSales,
    payments_collected: revenue,
    outstanding: Number(salesTotal[0].outstanding),
    refunds: Number(paymentsTotal[0].refunds),
    processor_fees: Number(paymentsTotal[0].processor_fees),
    square: {
      gross: Number(square[0].gross),
      refunds: Number(square[0].refunds),
      net: Number(square[0].net),
      fees: Number(square[0].fees),
      tips: Number(square[0].tips),
      transaction_count: Number(square[0].transaction_count),
      unlinked_total: Number(square[0].unlinked_total),
      unlinked_transaction_count: Number(square[0].unlinked_transaction_count),
    },
    tips: Number(salesTotal[0].tips),
    upsells: Number(salesTotal[0].upsells),
    discounts: Number(salesTotal[0].discounts),
    completed_jobs: Number(salesTotal[0].completed_jobs),
    expenses: expenses.total_cents,
    net_operating_profit: revenue - expenses.total_cents,
    operating_margin: revenue ? ((revenue - expenses.total_cents) / revenue) * 100 : null,
    expense_summary: expenses,
    financial_series: [...financialSeries.values()].sort((a, b) => a.day.localeCompare(b.day)).map((row) => ({ ...row, net_operating_profit: row.revenue - row.expenses })),
    labor_cost: Number(labor[0].cost),
    windows: Object.fromEntries(Object.entries(windows[0]).map(([key, value]) => [key, Number(value)])),
    average_order: Number(paymentsTotal[0].paid_bookings)
      ? Number(paymentsTotal[0].booking_revenue) / Number(paymentsTotal[0].paid_bookings)
      : 0,
    revenue_per_customer: Number(paymentsTotal[0].paying_customers)
      ? Number(paymentsTotal[0].customer_revenue) / Number(paymentsTotal[0].paying_customers)
      : 0,
    leads: Number(leads[0].count),
    spend: Number(spend[0].total),
    conversion_rate: visits ? (totalBookings / visits) * 100 : null,
    events,
    channels: channelPerformance,
    google_ads: {
      sessions: Number(googleAds.sessions),
      click_sessions: Number(googleAds.click_sessions),
      booking_starts: Number(googleAds.booking_starts),
      bookings: Number(googleAds.bookings),
      booked_value: Number(googleAds.booked_value),
      paid_revenue: Number(googleAds.paid_revenue),
      spend: googleAdsSpend,
      roas: googleAdsSpend
        ? Number(googleAds.paid_revenue) / googleAdsSpend
        : null,
    },
    campaigns: performance.map((row) => ({ ...row, revenue: Number(row.revenue) })),
    series: series.map((row) => ({ ...row, revenue: Number(row.revenue) })),
    topServices: topServices.map((row) => ({ ...row, revenue: Number(row.revenue) })),
  };
}
