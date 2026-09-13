import { SimpleAction } from "@/components/westloop/SimpleAction";
import { Wordmark } from "@/components/westloop/PublicShell";
export const metadata = {
  title: "Email Preferences",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; token?: string; channel?: string }>;
}) {
  const p = await searchParams;
  return (
    <main id="main" className="login-wrap">
      <div className="login-card">
        <Wordmark />
        <h1>Your preferences.</h1>
        <p>
          You can stop promotional email below. Essential appointment messages
          are not affected.
        </p>
        <SimpleAction
          kind="unsubscribe"
          values={{ id: p.id || "", token: p.token || "", channel: "email" }}
        />
      </div>
    </main>
  );
}
