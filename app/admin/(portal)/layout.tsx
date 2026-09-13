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
  const user = await sessionFromToken(
    (await cookies()).get(sessionCookie)?.value || "",
  );
  if (!user) redirect("/admin/login");
  return (
    <AdminShell
      user={user}
      sections={Object.keys(access).filter((k) =>
        access[k].includes(user.role),
      )}
    >
      {children}
    </AdminShell>
  );
}
