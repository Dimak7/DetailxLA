import { LoginForm } from "@/components/westloop/LoginForm";
export const metadata = {
  title: "Reset Password",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm token={params.token || ""} initialError={params.error ? "The reset link is invalid or expired, or the password is too short. Use 12–128 characters or request a new link." : ""} />;
}
