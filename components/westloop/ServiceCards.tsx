"use client";

import Link from "next/link";
import { useState } from "react";
import { money, type Service } from "@/lib/platform/types";
import { track } from "./Tracking";
import styles from "./ServiceDetails.module.css";

export function ServiceCards({ services, compact = false }: { services: Service[]; compact?: boolean }) {
  const [category, setCategory] = useState("All services");
  const categories = ["All services", ...new Set(services.map((service) => service.category))];
  const selectedCategory = categories.includes(category) ? category : "All services";
  const visible = services.filter((service) => compact || selectedCategory === "All services" || service.category === selectedCategory);
  return (
    <div className={styles.serviceCollection}>
      {!compact && <div className={styles.filters} role="group" aria-label="Filter services by category">{categories.map((item) => <button type="button" key={item} aria-pressed={item === selectedCategory} onClick={() => setCategory(item)}>{item}</button>)}</div>}
      {!compact && <p className={styles.resultCount} role="status">{visible.length} {visible.length === 1 ? "service" : "services"} {selectedCategory === "All services" ? "in the collection" : `in ${selectedCategory.toLowerCase()}`}</p>}
      <div className={`${styles.cardGrid} ${compact ? styles.compactGrid : ""}`}>
        {visible.map((service) => {
          return (
            <article className={styles.serviceCard} key={service.id} data-featured={service.slug === "ceramic-coating" || undefined}>
              <div className={styles.cardTop}><span>{service.category}</span>{service.slug === "ceramic-coating" && <span className={styles.signatureLabel}>SIGNATURE</span>}</div>
              <h3><Link href={`/services/${service.slug}`}>{service.name}</Link></h3><p className={styles.cardDescription}>{service.description}</p>
              <div className={styles.cardPrice}><strong>{service.pricing_mode === "quote" ? "By consultation" : `${service.pricing_mode === "starting" ? "From " : ""}${money(service.price_cents)}`}</strong><span>{service.duration_minutes / 60} {service.duration_minutes === 60 ? "hour" : "hours"} estimated</span></div>
              {!compact && <details className={styles.cardIncludes} onToggle={(event) => { if (event.currentTarget.open) track("service_view", { service_id: service.id }); }}><summary>What is included <span aria-hidden="true">+</span></summary><ul>{service.includes.map((item) => <li key={item}>{item}</li>)}</ul>{service.pricing_mode !== "quote" && <p className={styles.vehiclePrices}>{service.pricing_mode === "starting" ? "Starting prices · " : ""}SUV {money(service.price_cents + service.suv_extra_cents)} · Truck {money(service.price_cents + service.truck_extra_cents)}</p>}</details>}
              <div className={styles.cardLinks}><Link className={styles.textLink} href={`/services/${service.slug}`}>View details</Link><Link className={styles.cardBook} href={`/booking?service=${encodeURIComponent(service.id)}`} onClick={() => track("service_selected", { service_id: service.id })}>Book <span className={styles.srOnly}>{service.name}</span></Link></div>
            </article>
          );
        })}
      </div>
      {services.length === 0 && <p className={styles.sectionNote}>Our service menu is being updated. <Link href="/contact">Contact us to discuss your vehicle.</Link></p>}
    </div>
  );
}
