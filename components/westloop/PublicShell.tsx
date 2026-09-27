"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { track } from "./Tracking";
import type { BusinessSettings } from "@/lib/platform/types";

export function CeramicMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`ceramics-mark ${className}`} width="32" height="32" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M48.9 14.5a24 24 0 1 0 0 35" stroke="currentColor" strokeWidth="1.4" />
      <path d="M44 20.2a16.3 16.3 0 1 0 0 23.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M39 26a8.5 8.5 0 1 0 0 12" stroke="currentColor" strokeWidth="1.4" />
      <path d="M43 32h13M49.5 25.5v13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark ceramics-wordmark">
      <CeramicMark />
      <span className="ceramics-wordmark-type">WEST LOOP<small>CERAMICS</small></span>
    </span>
  );
}

export function CallLink({ phone, className = "" }: { phone: string; className?: string }) {
  return phone ? (
    <a className={className} href={"tel:" + phone.replace(/[^+\d]/g, "")} onClick={() => track("phone_clicked")}>
      Call the studio <span aria-hidden="true">↗</span>
    </a>
  ) : (
    <Link className={className} href="/contact">Talk to us <span aria-hidden="true">↗</span></Link>
  );
}

const navigation = [
  { href: "/services/ceramic-coating", label: "Ceramic coatings", feature: true },
  { href: "/services", label: "Services" },
  { href: "/#process", label: "Our process" },
  { href: "/gallery", label: "Our work" },
  { href: "/contact", label: "Contact" },
];

export function PublicHeader({ business }: { business: BusinessSettings }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  return (
    <>
      <div className="ceramics-announcement"><span>PROTECTION. REFINEMENT. EVERY DAY.</span><span>WEST LOOP · CHICAGO</span></div>
      <header ref={header} className="ceramics-header" data-menu-open={open}>
        <Link href="/" className="ceramics-home" aria-label={`${business.name} home`} onClick={() => setOpen(false)}>
          {business.logo_url && business.name !== BRAND_NAME ? (
            <Image className="custom-logo" src={business.logo_url} alt={business.name} width={210} height={54} unoptimized />
          ) : <Wordmark />}
        </Link>
        <nav id="ceramics-navigation" className={open ? "ceramics-nav is-open" : "ceramics-nav"} aria-label="Main navigation">
          <span className="ceramics-menu-caption">THE STUDIO</span>
          {navigation.map(({ href, label, feature }) => (
            <Link key={href} href={href} className={feature ? "ceramics-nav-feature" : undefined} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpen(false)}>
              {label}<span className="ceramics-nav-arrow" aria-hidden="true">↗</span>
            </Link>
          ))}
          <Link href="/booking" className="ceramics-menu-book" onClick={() => setOpen(false)}>Book an appointment <span aria-hidden="true">↗</span></Link>
          <p className="ceramics-menu-note">For the car you love. For the roads ahead.</p>
        </nav>
        <Link className="button ceramics-header-book" href="/booking">Book a detail <span aria-hidden="true">↗</span></Link>
        <button ref={toggle} className="ceramics-menu-toggle" aria-expanded={open} aria-controls="ceramics-navigation" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen((value) => !value)}>
          <span>{open ? "Close" : "Menu"}</span><span className="ceramics-menu-icon" aria-hidden="true"><i /><i /></span>
        </button>
      </header>
    </>
  );
}

export function PublicFooter({ business }: { business: BusinessSettings }) {
  return (
    <>
      <section className="ceramics-final-cta" aria-labelledby="final-cta-heading">
        <div className="wrap ceramics-final-inner">
          <div><p className="eyebrow">THE NEXT CHAPTER STARTS HERE</p><h2 id="final-cta-heading">For the car you love.<br /><em>For the roads ahead.</em></h2><p>Thoughtful preparation. A deeper finish. Care that continues beyond the studio.</p></div>
          <div className="ceramics-final-actions"><Link href="/booking" className="button">Find your appointment <span aria-hidden="true">↗</span></Link><Link href="/services/ceramic-coating" className="text-link">Explore ceramic protection <span aria-hidden="true">↗</span></Link></div>
        </div>
      </section>
      <footer className="ceramics-footer">
        <div className="wrap ceramics-footer-grid">
          <div className="ceramics-footer-brand"><Link href="/" aria-label={`${business.name} home`}><Wordmark /></Link><p>Considered care.<br />An exceptional finish.</p><span className="ceramics-footer-location">WEST LOOP, CHICAGO</span></div>
          <div><h3>Care & protection</h3><Link href="/services/ceramic-coating">Ceramic coatings</Link><Link href="/services/paint-correction">Paint correction</Link><Link href="/services/interior-detail">Interior detailing</Link><Link href="/services/exterior-detail">Exterior detailing</Link><Link href="/services">All services & pricing</Link></div>
          <div><h3>The studio</h3><Link href="/#process">Our process</Link><Link href="/gallery">Our work</Link><Link href="/booking">Book an appointment</Link><Link href="/contact">Talk to the team</Link>{business.instagram_url ? <a href={business.instagram_url} target="_blank" rel="noreferrer">Instagram <span aria-hidden="true">↗</span></a> : null}</div>
          <div className="ceramics-footer-contact"><h3>Plan your visit</h3><p>{business.address || "West Loop, Chicago"}</p><p>{business.hours_label || "By appointment"}</p>{business.phone ? <a href={"tel:" + business.phone.replace(/[^+\d]/g, "")} onClick={() => track("phone_clicked")}>{business.phone}</a> : null}{business.email ? <a href={"mailto:" + business.email}>{business.email}</a> : null}{!business.address ? <p className="ceramics-visit-note">Your appointment location is confirmed before your visit.</p> : null}</div>
          <div className="ceramics-service-area"><span>SERVING CHICAGO</span><p>{business.service_area || "West Loop and the surrounding Chicago neighborhoods."}</p></div>
          <div className="ceramics-footer-bottom"><span>© {new Date().getFullYear()} {business.name}</span><div><Link href="/privacy-notice">Privacy notice</Link><Link href="/service-rules">Service terms</Link><Link href="/admin">Team access</Link></div><span>CARE IN EVERY LAYER.</span></div>
        </div>
      </footer>
      <div className="mobile-bar ceramics-mobile-bar"><Link className="button" href="/booking">Book an appointment <span aria-hidden="true">↗</span></Link><CallLink phone={business.phone} className="button outline" /></div>
    </>
  );
}
