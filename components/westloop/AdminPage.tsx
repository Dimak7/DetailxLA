import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { sessionFromToken, sessionCookie, access } from "@/lib/platform/auth";
import { adminData } from "@/lib/platform/admin";
import { settings } from "@/lib/platform/settings";
import { AdminWorkspace } from "./AdminWorkspace";
export async function AdminPage({
  section,
  searchParams,
}: {
  section: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await sessionFromToken(
    (await cookies()).get(sessionCookie)?.value || "",
  );
  if (!user) redirect("/admin/login");
  if (!access[section]?.includes(user.role)) notFound();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams))
    if (typeof v === "string") params.set(k, v);
  const data = await adminData(section, params, user);
  return (
    <AdminWorkspace
      section={section}
      data={JSON.parse(JSON.stringify(data))}
      user={user}
      business={await settings()}
    />
  );
}
