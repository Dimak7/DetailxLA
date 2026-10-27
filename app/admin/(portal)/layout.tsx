import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionFromToken, sessionCookie, access } from "@/lib/platform/auth";
import { AdminShell } from "@/components/westloop/AdminShell";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Business Workspace",
  robots: { index: false, follow: false },
};
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const user = await sessionFromToken(
    cookieStore.get(sessionCookie)?.value || "",
  );
  if (!user) redirect("/admin/login");
  const savedTheme = cookieStore.get("wl-admin-theme")?.value;
  return (
    <AdminShell
      user={user}
      initialTheme={savedTheme === "light" || savedTheme === "dark" ? savedTheme : undefined}
      sections={Object.keys(access).filter((k) =>
        access[k].includes(user.role),
      )}
    >
      {children}
    </AdminShell>
  );
}
