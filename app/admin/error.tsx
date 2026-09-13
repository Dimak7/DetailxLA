"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="login-wrap">
      <div className="paper">
        <h1>Let's try that again.</h1>
        <p>
          The workspace couldn't load. Check database configuration or try
          again.
        </p>
        <button className="button" onClick={reset}>
          Retry
        </button>
      </div>
    </main>
  );
}
