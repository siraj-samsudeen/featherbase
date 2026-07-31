// The Featherbase mark: a quill feather, tilted, its vane split by the shaft
// and cut into stacked barb bands — a feather that also reads as rows of data.
// Painted as a solid brand tile with the cuts in the tile colour rather than
// punched out, so the mark stays legible on any background and needs no
// transparency. Sized by `className`; holds its silhouette down to 16px.
export function Logo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
      <g transform="rotate(-32 16 16) translate(16 16) scale(1.14) translate(-16 -16)">
        <path d="M16 3.5C20.5 9 21.5 15 19 20.5L16 23.5L13 20.5C10.5 15 11.5 9 16 3.5Z" fill="#fff" />
        <path d="M16 22.5V29" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <g stroke="var(--color-brand)" strokeWidth="2.5">
          <path d="M16 9L23.4 11.6" />
          <path d="M16 14L22.9 16.45" />
          <path d="M16 19L22.4 21.3" />
          <path d="M16 3.5V23.5" strokeWidth="2.3" />
        </g>
      </g>
    </svg>
  )
}
