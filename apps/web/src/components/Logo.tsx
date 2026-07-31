// The Featherbase mark: a tilted feather with a single wedge cut out of its
// vane. The notch is what keeps it from reading as a plain leaf, and it is the
// only detail — everything else is one silhouette, which is why the mark
// survives down to the 16px favicon where barb-by-barb designs turn to mush.
//
// Painted as a solid brand tile with the notch and shaft in the tile colour
// rather than punched out, so the mark needs no transparency and stays legible
// on any background. Shaft weight is 2.1 deliberately: thinner hairlines
// disappear at 16px. Sized by `className`.
export function Logo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
      <g transform="rotate(-32 16 16) translate(16 16) scale(1.08) translate(-16 -16)">
        <path d="M16 3.5C21 9.5 22 16.5 19 22.5L16 25.5L13 22.5C10 16.5 11 9.5 16 3.5Z" fill="#fff" />
        <path d="M16 24.5V29.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M19.9 12.5L23 15.5L18.6 17.2Z" fill="var(--color-brand)" />
        <path d="M16 3.5V25.5" stroke="var(--color-brand)" strokeWidth="2.1" />
      </g>
    </svg>
  )
}
