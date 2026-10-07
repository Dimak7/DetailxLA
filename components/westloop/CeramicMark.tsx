export function CeramicMark({ className = "ceramics-mark" }: { className?: string }) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="27" stroke="currentColor" strokeWidth="1.5" />
      <path d="m14.5 23 7.5 19 9.5-21 9 21 8-19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
      <path d="M33 17v30h16" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}
