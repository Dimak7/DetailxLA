import { AdminPage } from "@/components/westloop/AdminPage";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <AdminPage section={(await params).section} searchParams={searchParams} />
  );
}
