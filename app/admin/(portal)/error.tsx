"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="paper">
      <h2>This section couldn't load.</h2>
      <p>Check your filters and database connection, then retry.</p>
      <button className="button" onClick={reset}>
        Retry
      </button>
    </div>
  );
}
