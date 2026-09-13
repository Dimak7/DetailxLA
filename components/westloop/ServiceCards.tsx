"use client";
import Link from "next/link";
import { useState } from "react";
import { money, type Service } from "@/lib/platform/types";
import { track } from "./Tracking";
export function ServiceCards({
  services,
  compact = false,
}: {
  services: Service[];
  compact?: boolean;
}) {
  const [category, setCategory] = useState("All care");
  const categories = ["All care", ...new Set(services.map((s) => s.category))];
  return (
    <>
      {!compact && (
        <div
          className="filter-row"
          role="group"
          aria-label="Service categories"
        >
          {categories.map((c) => (
            <button
              key={c}
              className={c === category ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="service-grid">
        {services
          .filter((s) => category === "All care" || s.category === category)
          .map((s, i) => (
            <article className="service-card" key={s.id}>
              <div className="service-top">
                <span className="service-index">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="pill">{s.category}</span>
              </div>
              <h3>{s.name}</h3>
              <p>{s.description}</p>
              <div className="service-price">
                <strong>
                  {s.pricing_mode === "quote"
                    ? "Let's discuss"
                    : (s.pricing_mode === "starting" ? "From " : "") +
                      money(s.price_cents)}
                </strong>
                <span>
                  {s.duration_minutes / 60} hr
                  {s.duration_minutes !== 60 ? "s" : ""} estimated
                </span>
              </div>
              {!compact && (
                <details
                  onToggle={(e) => {
                    if (e.currentTarget.open)
                      track("service_view", { service_id: s.id });
                  }}
                >
                  <summary>
                    What is included <span>+</span>
                  </summary>
                  <ul>
                    {s.includes.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                  {s.pricing_mode !== "quote" && (
                    <p className="fine-print">
                      SUV {money(s.price_cents + s.suv_extra_cents)} · Truck{" "}
                      {money(s.price_cents + s.truck_extra_cents)}
                    </p>
                  )}
                </details>
              )}
              <Link
                className="service-book"
                href={"/booking?service=" + s.id}
                onClick={() => track("service_selected", { service_id: s.id })}
              >
                Reserve this service <span>↗</span>
              </Link>
            </article>
          ))}
      </div>
    </>
  );
}
