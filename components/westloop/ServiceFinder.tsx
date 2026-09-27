"use client";
import { useState } from "react";
import Link from "next/link";
import { money, type Service } from "@/lib/platform/types";
import styles from "./ServiceFinder.module.css";
type Option = Pick<Service, "id" | "slug" | "name" | "price_cents" | "pricing_mode">;
const goals = [
  { label: "Protect my paint", slug: "ceramic-coating", copy: "Start with ceramic coating. We’ll assess your paint and discuss the preparation and aftercare that fit your car." },
  { label: "Restore the shine", slug: "paint-correction", copy: "Start with paint correction. An inspection helps us choose the right polishing approach for visible swirls and reduced clarity." },
  { label: "Refresh the interior", slug: "interior-detail", copy: "Start with an interior detail. For heavy staining or pet hair, ask us about deep interior cleaning." },
  { label: "Reset the whole car", slug: "full-detail", copy: "Start with a full detail: a considered interior and exterior reset, with the scope confirmed around your vehicle." },
];
export function ServiceFinder({ services }: { services: Option[] }) {
  const availableGoals = goals.filter((goal) => services.some((s) => s.slug === goal.slug));
  const [selected, setSelected] = useState(availableGoals[0]?.slug ?? "");
  const goal = availableGoals.find((item) => item.slug === selected);
  const service = services.find((item) => item.slug === selected);
  if (!goal || !service) return null;
  return <div className={styles.finder}>
    <div className={styles.intro}><p className="eyebrow">LET’S FIND YOUR STARTING POINT</p><h3>What would you like<br />to improve?</h3><p>A little direction makes the choice easier.</p></div>
    <div><div className={styles.options} role="group" aria-label="Choose your car care goal">{availableGoals.map((item) => <button key={item.slug} type="button" aria-pressed={selected === item.slug} onClick={() => setSelected(item.slug)}>{item.label}<span aria-hidden="true">↗</span></button>)}</div>
    <div className={styles.result} aria-live="polite" aria-atomic="true"><span className={styles.recommend}>YOUR STARTING POINT</span><div className={styles.resultTitle}><h4>{service.name}</h4><strong>{service.pricing_mode === "quote" ? "By consultation" : `${service.pricing_mode === "starting" ? "From " : ""}${money(service.price_cents)}`}</strong></div><p>{goal.copy}</p><div className={styles.links}><Link className="text-link" href={`/services/${service.slug}`}>See what’s included ↗</Link><Link className="button" href={`/booking?service=${service.id}`}>Choose this service ↗</Link></div></div></div>
  </div>;
}
