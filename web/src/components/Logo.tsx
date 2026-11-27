/**
 * GeoArena wordmark. The mark is an orienteering control flag:
 * a square split on the diagonal, flat, two solid colors.
 */
export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="1" y="1" width="18" height="18" rx="3" fill="#eef0f5" />
      <path d="M19 1v15a3 3 0 0 1-3 3H1z" fill="#ff7a2f" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[17px] font-semibold text-[#eef0f5] ${className}`}
    >
      <LogoMark />
      <span>GeoArena</span>
    </span>
  );
}
