"use client";

import Image from "next/image";
import { useState } from "react";
import { siteConfig } from "@/lib/siteConfig";

const navItems = [
  ["Services", "#services"],
  ["Difference", "#about"],
  ["Results", "#work"],
  ["Reviews", "#reviews"],
  ["FAQ", "#faq"],
];

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 py-3">
      <nav className="content-shell grid grid-cols-[1fr_auto] items-center gap-3 rounded-[1.2rem] border border-white/[0.12] bg-ink/[0.76] px-3 py-3 text-white shadow-[0_20px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl lg:grid-cols-[1fr_auto_1fr]">
        <a className="flex min-w-0 items-center gap-3" href="#top" onClick={() => setOpen(false)}>
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1.5 ring-1 ring-white/20">
            <Image src="/brand/detailx-logo.png" alt="DETAILX LA logo" width={48} height={48} className="h-full w-full object-contain" priority />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-black uppercase leading-none tracking-normal">{siteConfig.brandName}</span>
            <span className="mt-1 block text-xs font-bold uppercase text-ash">Los Angeles mobile detailing</span>
          </span>
        </a>

        <div className="hidden rounded-lg border border-white/[0.10] bg-white/[0.06] px-2 py-2 text-sm font-bold text-ash lg:flex">
          {navItems.map(([label, href]) => (
            <a className="rounded-lg px-4 py-2 transition hover:bg-white/10 hover:text-white" href={href} key={href}>
              {label}
            </a>
          ))}
        </div>

        <div className="hidden justify-end gap-3 lg:flex">
          <a className="rounded-lg border border-white/[0.15] px-4 py-3 text-sm font-black text-white transition hover:bg-white/10" href="#contact">
            Service Areas
          </a>
          <a className="rounded-lg bg-red px-5 py-3 text-sm font-black text-white shadow-[0_14px_36px_rgba(240,123,70,0.32)] transition hover:-translate-y-0.5 hover:bg-red-dark" href="#booking">
            Book Detail
          </a>
        </div>

        <button className="justify-self-end rounded-lg border border-white/20 px-4 py-3 text-sm font-black uppercase lg:hidden" type="button" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((value) => !value)}>
          Menu
        </button>
      </nav>

      {open ? (
        <div className="content-shell mt-2 grid gap-1 rounded-[1.2rem] border border-white/[0.15] bg-ink p-3 text-white shadow-2xl lg:hidden" id="mobile-menu">
          {navItems.map(([label, href]) => (
            <a className="rounded-lg px-3 py-3 font-bold text-ash hover:bg-white/10 hover:text-white" href={href} key={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <a className="rounded-lg px-3 py-3 font-bold text-ash hover:bg-white/10 hover:text-white" href="#contact" onClick={() => setOpen(false)}>
            Service Areas
          </a>
          <a className="rounded-lg bg-red px-3 py-3 text-center font-black text-white" href="#booking" onClick={() => setOpen(false)}>
            Book Detail
          </a>
        </div>
      ) : null}
    </header>
  );
}
