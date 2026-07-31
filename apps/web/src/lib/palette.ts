import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { useWhoAmI } from './session'

// UI-025: per-user color palette, the second theming axis alongside
// light/dark (lib/theme.ts). Same shape: server-authoritative, mirrored in
// localStorage so it applies before whoami resolves.

export const PALETTES = ['classic', 'ivory', 'graphite', 'indigo'] as const
export type Palette = (typeof PALETTES)[number]
const KEY = 'fc_palette'

function isPalette(v: unknown): v is Palette {
  return PALETTES.includes(v as Palette)
}

export function applyPalette(palette: Palette) {
  // `classic` is the base @theme token set — no attribute needed.
  if (palette === 'classic') delete document.documentElement.dataset.palette
  else document.documentElement.dataset.palette = palette
  try {
    localStorage.setItem(KEY, palette)
  } catch {
    /* ignore */
  }
}

// Apply the last-known palette immediately at module load (before React renders).
try {
  const saved = localStorage.getItem(KEY)
  if (isPalette(saved)) applyPalette(saved)
} catch {
  /* ignore */
}

export function usePalette(): { palette: Palette; set: (p: Palette) => void } {
  const who = useWhoAmI()
  const qc = useQueryClient()
  const [palette, setPaletteState] = useState<Palette>(() => {
    const current = document.documentElement.dataset.palette
    return isPalette(current) ? current : 'classic'
  })

  // Sync from the server value once whoami resolves.
  useEffect(() => {
    const serverPalette = who.data?.palette
    if (isPalette(serverPalette)) {
      setPaletteState(serverPalette)
      applyPalette(serverPalette)
    }
  }, [who.data?.palette])

  function set(next: Palette) {
    setPaletteState(next)
    applyPalette(next)
    void api.post('/api/set_palette', { palette: next }).then(() => {
      qc.setQueryData(['whoami'], (old: unknown) =>
        old && typeof old === 'object' ? { ...(old as object), palette: next } : old,
      )
    })
  }

  return { palette, set }
}
