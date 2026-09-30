"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { CeramicMark } from "./CeramicMark";
import { track } from "./Tracking";
import type { BusinessSettings } from "@/lib/platform/types";

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
      Call the studio
    </a>
  ) : (
    <Link className={className} href="/contact">Talk to us</Link>
  );
}

const navigation = [
  { href: "/services", label: "Services & prices", feature: true },
  { href: "/#detailing", label: "Detailing" },
  { href: "/services/ceramic-coating", label: "Ceramic coating" },
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
              {label}
            </Link>
          ))}
          <Link href="/booking" className="ceramics-menu-book" onClick={() => setOpen(false)}>Book an appointment</Link>
        </nav>
        <Link className="button ceramics-header-book" href="/booking">Book now</Link>
        <button ref={toggle} className="ceramics-menu-toggle" aria-expanded={open} aria-controls="ceramics-navigation" aria-label={open ? "Close navigation" : "Open navigation"} onClick={() => setOpen((value) => !value)}>
          <span>{open ? "Close" : "Menu"}</span><span className="ceramics-menu-icon" aria-hidden="true"><i /><i /></span>
        </button>
      </header>
    </>
  );
}

export function PublicFooter({ business, showBookingCTA = true, mobileBookingCTA = showBookingCTA }: { business: BusinessSettings; showBookingCTA?: boolean; mobileBookingCTA?: boolean }) {
  return (
    <>
      {showBookingCTA && <section className="ceramics-final-cta" aria-labelledby="final-cta-heading">
        <div className="wrap ceramics-final-inner">
          <div><p className="eyebrow">READY WHEN YOU ARE</p><h2 id="final-cta-heading">Give your car the finish it deserves.</h2><p>Choose a service and reserve a time online. We will confirm the details before your visit.</p></div>
          <div className="ceramics-final-actions"><Link href="/booking" className="button">Book an appointment</Link><Link href="/services" className="text-link">View services & pricing</Link></div>
        </div>
      </section>}
      <footer className="ceramics-footer">
        <div className="wrap ceramics-footer-grid">
          <div className="ceramics-footer-brand"><Link href="/" aria-label={`${business.name} home`}><Wordmark /></Link><p>Considered care.<br />An exceptional finish.</p><span className="ceramics-footer-location">WEST LOOP, CHICAGO</span></div>
          <div><h3>Detailing & protection</h3><Link href="/services/full-detail">Full detailing</Link><Link href="/services/interior-detail">Interior detailing</Link><Link href="/services/exterior-detail">Exterior detailing</Link><Link href="/services/paint-correction">Paint correction</Link><Link href="/services/ceramic-coating">Ceramic coatings</Link><Link href="/services">All services & pricing</Link></div>
          <div><h3>The studio</h3><Link href="/#process">Our process</Link><Link href="/gallery">Our work</Link><Link href="/booking">Book an appointment</Link><Link href="/contact">Talk to the team</Link>{business.instagram_url ? <a href={business.instagram_url} target="_blank" rel="noreferrer">Instagram</a> : null}</div>
          <div className="ceramics-footer-contact"><h3>Plan your visit</h3><p>{business.address || "West Loop, Chicago"}</p><p>{business.hours_label || "By appointment"}</p>{business.phone ? <a href={"tel:" + business.phone.replace(/[^+\d]/g, "")} onClick={() => track("phone_clicked")}>{business.phone}</a> : null}{business.email ? <a href={"mailto:" + business.email}>{business.email}</a> : null}{!business.address ? <p className="ceramics-visit-note">Your appointment location is confirmed before your visit.</p> : null}</div>
          <div className="ceramics-service-area"><span>SERVING CHICAGO</span><p>{business.service_area || "West Loop and the surrounding Chicago neighborhoods."}</p></div>
          <div className="ceramics-footer-bottom"><span>© {new Date().getFullYear()} {business.name}</span><div><Link href="/privacy-notice">Privacy notice</Link><Link href="/service-rules">Service terms</Link><a href="/hero/credits.txt" target="_blank" rel="noreferrer">Visual credits</a><Link href="/admin">Team access</Link></div></div>
        </div>
      </footer>
      <div className="mobile-bar ceramics-mobile-bar"><Link className="button" href={mobileBookingCTA ? "/booking" : "/contact"}>{mobileBookingCTA ? "Book appointment" : "Contact the studio"}</Link><CallLink phone={business.phone} className="button outline" /></div>
    </>
  );
}
