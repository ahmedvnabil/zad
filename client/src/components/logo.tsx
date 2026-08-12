// زاد (Zad) brand mark — three tributaries converging into one stream,
// ending in a unified node. Monoline, scales cleanly, uses the brand gradient.

let gradSeq = 0

export function Logo({ size = 26, className }: { size?: number; className?: string }) {
  // Unique gradient id per instance so multiple logos on a page don't collide.
  const id = `zad-grad-${gradSeq++}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="4" y1="6" x2="28" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-from, #22d3ee)" />
          <stop offset="1" stopColor="var(--brand-to, #0891b2)" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${id})`} strokeLinecap="round" fill="none">
        {/* three tributaries flowing in */}
        <path d="M4 7 C 11 7, 12 16, 18.5 16" strokeWidth="2.3" />
        <path d="M4 16 C 9 16, 12 16, 18.5 16" strokeWidth="2.3" />
        <path d="M4 25 C 11 25, 12 16, 18.5 16" strokeWidth="2.3" />
        {/* unified main stream */}
        <path d="M18.5 16 H 26" strokeWidth="3.1" />
      </g>
      <circle cx="27.4" cy="16" r="2.3" fill={`url(#${id})`} />
    </svg>
  )
}

// Header lockup: mark + Arabic wordmark.
export function BrandLockup() {
  return (
    <div className="flex items-center gap-2">
      <Logo size={26} />
      <span className="text-lg font-bold">زاد</span>
    </div>
  )
}
