import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { getAdminAuthConfigStatus, getAdminSession } from "@/lib/adminAuth";
import { siteConfig } from "@/lib/siteConfig";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const config = getAdminAuthConfigStatus();
  const session = await getAdminSession();
  const errorMessage = getLoginErrorMessage(params?.error, config.missing);

  if (session) {
    redirect("/admin/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center bg-ink px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-red">{siteConfig.brandName}</p>
        <h1 className="mt-3 text-4xl font-black uppercase leading-none">Admin Login</h1>
        <p className="mt-4 text-sm leading-6 text-ash">Access the internal operations portal for schedule, bookings, clients, and invoices.</p>
        {errorMessage ? <p className="mt-4 rounded-lg bg-red-soft px-4 py-3 text-sm font-black text-ink">{errorMessage}</p> : null}
        <AdminLoginForm />
        <Link className="mt-5 inline-flex text-sm font-black uppercase text-ash hover:text-white" href="/">
          Back to public site
        </Link>
      </section>
    </main>
  );
}

function getLoginErrorMessage(error: string | undefined, missing: string[]) {
  if (missing.length) {
    return `Admin login is not configured. Missing: ${missing.join(", ")}.`;
  }

  if (error === "config") {
    return "Admin login is not configured. Check the admin environment variables.";
  }

  if (error) {
    return "Invalid admin credentials.";
  }

  return "";
}
