export default function AdminPortalLoading() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="rounded-lg border border-ink/10 bg-white px-6 py-5 text-center shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.14em] text-red">DETAILX Admin</p>
        <p className="mt-3 text-lg font-black uppercase text-ink">Loading portal</p>
        <p className="mt-2 text-sm leading-6 text-steel">Checking your session and preparing dashboard data.</p>
      </div>
    </div>
  );
}
