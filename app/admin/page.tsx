import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { sessionFromToken, sessionCookie } from "@/lib/platform/auth";
import { adminLandingPage } from "@/lib/platform/admin-navigation";
export default async function Page() {
  const user = await sessionFromToken((await cookies()).get(sessionCookie)?.value || "");
  redirect(user ? adminLandingPage(user.role) : "/admin/login");
}
