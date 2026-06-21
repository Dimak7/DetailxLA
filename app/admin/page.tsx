import { redirect } from "next/navigation";
import { getAdminAuthConfigStatus, getAdminSession } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export default async function AdminIndexPage() {
  const config = getAdminAuthConfigStatus();
  if (!config.configured) {
    console.error("Admin index redirected to login because auth is not configured.", { missing: config.missing });
    redirect("/admin/login?error=config");
  }

  const session = await getAdminSession();
  redirect(session ? "/admin/dashboard" : "/admin/login");
}
