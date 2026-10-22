// Design-system guards (#380, OpenSpec change adopt-shop-floor-design-system).
//
// Two kinds of check, both read source files rather than a rendered page,
// because jsdom loads no stylesheet and computes no cascade:
//
//   1. Contrast. Every text colour must reach 4.5:1 and every control edge 3:1
//      against the surfaces it sits on, in light AND dark (WCAG 2.2 AA, 1.4.3
//      and 1.4.11). Values are read straight from src/index.css.
//   2. Rules. No screen may use a colour outside the token set, text under
//      12px, the browser's own number/date formatting, or a retired token or
//      class name. Files still waiting for the sweep are listed in
//      design-guards.pending.ts; a listed file that is already clean fails
//      too, so the list can only shrink. Stage 3 of the change deletes it.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { PENDING_SWEEP } from './design-guards.pending'

const WEB = join(__dirname, '..')
const CSS = readFileSync(join(WEB, 'src/index.css'), 'utf8')

// ---------------------------------------------------------------- tokens

/** The `--color-*: #hex` declarations inside the first block opened by `opener`. */
function colourBlock(opener: string): Record<string, string> {
  const start = CSS.indexOf(opener)
  if (start < 0) return {}
  const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase()
  return out
}

const light = colourBlock('@theme {')
// The dark block proper; palette-compound selectors are not the default theme.
const dark = { ...light, ...colourBlock("\n[data-theme='dark'] {") }

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const ROLES = [
  'canvas', 'surface', 'subtle', 'border', 'border-control',
  'ink', 'ink-muted', 'ink-subtle',
  'action', 'action-hover', 'action-ink', 'action-tint', 'focus',
  'negative', 'negative-tint', 'caution', 'caution-tint', 'positive', 'positive-tint',
  'opportunity', 'opportunity-tint', 'missing', 'missing-tint',
]
const SURFACES = ['surface', 'canvas', 'subtle']
const TEXT = ['ink', 'ink-muted', 'ink-subtle', 'action', 'negative', 'caution', 'positive', 'opportunity', 'missing']
const MEANING = ['negative', 'caution', 'positive', 'opportunity', 'missing']

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s tokens', (_mode, t) => {
  test('define every role', () => {
    expect(ROLES.filter((r) => !t[r])).toEqual([])
  })

  const textPairs: [string, string][] = [
    ...TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as [string, string])),
    ...MEANING.map((m) => [m, `${m}-tint`] as [string, string]),
    ['action', 'action-tint'],
    ['action-ink', 'action'],
    ['action-ink', 'action-hover'],
  ]
  test.each(textPairs)('text %s on %s reaches 4.5:1', (fg, bg) => {
    expect(t[fg] && t[bg], `${fg} or ${bg} undefined`).toBeTruthy()
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5)
  })

  const edgePairs: [string, string][] = ['border-control', 'focus'].flatMap((fg) =>
    ['surface', 'canvas'].map((bg) => [fg, bg] as [string, string]),
  )
  test.each(edgePairs)('control edge %s on %s reaches 3:1', (fg, bg) => {
    expect(t[fg] && t[bg], `${fg} or ${bg} undefined`).toBeTruthy()
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------- rules

const RULES: Record<string, RegExp> = {
  'raw palette class':
    /\b(?:bg|text|border|ring|divide|fill|stroke|outline|from|to|via|decoration|accent|caret|placeholder|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?(?:\/\d+)?\b/g,
  // A colour inside a string or an arbitrary Tailwind value; issue refs like (#380) are not colours.
  'literal colour': /[\['"`]#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
  'text under 12px': /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g,
  'browser-locale formatting': /\.toLocale(?:Date|Time)?String\(/g,
  'retired token':
    /--color-(?:brand(?:-dark|-tint)?|link|good(?:-tint|-text)?|danger(?:-tint|-text)?|warn(?:-tint|-text)?|border-strong|ink-faint|primary-btn(?:-hover|-ink)?)\b/g,
  'retired class': /\bfc-(?:card|input|btn-primary|btn|label|pill)\b/g,
}
// The one home of Indian number and date formatting may call Intl itself.
const RULE_EXEMPT: Record<string, string[]> = {
  'browser-locale formatting': ['src/lib/inr.ts'],
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [relative(WEB, p)] : []
  })
}

function violations(file: string): string[] {
  const text = readFileSync(join(WEB, file), 'utf8')
  return Object.entries(RULES).flatMap(([rule, re]) => {
    if (RULE_EXEMPT[rule]?.includes(file)) return []
    if (file.endsWith('.css') && rule !== 'retired token' && rule !== 'retired class') return []
    const hits = text.match(re) ?? []
    return hits.length ? [`${rule} ×${hits.length}`] : []
  })
}

const files = sources(join(WEB, 'src'))

test('every file outside the pending sweep follows the rules', () => {
  const broken = files
    .filter((f) => !PENDING_SWEEP.includes(f))
    .map((f) => [f, violations(f)] as const)
    .filter(([, v]) => v.length)
  expect(broken).toEqual([])
})

test('the pending sweep only lists files that still need it', () => {
  const clean = PENDING_SWEEP.filter((f) => !files.includes(f) || violations(f).length === 0)
  expect(clean, 'remove these from design-guards.pending.ts').toEqual([])
})
