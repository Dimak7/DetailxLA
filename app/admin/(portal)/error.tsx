"use client";

export default function AdminPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg bg-white p-6 shadow-sm ring-1 ring-ink/10">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-red">Admin Recovery</p>
      <h1 className="mt-2 text-3xl font-black uppercase leading-none text-ink">This page hit an error</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-steel">
        DETAILX kept the admin shell alive so you can recover without losing the rest of the panel.
      </p>
      <p className="mt-4 rounded-lg bg-red-soft px-4 py-3 text-sm font-black text-ink">
        {error.message || "The admin page could not finish loading."}
      </p>
      <button
        className="mt-5 rounded-lg bg-ink px-5 py-3 font-black uppercase text-white transition hover:bg-red"
        onClick={reset}
        type="button"
      >
        Retry Page
      </button>
    </div>
  );
}
