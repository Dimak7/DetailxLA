import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/lib/siteConfig";

const adminNav = [
  ["Dashboard", "/admin/dashboard"],
  ["Schedule", "/admin/schedule"],
  ["Bookings", "/admin/bookings"],
  ["Clients", "/admin/clients"],
  ["Invoices", "/admin/invoices"],
  ["Promotions", "/admin/promotions"],
  ["Settings", "/admin/settings"],
] as const;

export function AdminShell({ children, email }: { children: React.ReactNode; email: string }) {
  return (
    <div className="min-h-screen overflow-x-clip bg-smoke text-ink">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-ink/10 bg-ink px-4 py-5 text-white lg:block">
        <Link className="flex items-center gap-3" href="/admin/dashboard">
          <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-lg bg-white p-1.5">
            <Image src="/brand/detailx-logo.png" alt="DETAILX LA logo" width={48} height={48} className="h-full w-full object-contain" />
          </span>
          <span>
            <span className="block text-sm font-black uppercase">{siteConfig.brandName} Admin</span>
            <span className="text-xs font-bold uppercase text-ash">Operations portal</span>
          </span>
        </Link>
        <nav className="mt-8 grid gap-2">
          {adminNav.map(([label, href]) => (
            <Link className="rounded-lg px-4 py-3 text-sm font-black uppercase text-ash transition hover:bg-white/10 hover:text-white" href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-ink/10 bg-white/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-red">{siteConfig.brandName}</p>
              <p className="text-sm font-bold text-steel">Signed in as {email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="rounded-lg border border-ink/10 px-4 py-3 text-sm font-black uppercase text-ink transition hover:border-red/40" href="/">
                Public Site
              </Link>
              <form action="/api/admin/logout" method="post">
                <button className="rounded-lg bg-ink px-4 py-3 text-sm font-black uppercase text-white transition hover:bg-red" type="submit">
                  Logout
                </button>
              </form>
            </div>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {adminNav.map(([label, href]) => (
              <Link className="shrink-0 rounded-lg bg-smoke px-3 py-2 text-xs font-black uppercase text-ink" href={href} key={href}>
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto min-w-0 max-w-[1600px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

export function AdminPageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-red">{eyebrow}</p>
        <h1 className="mt-2 text-4xl font-black uppercase leading-none md:text-6xl">{title}</h1>
        {copy ? <p className="mt-3 max-w-3xl text-base leading-7 text-steel">{copy}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const color =
    status === "confirmed" || status === "paid"
      ? "bg-ink text-white"
      : status === "completed"
        ? "bg-green-100 text-green-900"
        : status === "cancelled" || status === "overdue"
          ? "bg-red-soft text-ink"
          : "bg-white text-ink ring-1 ring-ink/10";

  return <span className={`rounded-lg px-3 py-1 text-xs font-black uppercase ${color}`}>{status}</span>;
}

export function FlashMessage({ status, message }: { status?: string; message?: string }) {
  if (!status) {
    return null;
  }

  return (
    <p className={`mb-5 rounded-lg px-4 py-3 text-sm font-black uppercase ${status === "saved" ? "bg-ink text-white" : "bg-red-soft text-ink"}`}>
      {message || (status === "saved" ? "Admin update saved." : "Invoice could not be created. Check Stripe setup or booking data.")}
    </p>
  );
}

export function AdminErrorBanner({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="mb-5 rounded-lg border border-red/20 bg-red-soft px-4 py-4 text-sm font-bold leading-6 text-ink">
      {message}
    </div>
  );
}
