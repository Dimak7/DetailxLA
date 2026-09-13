import { LoginForm } from "@/components/westloop/LoginForm";
export const metadata = {
  title: "Reset Password",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return <LoginForm token={(await searchParams).token || ""} />;
}
