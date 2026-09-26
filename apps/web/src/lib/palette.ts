import { getSessionUser } from './api'
import { useAppearancePreference } from './appearance-preference'

// UI-025: per-user color palette, the second theming axis alongside
// light/dark (lib/theme.ts). Same shape: server-authoritative, mirrored in
// localStorage so it applies before whoami resolves. The mirror key is
// scoped by user so two accounts sharing a browser never see each other's
// palette (PR #92 review).

export const PALETTES = ['classic', 'ivory', 'graphite', 'indigo'] as const
export type Palette = (typeof PALETTES)[number]

function storageKey(): string | null {
  const user = getSessionUser()
  return user ? `fc_palette:${user.row_id}` : null
}

function isPalette(v: unknown): v is Palette {
  return PALETTES.includes(v as Palette)
}

// The palette attribute selects the independent foreground roles in index.css.
export function applyPalette(palette: Palette) {
  // `classic` is the base @theme token set — no attribute needed.
  if (palette === 'classic') delete document.documentElement.dataset.palette
  else document.documentElement.dataset.palette = palette
  try {
    const key = storageKey()
    if (key) localStorage.setItem(key, palette)
  } catch {
    /* ignore */
  }
}

// Apply the last-known palette immediately at module load (before React
// renders). Signed out (no session user) there is no mirror — default look.
try {
  const key = storageKey()
  const saved = key ? localStorage.getItem(key) : null
  if (isPalette(saved)) applyPalette(saved)
} catch {
  /* ignore */
}

export function usePalette(): { palette: Palette; set: (p: Palette) => void } {
  const current = document.documentElement.dataset.palette
  const { value: palette, set } = useAppearancePreference(
    'palette', isPalette(current) ? current : 'classic', isPalette, applyPalette,
  )
  return { palette, set }
}
