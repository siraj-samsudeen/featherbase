// PROTOTYPE — THROWAWAY. Floating variant switcher for /admin/new-table.
// Dev-only: renders nothing in a production build.
import { useEffect } from 'react'

const VARIANTS: { key: string; name: string }[] = [
  { key: 'current', name: 'Current page' },
  { key: 'A', name: 'Name-first grid' },
  { key: 'B', name: 'Paste a list' },
  { key: 'C', name: 'Guided cards' },
]

export function currentVariant(): string {
  const v = new URLSearchParams(window.location.search).get('variant')
  return VARIANTS.some((x) => x.key === v) ? (v as string) : 'current'
}

export function PrototypeSwitcher({
  variant,
  onChange,
}: {
  variant: string
  onChange: (v: string) => void
}) {
  const idx = Math.max(0, VARIANTS.findIndex((v) => v.key === variant))

  function go(delta: number) {
    const next = VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length]
    const url = new URL(window.location.href)
    if (next.key === 'current') url.searchParams.delete('variant')
    else url.searchParams.set('variant', next.key)
    window.history.replaceState(null, '', url)
    onChange(next.key)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        t.isContentEditable
      )
        return
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Dev-only guard; loose cast because this tsconfig lacks vite/client types.
  if ((import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD) return null
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
      <button onClick={() => go(-1)} className="px-1 text-lg leading-none hover:text-amber-300" aria-label="Previous variant">
        ←
      </button>
      <span className="min-w-44 text-center font-medium">
        PROTOTYPE&ensp;{VARIANTS[idx].key === 'current' ? '' : `${VARIANTS[idx].key} — `}
        {VARIANTS[idx].name}
      </span>
      <button onClick={() => go(1)} className="px-1 text-lg leading-none hover:text-amber-300" aria-label="Next variant">
        →
      </button>
    </div>
  )
}
