"use client";

import Link from "next/link";
import { useState } from "react";
import type { Service } from "@/lib/platform/types";
import { serviceDuration, servicePrice } from "@/lib/service-content";
import { track } from "./Tracking";
import styles from "./ServiceMenu.module.css";

type Group = "All services" | "Detailing" | "Paint & protection" | "Other services";
const groups: Group[] = ["All services", "Detailing", "Paint & protection", "Other services"];
const priorities = ["full-detail", "interior-detail", "exterior-detail", "paint-correction", "ceramic-coating", "deep-interior-cleaning", "maintenance-detail", "headlight-restoration"];
const summaries: Record<string, string> = {
  "full-detail": "Interior and exterior cleaning in one visit.",
  "interior-detail": "Refresh seats, carpets and everyday cabin surfaces.",
  "exterior-detail": "Hand wash, wheels, tires and exterior finishing care.",
  "paint-correction": "Machine polishing to improve swirls and dull paint.",
  "ceramic-coating": "Protect prepared paint and make routine washing easier.",
  "deep-interior-cleaning": "Extra care for embedded dirt, stains and pet hair.",
  "maintenance-detail": "Regular interior and exterior upkeep between details.",
  "headlight-restoration": "Refresh cloudy headlight lenses and their finish.",
};

function serviceGroup(service: Service): Group {
  if (["paint-correction", "ceramic-coating"].includes(service.slug)) return "Paint & protection";
  if (["full-detail", "interior-detail", "exterior-detail", "deep-interior-cleaning", "maintenance-detail"].includes(service.slug)) return "Detailing";
  return "Other services";
}

function rank(service: Service) {
  const position = priorities.indexOf(service.slug);
  return position < 0 ? priorities.length : position;
}

function trackSelection(serviceId: string) {
  try {
    track("service_selected", { service_id: serviceId });
  } catch {
    // Analytics must not interrupt a customer's booking link.
  }
}

export function ServiceMenu({ services }: { services: Service[] }) {
  const [selected, setSelected] = useState<Group>("All services");
  const offered = services.filter((service) => service.active).sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order);
  const availableGroups = groups.filter((group) => group === "All services" || offered.some((service) => serviceGroup(service) === group));
  const selectedGroup = availableGroups.includes(selected) ? selected : "All services";
  const visible = offered.filter((service) => selectedGroup === "All services" || serviceGroup(service) === selectedGroup);

  if (!offered.length) {
    return <p className={styles.empty}>Our service menu is being updated. <Link href="/contact">Contact us to discuss your vehicle.</Link></p>;
  }

  return (
    <section id="all-services" className={styles.menu} aria-label="Choose a service">
      <div className={styles.menuBar}>
        <div className={styles.filters} role="group" aria-label="Filter services">
          {availableGroups.map((group) => <button key={group} type="button" aria-pressed={selectedGroup === group} onClick={() => setSelected(group)}>{group}</button>)}
        </div>
        <p className={styles.count} role="status">{visible.length} {visible.length === 1 ? "service" : "services"}</p>
      </div>
      <p className={styles.menuNote}>Sedan prices. Vehicle size and condition can affect the final price.</p>
      <div className={styles.grid}>
        {visible.map((service) => {
          const consultation = service.pricing_mode === "quote" || service.slug === "ceramic-coating";
          return (
            <article className={styles.card} key={service.id}>
              <div className={styles.cardTop}>
                <h2><Link href={`/services/${service.slug}`}>{service.name}</Link></h2>
                <p className={styles.price}>{servicePrice(service)}</p>
              </div>
              <p className={styles.summary}>{summaries[service.slug] || service.description || "Care tailored to your vehicle. View the service details."}</p>
              <div className={styles.cardBottom}>
                <span className={styles.duration}>{serviceDuration(service.duration_minutes)}{service.duration_minutes > 0 ? " estimated" : ""}</span>
                <div className={styles.actions}>
                  <Link className={styles.details} href={`/services/${service.slug}`}>Details<span className={styles.srOnly}> for {service.name}</span></Link>
                  <Link className="button small" href={`/booking?service=${encodeURIComponent(service.id)}`} onClick={() => trackSelection(service.id)}>{consultation ? "Get quote" : "Book"}<span className={styles.srOnly}> {service.name}</span></Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
