import { SimpleAction } from "@/components/westloop/SimpleAction";
import { Wordmark } from "@/components/westloop/PublicShell";
export const metadata = {
  title: "Your Feedback",
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  return (
    <main id="main" className="login-wrap">
      <div className="login-card">
        <Wordmark />
        <h1>How did we do?</h1>
        <p>Honest feedback helps us take better care of you.</p>
        <SimpleAction
          kind="review"
          values={{ token: (await searchParams).token || "" }}
        />
      </div>
    </main>
  );
}
