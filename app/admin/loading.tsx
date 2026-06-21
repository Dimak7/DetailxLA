import { siteConfig } from "@/lib/siteConfig";

export default function AdminLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.06] p-6 text-center shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-red">{siteConfig.brandName}</p>
        <h1 className="mt-3 text-3xl font-black uppercase leading-none">Loading admin</h1>
        <p className="mt-4 text-sm leading-6 text-ash">Checking your session and getting the portal ready.</p>
      </section>
    </main>
  );
}
