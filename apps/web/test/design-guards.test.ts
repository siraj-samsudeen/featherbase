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

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
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

const light = colourBlock('@theme static {')
// The dark block proper; palette-compound selectors are not the default theme.
const dark = { ...light, ...colourBlock("\n  [data-theme='dark'] {") }

// Until stage 3 removes the palette choice, every selectable palette must pass
// too. Cascade order in index.css: the default tokens, then dark, then the
// palette's own block (same specificity as dark, later in the file), then the
// palette's dark block (two attributes, most specific).
const PALETTES = ['ivory', 'graphite', 'indigo']
const themes: [string, Record<string, string>][] = [
  ['light', light],
  ['dark', dark],
  ...PALETTES.flatMap((p): [string, Record<string, string>][] => {
    const own = colourBlock(`[data-palette='${p}'] {`)
    const ownDark = colourBlock(`[data-palette='${p}'][data-theme='dark'] {`)
    return [
      [`${p} light`, { ...light, ...own }],
      [`${p} dark`, { ...dark, ...own, ...ownDark }],
    ]
  }),
]

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
  'scrim', 'on-scrim', 'series-1', 'series-2', 'series-3', 'series-4', 'series-5',
]
// Tailwind drops theme variables no utility uses from a plain @theme block, so
// a component reading var(--color-…) directly would get nothing in light mode
// in the production build. The token set is the design system's API: emit it whole.
test('control side padding is a density token: compact under a mouse, roomier on touch', () => {
  expect(CSS).toMatch(/@theme static \{[^}]*--spacing-control-x: 0\.75rem;/)
  expect(CSS).toMatch(/@media \(pointer: coarse\) \{\s*:root \{[^}]*--spacing-control-x: 1rem;/)
})

/** The stylesheet with every `@media screen { … }` block removed: what paper sees. */
function printOnly(css: string): string {
  let out = ''
  let i = 0
  for (const m of css.matchAll(/@media screen\s*\{/g)) {
    if (m.index! < i) continue
    out += css.slice(i, m.index)
    let depth = 0
    let j = m.index! + m[0].length - 1
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++
      else if (css[j] === '}' && --depth === 0) break
    }
    i = j + 1
  }
  return out + css.slice(i)
}

test('dark values only reach the screen, so a page printed in dark mode is dark ink on white paper', () => {
  expect(printOnly(CSS.replace(/\/\*[\s\S]*?\*\//g, ''))).not.toContain("[data-theme='dark']")
  expect(printOnly('a{} @media screen { b { c: d } } e{}')).toBe('a{}  e{}')
})

test('the token block is emitted whole in production (@theme static)', () => {
  expect(CSS).toMatch(/@theme static \{[^}]*--color-action-hover:/)
})

const SURFACES = ['surface', 'canvas', 'subtle']
const TEXT = ['ink', 'ink-muted', 'ink-subtle', 'action', 'negative', 'caution', 'positive', 'opportunity', 'missing']
const MEANING = ['negative', 'caution', 'positive', 'opportunity', 'missing']

describe.each(themes)('%s tokens', (_mode, t) => {
  test('define every role', () => {
    expect(ROLES.filter((r) => !t[r])).toEqual([])
  })

  const textPairs: [string, string][] = [
    ...TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as [string, string])),
    ...MEANING.map((m) => [m, `${m}-tint`] as [string, string]),
    ['action', 'action-tint'],
    ['action-ink', 'action'],
    ['action-ink', 'action-hover'],
    // Text on a filled meaning colour (a done tick, an ok/fail chip) and over the scrim.
    ['action-ink', 'negative'],
    ['action-ink', 'positive'],
    ['action-ink', 'caution'],
    ['on-scrim', 'scrim'],
  ]
  test.each(textPairs)('text %s on %s reaches 4.5:1', (fg, bg) => {
    expect(t[fg] && t[bg], `${fg} or ${bg} undefined`).toBeTruthy()
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5)
  })

  // Series colours mark dots and bars, so they need the non-text 3:1.
  const edgePairs: [string, string][] = ['border-control', 'focus', 'series-1', 'series-2', 'series-3', 'series-4', 'series-5'].flatMap((fg) =>
    ['surface', 'canvas'].map((bg) => [fg, bg] as [string, string]),
  )
  test.each(edgePairs)('control edge %s on %s reaches 3:1', (fg, bg) => {
    expect(t[fg] && t[bg], `${fg} or ${bg} undefined`).toBeTruthy()
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------- rules

// Each rule counts its hits in a file's text.
type Rule = (text: string, css: boolean) => number
const count = (re: RegExp): Rule => (text) => (text.match(re) ?? []).length

const UTILITY = String.raw`(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|divide|fill|stroke|outline|from|to|via|decoration|accent|caret|placeholder|shadow)`
const HUE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const RETIRED = String.raw`(?:brand(?:-dark|-tint)?|link|good(?:-tint|-text)?|danger(?:-tint|-text)?|warn(?:-tint|-text)?|border-strong|ink-faint|primary-btn(?:-hover|-ink)?)`
const NAMED = 'white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|silver|navy|teal|maroon|olive|lime|aqua|fuchsia|brown'

/** Font sizes below 12px, in a Tailwind arbitrary value, a style object or CSS. */
const smallText: Rule = (text) => {
  const px = (n: number, unit = 'px') => (unit === 'rem' || unit === 'em' ? n * 16 : unit === 'pt' ? (n * 4) / 3 : n)
  const sizes = [
    ...text.matchAll(/text-\[(\d*\.?\d+)(px|rem|em|pt)\]/g),
    ...text.matchAll(/fontSize:\s*['"]?(\d*\.?\d+)(px|rem|em|pt)?/g),
    ...text.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem|em|pt)/g),
  ]
  return sizes.filter((m) => px(Number(m[1]), m[2]) < 12).length
}

const RULES: Record<string, Rule> = {
  'raw palette class': count(new RegExp(String.raw`\b${UTILITY}-(?:${HUE}|white|black)(?:-\d{2,3})?(?:\/\d+)?\b`, 'g')),
  // A colour in a string or an arbitrary Tailwind value (issue refs like (#380) are not), a colour
  // function, or a named colour given to a colour property.
  'literal colour': (text, css) =>
    // In a stylesheet a hex follows a property's colon; in code, a colon before #123 is usually an issue ref.
    (text.match(css ? /(?:[\['"`,]|:\s*)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g : /[\['"`,]#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g) ?? []).length +
    (text.match(/(?<![A-Za-z0-9-])(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb)\(/g) ?? []).length +
    (text.match(new RegExp(String.raw`\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*[:=]\s*\{?\s*['"](?:${NAMED})['"]`, 'g')) ?? []).length,
  'text under 12px': smallText,
  'browser-locale formatting': count(/\.toLocale(?:Date|Time)?String\(|\bIntl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat)\b/g),
  'retired token': (text) =>
    (text.match(new RegExp(String.raw`--color-${RETIRED}\b`, 'g')) ?? []).length +
    (text.match(new RegExp(String.raw`(?<![\w-])${UTILITY}-${RETIRED}(?![\w-])`, 'g')) ?? []).length,
  'retired class': count(/(?<![\w-])fc-(?:card|input|btn-primary|btn|label|pill)(?![\w-])/g),
}
// The one home of Indian number and date formatting may call Intl itself.
const RULE_EXEMPT: Record<string, string[]> = {
  'browser-locale formatting': ['src/lib/inr.ts'],
}

describe('each rule catches what it is for and nothing else', () => {
  const probes: [string, string[], string[]][] = [
    [
      'raw palette class',
      ['text-gray-500', 'border-l-red-500', 'border-x-amber-200', 'ring-offset-blue-500', 'divide-gray-200', 'bg-white', 'bg-black/30'],
      ['text-ink-muted', 'bg-negative-tint', 'border-border-control'],
    ],
    [
      'literal colour',
      ['bg-[#fff]', 'border-[var(--x,#d1d8dd)]', 'fill="#2490ef"', "color: '#abc'", '`#1c2126`', "'#ffffff80'", "'#fff8'", 'shadow-[0_1px_2px_rgba(0,0,0,.1)]', "color: 'hsl(0 0% 0%)'", 'oklch(0.6 0.2 250)', 'fill="white"', "color: 'red'", "backgroundColor: 'black'"],
      ['(#380)', 'see #150 for why', 'PR #92 review', 'issues #12, #13', 'href="/x#anchor"', "fill: 'var(--color-action)'", 'the red band'],
    ],
    [
      'text under 12px',
      ['text-[10px]', 'text-[11.5px]', 'text-[0.6rem]', 'text-[8pt]', 'fontSize: 10', "fontSize: '0.7rem'", 'font-size: 11px'],
      ['text-xs', 'text-[12px]', 'text-[0.75rem]', 'fontSize: 14', 'text-[10pt]', 'text-[12pt]'],
    ],
    [
      'browser-locale formatting',
      ['n.toLocaleString()', 'd.toLocaleDateString()', 'new Intl.NumberFormat()', 'Intl.DateTimeFormat("en-IN")'],
      ['fmtCount(n)', 'fmtDate(d)'],
    ],
    [
      'retired token',
      ['var(--color-brand)', 'text-[var(--color-danger)]', 'text-brand', 'bg-danger-tint', 'border-border-strong', 'bg-primary-btn', 'hover:text-link'],
      ['text-action', 'bg-negative-tint', 'border-border-control', 'text-ink-subtle', 'border-border'],
    ],
    ['retired class', ['fc-btn', 'fc-btn-primary', 'fc-card'], ['buttonClasses()', 'fc-btnx', 'my-fc-card']],
  ]
  describe.each(probes)('%s', (rule, caught, ignored) => {
    test.each(caught)('catches %s', (s) => expect(RULES[rule](s, false)).toBeGreaterThan(0))
    test.each(ignored)('ignores %s', (s) => expect(RULES[rule](s, false)).toBe(0))
  })
})

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [relative(WEB, p)] : []
  })
}

/**
 * Total rule hits in a source text. In a stylesheet, custom-property
 * declarations (`--color-ink: #111827;`) are the one place a colour literal
 * belongs, so only those lines are exempt — every other rule still applies.
 */
function countText(text: string, file: string): number {
  const css = file.endsWith('.css')
  const body = css ? text.replace(/^\s*--[\w-]+\s*:[^;]*;.*$/gm, '') : text
  return Object.entries(RULES).reduce((sum, [rule, hits]) => {
    if (RULE_EXEMPT[rule]?.includes(file)) return sum
    // Retired names are counted even in declarations: stage 3 deletes them too.
    return sum + hits(rule === 'retired token' ? text : body, css)
  }, 0)
}
function violations(file: string): number {
  return countText(readFileSync(join(WEB, file), 'utf8'), file)
}

describe('stylesheets are checked too, except their token declarations', () => {
  test.each([
    ['.x { color: #fff; }', 1],
    ['.x { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }', 1],
    ['.x { font-size: 10px; }', 1],
    ['  --color-ink: #111827;', 0],
    ['  --color-scrim: rgb(11 18 32);', 0],
  ])('%s → %i', (css, n) => {
    expect(countText(css, 'probe.css')).toBe(n)
  })
})

const files = sources(join(WEB, 'src'))

// The pending list as first written (22-Oct-2026). Files may leave it and their
// counts may drop; nothing may be added or rise. Adding a file means editing
// this ceiling, which a reviewer will see.
const CEILING: Record<string, number> = {
  'src/components/ActivityFeed.tsx': 20,
  'src/components/ActivityTimeline.tsx': 6,
  'src/components/Assignments.tsx': 6,
  'src/components/Attachments.tsx': 8,
  'src/components/CalendarView.tsx': 9,
  'src/components/ChecklistView.tsx': 37,
  'src/components/ColumnCards.tsx': 28,
  'src/components/Comments.tsx': 13,
  'src/components/ConnectionsPanel.tsx': 26,
  'src/components/DashboardView.tsx': 8,
  'src/components/FormView.tsx': 83,
  'src/components/GanttView.tsx': 9,
  'src/components/HomePageView.tsx': 13,
  'src/components/HomeRecall.tsx': 14,
  'src/components/ImportOverview.tsx': 27,
  'src/components/JobMonitor.tsx': 10,
  'src/components/KanbanView.tsx': 6,
  'src/components/ListView.tsx': 104,
  'src/components/Logo.tsx': 5,
  'src/components/NamingControl.tsx': 4,
  'src/components/PasteColumns.tsx': 13,
  'src/components/Peek.tsx': 23,
  'src/components/PermissionManager.tsx': 9,
  'src/components/QueryReportView.tsx': 12,
  'src/components/ReportView.tsx': 27,
  'src/components/ScriptReportView.tsx': 13,
  'src/components/TableNaming.tsx': 11,
  'src/components/Tags.tsx': 11,
  'src/components/WorkflowActions.tsx': 5,
  'src/index.css': 161, // +2 on 22-Oct: rules now read stylesheets (the fc-card shadow's two rgba())
  'src/lib/settings.ts': 1,
  'src/pages/AccessTokens.tsx': 40,
  'src/pages/AdminLayout.tsx': 75,
  'src/pages/AllTables.tsx': 10,
  'src/pages/ColumnEditor.tsx': 33,
  'src/pages/Explore.tsx': 24,
  'src/pages/ImportBatches.tsx': 27,
  'src/pages/ImportWizard.tsx': 131,
  'src/pages/Login.tsx': 22,
  'src/pages/Portal.tsx': 11,
  'src/pages/PrintView.tsx': 9,
  'src/pages/PrototypeConnectSource.tsx': 57,
  'src/pages/RelationMap.tsx': 29,
  'src/pages/ResetPassword.tsx': 11,
  'src/pages/SalesTarget.tsx': 8,
  'src/pages/SourceBrowser.tsx': 21,
  'src/pages/TableBuilder.tsx': 47,
  'src/pages/TableMerge.tsx': 21,
  'src/pages/WebForm.tsx': 11,
  'src/router.tsx': 2,
}

/** What main has accepted: its pending pins, read from git. Null where main has none yet. */
function acceptedOnMain(): Record<string, number> | null {
  try {
    const src = execFileSync('git', ['show', 'origin/main:apps/web/test/design-guards.pending.ts'], {
      cwd: WEB,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return Object.fromEntries([...src.matchAll(/'([^']+)':\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]))
  } catch {
    return null
  }
}

/** Files added to the list, and pins above what was allowed. */
function ratchetBreaks(pins: Record<string, number>, allowed: Record<string, number>) {
  return {
    added: Object.keys(pins).filter((f) => !(f in allowed)),
    risen: Object.entries(pins).filter(([f, n]) => f in allowed && n > allowed[f]).map(([f]) => f),
  }
}

describe('the pending sweep is a ratchet', () => {
  test('a file outside the pending list has no violations', () => {
    const broken = files.filter((f) => !(f in PENDING_SWEEP)).map((f) => [f, violations(f)] as const).filter(([, n]) => n)
    expect(broken).toEqual([])
  })

  test('a pin cleaned on main cannot climb back, even below where it started', () => {
    // Codex's case: 20 at the start, 10 accepted on main, 15 proposed.
    expect(ratchetBreaks({ 'a.tsx': 15 }, { 'a.tsx': 10 })).toEqual({ added: [], risen: ['a.tsx'] })
    expect(ratchetBreaks({ 'a.tsx': 9, 'b.tsx': 1 }, { 'a.tsx': 10 })).toEqual({ added: ['b.tsx'], risen: [] })
  })

  test('no file joins the list and no pin rises above what main accepted (or the start, before main has a list)', () => {
    expect(ratchetBreaks(PENDING_SWEEP, acceptedOnMain() ?? CEILING)).toEqual({ added: [], risen: [] })
    expect(ratchetBreaks(PENDING_SWEEP, CEILING)).toEqual({ added: [], risen: [] })
  })

  test('each pinned count is exactly the file’s violations, so a fix must lower its pin', () => {
    const off = Object.entries(PENDING_SWEEP)
      .map(([f, n]) => [f, n, files.includes(f) ? violations(f) : 0] as const)
      .filter(([, pinned, actual]) => pinned !== actual)
    expect(off, 'set these pins to the actual count (and drop files at 0) in design-guards.pending.ts').toEqual([])
  })
})

// `DG_WRITE_PENDING=1 pnpm vitest run test/design-guards.test.ts` rewrites the
// pins to the actual counts after a sweep. The ceiling above still refuses any
// file or count that went up.
if (process.env.DG_WRITE_PENDING) {
  test('write the pending pins', () => {
    const rows = files.map((f) => [f, violations(f)] as const).filter(([, n]) => n > 0)
    writeFileSync(
      join(WEB, 'test/design-guards.pending.ts'),
      '// Files still waiting for the design-system sweep (#380), each pinned to its exact\n' +
        '// number of rule violations. A pin may only drop; a file at zero leaves the list.\n' +
        '// Regenerate with DG_WRITE_PENDING=1 (see design-guards.test.ts). Stage 3 deletes this file.\n' +
        'export const PENDING_SWEEP: Record<string, number> = {\n' +
        rows.map(([f, n]) => `  '${f}': ${n},\n`).join('') +
        '}\n',
    )
  })
}
