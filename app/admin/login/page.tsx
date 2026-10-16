import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionCookie, sessionFromToken } from "@/lib/platform/auth";
import { adminLandingPage } from "@/lib/platform/admin-navigation";
import { LoginForm } from "@/components/westloop/LoginForm";
export const metadata = {
  title: "Team Sign In",
  robots: { index: false, follow: false },
};
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await sessionFromToken((await cookies()).get(sessionCookie)?.value || "");
  if (user) redirect(adminLandingPage(user.role));
  const params = await searchParams;
  const messages: Record<string, string> = {
    credentials: "Invalid email or password.",
    "rate-limit": "Too many requests. Please try again shortly.",
    unavailable: "We could not sign you in. Please try again.",
    reset: "We could not complete the password reset. Please try again or ask your manager to update your login.",
  };
  return <LoginForm initialError={typeof params.error === "string" ? messages[params.error] || "" : ""} initialMessage={params.reset === "complete" ? "Your password has been changed. You can sign in now." : params.reset === "requested" ? "If this account exists, a reset email will be sent when email is configured." : ""} />;
}
