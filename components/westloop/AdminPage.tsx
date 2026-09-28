import { cookies } from "next/headers";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { sessionFromToken, sessionCookie, access, AppError } from "@/lib/platform/auth";
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
  let data;
  try {
    data = await adminData(section, params, user);
  } catch (error) {
    if (!(error instanceof AppError) || error.status !== 400) throw error;
    return <section className="paper"><h1>Check your filters</h1><p role="alert">{error.message}</p><Link className="button" href={`/admin/${section}`}>Reset filters</Link></section>;
  }
  return (
    <AdminWorkspace
      section={section}
      data={JSON.parse(JSON.stringify(data))}
      user={user}
      allowedSections={Object.keys(access).filter((key) => access[key].includes(user.role))}
      business={await settings()}
    />
  );
}
