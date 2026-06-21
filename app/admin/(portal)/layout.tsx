import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/AdminShell";
import { getAdminAuthConfigStatus, getAdminSession } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const config = getAdminAuthConfigStatus();
  if (!config.configured) {
    console.error("Protected admin route blocked because auth is not configured.", { missing: config.missing });
    redirect("/admin/login?error=config");
  }

  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  return <AdminShell email={session.email}>{children}</AdminShell>;
}
