"use client";

import Link from "next/link";
import { useState } from "react";

type ServiceMenuItem = {
  title: string;
  code: string;
  tone: string;
  description: string;
  price: string;
  pricingNote?: string;
  pricing?: {
    sedan: string;
    suv: string;
    truck: string;
  };
  includes: readonly string[];
  image: string;
  category: string;
  recommended: boolean;
  ctaLabel: string;
};

export function ServiceMenu({ services }: { services: readonly ServiceMenuItem[] }) {
  const [openService, setOpenService] = useState<string | null>(services[0]?.title ?? null);
  const packageServices = services.filter((service) => service.category === "Detailing");
  const premiumServices = services.filter((service) => service.category !== "Detailing");

  return (
    <div className="mt-12 space-y-10">
      <div className="grid gap-4 xl:grid-cols-3">
        {packageServices.map((service) => {
          const isFeatured = service.recommended;
          const isOpen = openService === service.title;

          return (
            <article className={`motion-card overflow-hidden rounded-lg ${isFeatured ? "bg-ink text-white shadow-[0_26px_90px_rgba(5,5,6,0.34)]" : "bg-white text-ink soft-ring"}`} key={service.title}>
              <div className="relative h-44">
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${service.image})` }} />
                <div className={`absolute inset-0 ${isFeatured ? "bg-[linear-gradient(180deg,rgba(5,5,6,0.18),rgba(5,5,6,0.88))]" : "bg-[linear-gradient(180deg,rgba(5,5,6,0.05),rgba(5,5,6,0.62))]"}`} />
                <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-5">
                  <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg text-sm font-black ${isFeatured ? "bg-red text-white" : "bg-white text-ink"}`}>
                    {service.code}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {isFeatured ? <span className="rounded-lg bg-red px-3 py-2 text-xs font-black uppercase text-white">Most Popular</span> : null}
                    <p className="rounded-lg bg-white px-3 py-2 text-sm font-black uppercase text-ink">{service.price}</p>
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                  <p className="text-sm font-black uppercase text-red-soft">{service.tone}</p>
                  <h3 className="mt-2 text-3xl font-black uppercase leading-none">{service.title}</h3>
                </div>
              </div>
              <div className="p-5">
                <p className={`text-sm leading-7 ${isFeatured ? "text-ash" : "text-steel"}`}>{service.description}</p>
                {service.pricingNote ? <p className={`mt-3 text-xs leading-5 ${isFeatured ? "text-ash" : "text-steel"}`}>{service.pricingNote}</p> : null}
                <ServicePriceDisplay service={service} featured={isFeatured} />

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <button
                    aria-expanded={isOpen}
                    className={`flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left text-sm font-black uppercase transition ${
                      isFeatured ? "border-white/15 bg-white/[0.06] hover:bg-white/[0.1]" : "border-ink/10 bg-smoke hover:border-red/35"
                    }`}
                    onClick={() => setOpenService(isOpen ? null : service.title)}
                    type="button"
                  >
                    <span>What&apos;s included</span>
                    <span className={`grid h-8 w-8 place-items-center rounded-md bg-red text-lg leading-none text-white transition duration-300 ${isOpen ? "rotate-45" : ""}`}>+</span>
                  </button>
                  <Link
                    className={`inline-flex items-center justify-center rounded-lg px-5 py-4 text-sm font-black uppercase transition ${
                      isFeatured ? "bg-red text-white hover:bg-red-dark" : "bg-ink text-white hover:bg-charcoal"
                    }`}
                    href={`/?service=${encodeURIComponent(service.title)}#booking`}
                  >
                    {service.ctaLabel || `Book ${service.title}`}
                  </Link>
                </div>

                <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                    <ul className={`mt-4 grid gap-3 rounded-lg border p-4 text-sm leading-6 ${isFeatured ? "border-white/10 bg-white/[0.04] text-ash" : "border-ink/10 bg-smoke text-steel"}`}>
                      {service.includes.map((item) => (
                        <li className="flex gap-3" key={item}>
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="rounded-lg border border-red/15 bg-red-soft/50 px-5 py-4 text-sm font-bold text-ink">
        Paint correction is not included in standard detailing packages. It remains a separate premium service starting at $300+.
      </div>

      <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="eyebrow">Premium add-ons</p>
            <h3 className="text-3xl font-black uppercase leading-none text-ink md:text-4xl">Protection and specialty services.</h3>
          </div>
          <p className="max-w-2xl text-sm leading-7 text-steel">For coating, correction, restoration, or recurring maintenance, open the details to review what is included before you reserve a time.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {premiumServices.map((service) => {
            const isOpen = openService === service.title;
            return (
              <article className="motion-card rounded-lg bg-white p-5 text-ink soft-ring" key={service.title}>
                <div className="flex items-start justify-between gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ink text-sm font-black text-white">{service.code}</div>
                  <p className="rounded-lg bg-red-soft px-3 py-2 text-sm font-black uppercase text-red">{service.price}</p>
                </div>
                <p className="mt-8 text-sm font-black uppercase text-red">{service.tone}</p>
                <h4 className="mt-3 text-2xl font-black uppercase leading-none">{service.title}</h4>
                <p className="mt-4 text-sm leading-7 text-steel">{service.description}</p>
                {service.pricingNote ? <p className="mt-3 text-xs leading-5 text-steel">{service.pricingNote}</p> : null}
                <ServicePriceDisplay service={service} featured={false} />
                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <button
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 rounded-lg border border-ink/10 bg-smoke p-4 text-left text-sm font-black uppercase transition hover:border-red/35"
                    onClick={() => setOpenService(isOpen ? null : service.title)}
                    type="button"
                  >
                    <span>What&apos;s included</span>
                    <span className={`grid h-8 w-8 place-items-center rounded-md bg-red text-lg leading-none text-white transition duration-300 ${isOpen ? "rotate-45" : ""}`}>+</span>
                  </button>
                  <Link className="inline-flex items-center justify-center rounded-lg bg-ink px-5 py-4 text-sm font-black uppercase text-white transition hover:bg-charcoal" href={`/?service=${encodeURIComponent(service.title)}#booking`}>
                    {service.ctaLabel || `Book ${service.title}`}
                  </Link>
                </div>
                <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                  <div className="overflow-hidden">
                    <ul className="mt-4 grid gap-3 rounded-lg border border-ink/10 bg-smoke p-4 text-sm leading-6 text-steel">
                      {service.includes.map((item) => (
                        <li className="flex gap-3" key={item}>
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ServicePriceDisplay({ service, featured }: { service: ServiceMenuItem; featured: boolean }) {
  if (!service.pricing) {
    return (
      <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-black uppercase ${featured ? "border-white/10 bg-white/[0.04] text-white" : "border-ink/10 bg-smoke text-ink"}`}>
        {service.price}
      </div>
    );
  }

  return (
    <div className={`mt-4 grid gap-2 rounded-lg border p-3 text-sm ${featured ? "border-white/10 bg-white/[0.04]" : "border-ink/10 bg-smoke"}`}>
      {[
        ["Sedan", service.pricing.sedan],
        ["SUV", service.pricing.suv],
        ["Truck", service.pricing.truck],
      ].map(([vehicle, price]) => (
        <div className={`flex items-center justify-between gap-3 rounded-md px-3 py-2 font-black uppercase ${featured ? "bg-white/[0.06] text-white" : "bg-white text-ink"}`} key={vehicle}>
          <span className={featured ? "text-ash" : "text-steel"}>{vehicle}</span>
          <span>{price}</span>
        </div>
      ))}
    </div>
  );
}
