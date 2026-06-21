"use client";

import { siteConfig } from "@/lib/siteConfig";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-red">{siteConfig.brandName}</p>
        <h1 className="mt-3 text-4xl font-black uppercase leading-none">Admin Error</h1>
        <p className="mt-4 text-sm leading-6 text-ash">
          The admin area hit an unexpected problem. Nothing has been deleted, and you can safely try again.
        </p>
        <p className="mt-4 rounded-lg bg-red-soft px-4 py-3 text-sm font-black text-ink">
          {error.message || "The admin page could not be loaded."}
        </p>
        <button
          className="mt-5 rounded-lg bg-red px-5 py-4 font-black uppercase text-white transition hover:bg-red-dark"
          onClick={reset}
          type="button"
        >
          Reload Admin
        </button>
      </section>
    </main>
  );
}
