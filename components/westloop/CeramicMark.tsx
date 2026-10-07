export function CeramicMark({ className = "ceramics-mark" }: { className?: string }) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d="M48.9 14.5a24 24 0 1 0 0 35" stroke="currentColor" strokeWidth="1.4" />
      <path d="M44 20.2a16.3 16.3 0 1 0 0 23.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M39 26a8.5 8.5 0 1 0 0 12" stroke="currentColor" strokeWidth="1.4" />
      <path d="M43 32h13M49.5 25.5v13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
