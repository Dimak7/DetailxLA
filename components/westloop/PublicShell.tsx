"use client";
import Link from "next/link";
import { useState } from "react";
import { track } from "./Tracking";
import type { BusinessSettings } from "@/lib/platform/types";
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="monogram">
        WL
        <span />
      </span>
      <span>
        WEST LOOP<small>AUTO SPA</small>
      </span>
    </span>
  );
}
export function CallLink({
  phone,
  className = "",
}: {
  phone: string;
  className?: string;
}) {
  return phone ? (
    <a
      className={className}
      href={"tel:" + phone.replace(/[^+\d]/g, "")}
      onClick={() => track("phone_clicked")}
    >
      Call now <span aria-hidden="true">↗</span>
    </a>
  ) : (
    <Link className={className} href="/contact">
      Contact the spa <span aria-hidden="true">↗</span>
    </Link>
  );
}
export function PublicHeader({ business }: { business: BusinessSettings }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="announcement">
        A considered approach to car care. <span>WEST LOOP, CHICAGO</span>
      </div>
      <header className="public-header">
        <Link href="/" aria-label="West Loop Auto Spa home">
          {business.logo_url ? (
            <img
              className="custom-logo"
              src={business.logo_url}
              alt={business.name}
            />
          ) : (
            <Wordmark />
          )}
        </Link>
        <nav className={open ? "open" : ""} aria-label="Main navigation">
          <Link href="/services" onClick={() => setOpen(false)}>
            Our services
          </Link>
          <Link href="/gallery" onClick={() => setOpen(false)}>
            The finish
          </Link>
          <Link href="/#approach" onClick={() => setOpen(false)}>
            Our approach
          </Link>
          <Link href="/contact" onClick={() => setOpen(false)}>
            Visit us
          </Link>
        </nav>
        <Link className="button small" href="/booking">
          Book online <span>↗</span>
        </Link>
        <button
          className="menu-toggle"
          aria-expanded={open}
          aria-label="Toggle navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </header>
    </>
  );
}
export function PublicFooter({ business }: { business: BusinessSettings }) {
  return (
    <>
      <section className="final-cta wrap">
        <div>
          <p className="eyebrow">YOUR NEXT GOOD DECISION</p>
          <h2>
            Give your car
            <br />
            <em>the time it deserves.</em>
          </h2>
        </div>
        <Link href="/booking" className="button light">
          Find your appointment <span>↗</span>
        </Link>
      </section>
      <footer className="public-footer wrap">
        <div>
          <Link href="/">
            <Wordmark />
          </Link>
          <p>
            Exceptional care.
            <br />
            An extraordinary finish.
          </p>
        </div>
        <div>
          <h3>Explore</h3>
          <Link href="/services">Services & pricing</Link>
          <Link href="/booking">Book online</Link>
          <Link href="/gallery">Work gallery</Link>
          <Link href="/contact">Contact</Link>
        </div>
        <div>
          <h3>Find us</h3>
          <p>{business.address || "West Loop, Chicago"}</p>
          <p>{business.hours_label}</p>
          {business.phone && (
            <a
              href={"tel:" + business.phone}
              onClick={() => track("phone_clicked")}
            >
              {business.phone}
            </a>
          )}
          {business.email && (
            <a href={"mailto:" + business.email}>{business.email}</a>
          )}
        </div>
        <div>
          <h3>Stay connected</h3>
          {business.instagram_url && (
            <a href={business.instagram_url} target="_blank" rel="noreferrer">
              Instagram ↗
            </a>
          )}
          <Link href="/privacy-notice">Privacy notice</Link>
          <Link href="/service-rules">Service terms</Link>
          <Link href="/admin">Team login</Link>
        </div>
        <div className="footer-bottom">
          <span>
            © {new Date().getFullYear()} {business.name}
          </span>
          <span>CHICAGO, WITH CARE.</span>
        </div>
      </footer>
      <div className="mobile-bar">
        <Link className="button" href="/booking">
          Book online ↗
        </Link>
        <CallLink phone={business.phone} className="button outline" />
      </div>
    </>
  );
}
