"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { money, type BusinessSettings } from "@/lib/platform/types";
import { marketingStreamLabel } from "@/lib/marketing-streams";
import type { report } from "@/lib/platform/reporting";
import type { RecordData } from "./AdminControls";
import { ProfitChart, MarketingCostReturn } from "./FinanceCharts";
import { AdsPerformance } from "./AdsPerformance";
import { MarketingCommissions } from "./MarketingCommissions";
import { MetaLeadForms } from "./MetaLeadForms";
import styles from "./GrowthWorkspace.module.css";

type Report = Awaited<ReturnType<typeof report>>;
type Performance = Omit<Report["channels"][number], "channel">;
const tabs = [
  { id: "overview", label: "Overview" },
  { id: "sources", label: "Sources" },
  { id: "campaigns", label: "Campaigns" },
  { id: "partners", label: "Partner payouts" },
  { id: "connections", label: "Connections" },
] as const;
type View = typeof tabs[number]["id"];
const integer = (value: unknown) => Number(value || 0);
const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const eventLabel = (name: string) => name.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

function PerformanceTable({ rows, label }: { rows: Array<Performance & { name: string }>; label: string }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <div className={styles.performanceList} aria-label={label}>
      {rows.map((row, index) => <details className={styles.performanceRow} key={row.name}>
        <summary>
          <span className={styles.sourceBadge} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <span className={styles.performanceName}><strong>{row.name}</strong><small>{row.leads.toLocaleString()} {row.leads === 1 ? "enquiry" : "enquiries"} · {row.clients.toLocaleString()} {row.clients === 1 ? "client" : "clients"}</small></span>
          <span className={styles.performanceStats}><span className={styles.performanceNumber}><strong>{row.bookings.toLocaleString()}</strong><small>Bookings</small></span><span className={styles.performanceRevenue}><strong>{money(row.revenue)}</strong><small>Collected</small></span></span>
          <span className={styles.expandIcon} aria-hidden="true"/>
        </summary>
        <dl className={styles.sourceDetails}>
          <div><dt>Manual ad spend</dt><dd>{row.spend === null ? "Not entered" : money(row.spend)}</dd></div>
          <div><dt>Revenue / spend</dt><dd>{row.roas === null ? "—" : `${row.roas.toFixed(2)}×`}</dd></div>
          <div><dt>Cost / enquiry</dt><dd>{row.cpl === null ? "—" : money(row.cpl)}</dd></div>
          <div><dt>Cost / booking</dt><dd>{row.cpa === null ? "—" : money(row.cpa)}</dd></div>
        </dl>
      </details>)}
    </div>
    <div className={styles.tableToolbar}><span>Select a source for costs and return.</span><button type="button" className={styles.quietButton} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Close comparison" : "Compare all metrics"}</button></div>
    {expanded && <div className={styles.tableScroll} role="region" aria-label={`${label}, scroll for more columns`} tabIndex={0}>
      <table className={styles.table}>
        <thead><tr><th scope="col">Source</th><th scope="col">Enquiries</th><th scope="col">Bookings</th><th scope="col">Collected</th><th scope="col">Ad spend</th><th scope="col">Revenue / spend</th><th scope="col">Clients</th><th scope="col">Cost / enquiry</th><th scope="col">Cost / booking</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.name}>
          <th scope="row">{row.name}</th><td>{row.leads.toLocaleString()}</td><td>{row.bookings.toLocaleString()}</td><td className={styles.money}>{money(row.revenue)}</td><td>{row.spend === null ? <span className={styles.unavailable}>Not entered</span> : money(row.spend)}</td><td>{row.roas === null ? "—" : `${row.roas.toFixed(2)}×`}</td>
          <td>{row.clients.toLocaleString()}</td><td>{row.cpl === null ? "—" : money(row.cpl)}</td><td>{row.cpa === null ? "—" : money(row.cpa)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </>;
}

export function GrowthWorkspace({ data, business, allowedSections, campaignContent, spendContent, onCreateCampaign }: {
  data: RecordData;
  business: BusinessSettings;
  allowedSections: string[];
  campaignContent: ReactNode;
  spendContent: ReactNode;
  onCreateCampaign: () => void;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const rep = data.report as Report;
  const selectedView = params.get("view");
  const view: View = tabs.find(tab => tab.id === selectedView)?.id || "overview";
  const [showDates, setShowDates] = useState(Boolean(params.get("from") || params.get("to")));
  const canViewExpenses = allowedSections.includes("expenses");
  const canViewReports = allowedSections.includes("reports");
  const channels = rep.channels.filter(row => row.leads || row.bookings || row.clients || row.revenue || row.spend !== null || ["Google Ads", "Meta Ads"].includes(row.channel));
  const topChannels = [...channels].filter(row => row.bookings > 0).sort((a, b) => b.bookings - a.bookings).slice(0, 4);
  const maxBookings = Math.max(1, ...topChannels.map(row => row.bookings));
  const eventSessions = (name: string) => integer(rep.events.find(event => event.name === name)?.sessions);
  const visitors = eventSessions("page_view");
  const activity = [
    { label: "Website visitors", value: visitors, detail: "Unique tracked sessions" },
    { label: "Booking started", value: eventSessions("booking_started"), detail: "Sessions opening the booking form" },
    { label: "Booking completed", value: eventSessions("booking_completed"), detail: "Sessions with a reservation" },
  ];
  const missingSpend = channels.filter(channel => channel.spend === null && ["Google Ads", "Meta Ads"].includes(channel.channel));
  const unassigned = rep.lead_streams.find(stream => stream.lead_stream === "Unassigned");
  const unmatchedCount = integer(unassigned?.bookings);
  const rangeLabel = `${dateLabel(rep.start)} – ${dateLabel(rep.end)}`;
  function viewHref(next: View) {
    const query = new URLSearchParams(params.toString());
    if (next === "overview") query.delete("view"); else query.set("view", next);
    return `/admin/marketing${query.size ? `?${query}` : ""}`;
  }
  function changeRange(range: string) {
    const query = new URLSearchParams(params.toString());
    query.set("range", range);
    query.delete("from");
    query.delete("to");
    setShowDates(false);
    router.push(`/admin/marketing?${query}`, { scroll: false });
  }
  const reportHref = `/admin/reports?from=${encodeURIComponent(rep.start)}&to=${encodeURIComponent(rep.end)}`;

  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div><p className={styles.kicker}>GROWTH & MARKETING</p><h1>Growth</h1><p>See which sources bring customers and revenue.</p></div>
      <button className="button" type="button" onClick={onCreateCampaign}>Create campaign</button>
    </header>

    <nav className={styles.tabs} aria-label="Growth sections">{tabs.map(tab => <Link href={viewHref(tab.id)} key={tab.id} aria-current={view === tab.id ? "page" : undefined} scroll={false}>{tab.label}</Link>)}</nav>
    <label className={styles.mobileView}><span>Growth view</span><select value={view} onChange={event => router.push(viewHref(event.target.value as View), { scroll: false })}>{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select></label>

    {view !== "partners" && <div className={styles.periodBar}>
      <div className={styles.periodLabel}><span>REPORTING PERIOD · CHICAGO TIME</span><strong>{rangeLabel}</strong></div>
      <div className={styles.periodActions}>
        <label className={styles.selectLabel}><span className={styles.srOnly}>Growth reporting period</span><select aria-label="Growth reporting period" value={showDates || params.get("from") || params.get("to") ? "custom" : params.get("range") || "30"} onChange={event => { if (event.target.value === "custom") setShowDates(true); else changeRange(event.target.value); }}>
          <option value="1">Today</option><option value="yesterday">Yesterday</option><option value="week">This week</option><option value="month">This month</option><option value="last_month">Last month</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="year">This year</option><option value="custom">Custom dates</option>
        </select></label>
        <button type="button" className={styles.quietButton} aria-expanded={showDates} aria-controls="growth-custom-period" onClick={() => setShowDates(value => !value)}>Choose dates</button>
      </div>
      {showDates && <form key={`${rep.start}:${rep.end}`} id="growth-custom-period" className={styles.customDates} action="/admin/marketing">
        <input type="hidden" name="view" value={view}/><input type="hidden" name="range" value={params.get("range") || "30"}/>
        <label>From<input type="date" name="from" defaultValue={params.get("from") || rep.start} required/></label>
        <label>To<input type="date" name="to" defaultValue={params.get("to") || rep.end} required/></label>
        <button type="submit" className="button">Apply dates</button>
      </form>}
    </div>}

    {view === "overview" && <>
      <div className={styles.metrics} aria-label="Growth summary">
        <article><span>Collected revenue</span><strong>{money(rep.payments_collected)}</strong><small>All verified payments, less refunds</small></article>
        <article><span>New bookings</span><strong>{integer(rep.bookings.total).toLocaleString()}</strong><small>Reservations created in this period</small></article>
        <article><span>Enquiries</span><strong>{rep.leads.toLocaleString()}</strong><small>Quotes and callbacks, separate from bookings</small></article>
        <article><span>Website booking rate</span><strong>{rep.conversion_rate === null ? "—" : `${rep.conversion_rate.toFixed(1)}%`}</strong><small>{visitors ? "Booked sessions / tracked visitors" : "No tracked visits in this period"}</small></article>
      </div>
      <div className={styles.overviewGrid}>
        <section className={`${styles.panel} ${styles.sourceSummary}`} aria-label="Top booking sources">
          <div className={styles.sectionHeading}><div><h2>Where bookings start</h2><p>Your top sources this period.</p></div><Link className={styles.quietButton} href={viewHref("sources")} scroll={false}>View all</Link></div>
          {topChannels.length ? <ol className={styles.sourceList}>{topChannels.map((channel, index) => <li key={channel.channel}>
            <span className={styles.sourceBadge} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <div className={styles.sourceName}><strong>{channel.channel}</strong><small className={styles.mobileBookings}>{channel.bookings} {channel.bookings === 1 ? "booking" : "bookings"}</small><div className={styles.sourceTrack} aria-hidden="true"><span style={{ width: `${channel.bookings / maxBookings * 100}%` }}/></div></div>
            <div className={styles.sourceCount}><strong>{channel.bookings}</strong><small>{channel.bookings === 1 ? "booking" : "bookings"}</small></div>
            <div className={styles.sourceCollected}><strong>{money(channel.revenue)}</strong><small>collected</small></div>
          </li>)}</ol> : <div className={styles.empty}><strong>No bookings to compare yet</strong><p>Your sources will appear as reservations arrive.</p></div>}
          <p className={styles.footnote}>New bookings and collections can belong to different appointments. Square payments without a linked job are included in total revenue, not source results.</p>
        </section>
        <section className={`${styles.panel} ${styles.attentionPanel}`}>
          <div className={styles.sectionHeading}><div><h2>Keep growth on track</h2></div></div>
          <ul className={styles.nextSteps}>
            <li><span className={styles.checkIcon} aria-hidden="true">{missingSpend.length ? "!" : "✓"}</span><div><strong>{missingSpend.length ? "Advertising costs" : "Ad spend recorded"}</strong><p>{missingSpend.length ? `${missingSpend.map(channel => channel.channel).join(" and ")} spend has not been entered for this period.` : "Compare spend with collected revenue in Sources."}</p><Link href={viewHref("sources")} scroll={false}>Review costs</Link></div></li>
            <li><span className={styles.checkIcon} aria-hidden="true">•</span><div><strong>{unmatchedCount ? `${unmatchedCount} ${unmatchedCount === 1 ? "booking without" : "bookings without"} stream tags` : "Tagged campaign links"}</strong><p>{unmatchedCount ? "Direct bookings may not need a partner tag. Check the links used in paid campaigns." : "Use a tagged link to attribute each campaign correctly."}</p><Link href={viewHref("partners")} scroll={false}>Links & partner payouts</Link></div></li>
          </ul>
          {canViewReports && <Link className={styles.textLink} href={reportHref}>Full business report</Link>}
        </section>
      </div>
      {canViewExpenses ? <div className={styles.chartWrap}><ProfitChart series={rep.financial_series}/></div> : <section className={styles.panel}><h2>Collected revenue</h2><p>{money(rep.payments_collected)} in verified collections after refunds.</p>{allowedSections.includes("payments") && <Link className={styles.textLink} href="/admin/payments">View payments</Link>}</section>}
      <div className={styles.lowerGrid}>
        <section className={styles.panel} aria-label="Website activity">
          <div className={styles.sectionHeading}><div><h2>Website activity</h2><p>From first visit to reservation.</p></div>{allowedSections.includes("analytics") && <Link className={styles.quietButton} href={`/admin/analytics?from=${encodeURIComponent(rep.start)}&to=${encodeURIComponent(rep.end)}`}>Detailed analytics</Link>}</div>
          <div className={styles.journey}>{activity.map((step, index) => <div key={step.label}><span className={styles.step}>0{index + 1}</span><strong>{step.value.toLocaleString()}</strong><span>{step.label}</span><small>{step.detail}</small></div>)}</div>
          <p className={styles.footnote}>Session counts for this period, not a matched customer funnel. Phone and walk-in bookings are separate.</p>
          <details className={styles.disclosure}><summary>All tracked activity</summary><dl className={styles.definitionList}>{rep.events.length ? rep.events.map(event => <div key={String(event.name)}><dt>{eventLabel(String(event.name))}</dt><dd>{integer(event.count).toLocaleString()}</dd></div>) : <p>No tracked activity in this period.</p>}</dl><p className={styles.footnote}>Phone clicks show intent, not answered calls. Record confirmed phone enquiries in Leads.</p></details>
        </section>
      </div>
      <details className={`${styles.panel} ${styles.disclosure}`}><summary>Which services bring in revenue?</summary><p className={styles.footnote}>Paid revenue by service or service combination. Multi-service jobs stay together so payments are counted once.</p><div className={styles.tableScroll} role="region" aria-label="Service revenue" tabIndex={0}><table className={styles.table}><thead><tr><th scope="col">Service or combination</th><th scope="col">Paid jobs</th><th scope="col">Collected</th></tr></thead><tbody>{rep.topServices.map(service => <tr key={service.service_name}><th scope="row">{service.service_name}</th><td>{service.bookings}</td><td>{money(service.revenue)}</td></tr>)}</tbody></table>{!rep.topServices.length && <p className={styles.empty}>No linked payments in this period.</p>}</div></details>
    </>}

    {view === "sources" && <>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>ACQUISITION</p><h2>What each source brings in</h2><p>Compare enquiries, reservations and collected payments.</p></div></div>
        <PerformanceTable rows={channels.map(row => ({ ...row, name: row.channel }))} label="Channel performance"/>
        <p className={styles.footnote}>Spend here is entered manually. Imported Meta spend is shown separately below. Enquiries and direct bookings are counted separately. Revenue / spend is return on ad spend, not profit.</p>
      </section>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>OWNERSHIP</p><h2>Business and partner sources</h2><p>See who funded each stream without mixing the results.</p></div></div>
        <PerformanceTable rows={rep.lead_streams.map(row => ({ ...row, name: marketingStreamLabel(row.lead_stream) }))} label="Lead stream performance"/>
      </section>
      <details className={`${styles.panel} ${styles.disclosure}`}><summary>Ad account performance</summary><div className={styles.embedded}><AdsPerformance report={rep}/></div></details>
      <details className={`${styles.panel} ${styles.disclosure}`}><summary>Campaign-level attribution</summary><div className={styles.tableScroll} role="region" aria-label="Campaign attribution" tabIndex={0}><table className={styles.table}><thead><tr><th scope="col">Campaign</th><th scope="col">Channel</th><th scope="col">Lead stream</th><th scope="col">Enquiries</th><th scope="col">Bookings</th><th scope="col">Clients</th><th scope="col">Collected</th></tr></thead><tbody>{rep.campaigns.filter(campaign => campaign.leads || campaign.bookings || campaign.revenue).map((campaign, index) => <tr key={`${campaign.source}-${campaign.lead_stream}-${campaign.campaign}-${index}`}><th scope="row">{campaign.campaign || "Not tagged"}</th><td>{campaign.source}</td><td>{marketingStreamLabel(campaign.lead_stream)}</td><td>{campaign.leads}</td><td>{campaign.bookings}</td><td>{campaign.clients}</td><td>{money(campaign.revenue)}</td></tr>)}</tbody></table></div></details>
      {canViewExpenses && <details className={`${styles.panel} ${styles.disclosure}`}><summary>Marketing costs and return</summary><div className={styles.embedded}><MarketingCostReturn costs={rep.expense_summary.byMarketing} campaigns={rep.campaigns}/></div></details>}
      <div className={styles.embeddedStandalone}>{spendContent}</div>
    </>}

    {view === "campaigns" && <div className={styles.embeddedStandalone}><div className={styles.intro}><h2>Bring customers back.</h2><p>Create email and SMS campaigns for customers who have opted in. Review the audience before sending.</p></div>{campaignContent}</div>}

    {view === "partners" && <>
      <div className={styles.contextNote}><strong>Partner earnings cover all dates.</strong><span>Eligibility and payout history stay together, independent of the reporting filter.</span></div>
      <div className={styles.embeddedStandalone}><MarketingCommissions/></div>
    </>}

    {view === "connections" && <>
      <section className={styles.panel}>
        <div className={styles.sectionHeading}><div><p className={styles.kicker}>TRACKING HEALTH</p><h2>Know what is connected</h2><p>Website tracking, ad reporting and lead forms each have a separate purpose.</p></div></div>
        <div className={styles.connections}>
          <article><span className={styles.connectionDot} aria-hidden="true"/><div><h3>Website attribution</h3><strong>Available</strong><p>Stores campaign tags and referrers with visits and bookings.</p></div></article>
          <article><span className={business.google_ads_id ? styles.connectionDot : styles.connectionDotMuted} aria-hidden="true"/><div><h3>Google conversion tags</h3><strong>{business.google_ads_id ? "Configured" : "Not configured"}</strong><p>Conversion tags only. Google campaign spend is not imported automatically.</p></div></article>
          <article><span className={business.meta_pixel_id ? styles.connectionDot : styles.connectionDotMuted} aria-hidden="true"/><div><h3>Meta website tracking</h3><strong>{business.meta_pixel_id ? "Configured" : "Not configured"}</strong><p>Pixel and conversion tracking. Ad reporting and instant forms connect separately.</p></div></article>
        </div>
      </section>
      <details className={`${styles.panel} ${styles.disclosure}`}><summary>Meta ad reporting</summary><p className={styles.footnote}>Review imported spend and the existing account connection. These costs are not added to manual spend.</p><div className={styles.embedded}><AdsPerformance report={rep}/></div></details>
      {allowedSections.includes("leads") && <details className={`${styles.panel} ${styles.disclosure}`}><summary>Facebook instant-form leads</summary><div className={styles.embedded}><MetaLeadForms/></div></details>}
      <section className={`${styles.panel} ${styles.phoneNote}`}><h3>Calls to your regular phone number</h3><p>A shared phone number cannot reveal which ad brought a caller. Keep the source as “Phone” unless a tracking number or call report confirms it.</p>{allowedSections.includes("leads") && <Link className={styles.textLink} href="/admin/leads">Open leads</Link>}</section>
    </>}
  </div>;
}
