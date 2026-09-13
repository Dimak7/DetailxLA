import { LoginForm } from "@/components/westloop/LoginForm";
export const metadata = {
  title: "Team Sign In",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <LoginForm />;
}
