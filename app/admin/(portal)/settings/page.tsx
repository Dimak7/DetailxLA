import { AdminPage } from "@/components/westloop/AdminPage";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AdminPage section="settings" searchParams={searchParams} />;
}
