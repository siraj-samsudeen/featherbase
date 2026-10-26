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
//      class name. Every rule is a hard zero over every source file.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

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
const darkOnly = colourBlock("\n  [data-theme='dark'] {")
const dark = { ...light, ...darkOnly }
// One palette: the light tokens and their dark values are the whole colour set.
const themes: [string, Record<string, string>][] = [
  ['light', light],
  ['dark', dark],
]

test('there is one palette: no palette selector, and every colour token is in the light or dark block', () => {
  expect(CSS).not.toContain('data-palette')
  expect(CSS.match(/--color-[a-z0-9-]+:/g)?.length).toBe(Object.keys(light).length + Object.keys(darkOnly).length)
})

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

  test('the series colours are distinct from each other', () => {
    const series = [1, 2, 3, 4, 5].map((n) => t[`series-${n}`])
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    for (let a = 0; a < series.length; a++)
      for (let b = a + 1; b < series.length; b++) {
        const [x, y] = [rgb(series[a]), rgb(series[b])]
        const distance = Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
        expect(distance, `series-${a + 1} vs series-${b + 1}`).toBeGreaterThan(90)
      }
  })

  test('the scrim behind a dialog is darker than the page, so it visibly dims it', () => {
    expect(luminance(t.scrim)).toBeLessThan(luminance(t.canvas))
    expect(ratio(t.canvas, t.scrim)).toBeGreaterThanOrEqual(1.1)
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
    // JSX attribute on SVG text or an element: fontSize={9.5} or fontSize="11"
    ...text.matchAll(/fontSize=\{?\s*['"]?(\d*\.?\d+)(px|rem|em|pt)?/g),
    ...text.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem|em|pt)/g),
  ]
  return sizes.filter((m) => px(Number(m[1]), m[2]) < 12).length
}

/** The opening tags of every <button …>, read with JSX braces balanced (so `=>` does not end a tag). */
function buttonTags(text: string): string[] {
  const tags: string[] = []
  for (const m of text.matchAll(/<button\b/g)) {
    let depth = 0
    let i = m.index!
    for (; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    tags.push(text.slice(m.index!, i + 1))
  }
  return tags
}

/** A button whose class flips to the selected look in a ternary, with no ARIA state to say so. */
const stateByColourAlone: Rule = (text) =>
  buttonTags(text).filter(
    (tag) =>
      /\?\s*(?:['"`][^'"`]*|\w+\([^)]*['"`][^'"`]*)\b(?:bg-action|border-action)\b/.test(tag) &&
      !/aria-(?:pressed|selected|expanded|current)/.test(tag),
  ).length

const RULES: Record<string, Rule> = {
  'raw palette class': count(new RegExp(String.raw`\b${UTILITY}-(?:${HUE}|white|black)(?:-\d{2,3})?(?:\/\d+)?\b`, 'g')),
  // A colour in a string or an arbitrary Tailwind value (issue refs like (#380) are not), a colour
  // function, or a named colour given to a colour property.
  'literal colour': (text, css) =>
    // In a stylesheet a hex follows a property's colon; in code, a colon before #123 is usually an issue ref.
    (text.match(css ? /(?:[\['"`,]|:\s*)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g : /[\['"`,]#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g) ?? []).length +
    // After a comma or a space (`, #fff`, `1px solid #ccc`) prose also has issue refs (`#12, #13`), so
    // there a colour must contain a letter a-f or be 6/8 digits long.
    (text.match(/(?<=,\s*|[^:\s]\s+)#(?:(?=[0-9]{0,7}[a-fA-F])(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})|[0-9]{8}|[0-9]{6})\b/g) ?? []).length +
    (text.match(/(?<![A-Za-z0-9-])(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb)\(/g) ?? []).length +
    (text.match(new RegExp(String.raw`\b(?:color|background|backgroundColor|borderColor|fill|stroke)\s*[:=]\s*\{?\s*['"](?:${NAMED})['"]`, 'g')) ?? []).length,
  'text under 12px': smallText,
  'browser-locale formatting': count(/\.toLocale(?:Date|Time)?String\(|\bIntl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat)\b/g),
  'retired token': (text) =>
    (text.match(new RegExp(String.raw`--color-${RETIRED}\b`, 'g')) ?? []).length +
    (text.match(new RegExp(String.raw`(?<![\w-])${UTILITY}-${RETIRED}(?![\w-])`, 'g')) ?? []).length,
  // A row count printed as a bare number ({total} rows) instead of through fmtCount.
  // On one line: {expr} then the word, where the word is display text (not a prop
  // `total=`, nor code like rows.push or total++), and the expression is not a
  // name or label. Also {n} {n === 1 ? 'row' : 'rows'}.
  'raw row count': count(
    /\$?\{(?![^{}\n]*fmt)(?![^{}\n]*\b(?:name|label|title)\b)[^{}\n]+\}[ \t]*(?:(?:rows|row(?=\{)|total|records?)\b(?![ \t]*[=:.(+-])|\{[^{}\n]*'rows?')/g,
  ),
  // A text box given small text directly (not through inputClasses, which keeps
  // 16px on touch): an iPhone zooms the page when it is tapped.
  'small input text': count(/<(?:input|select|textarea)\b[^>]*?className="[^"]*(?<![\w:-])text-(?:xs|sm)\b[^"]*"/g),
  // A toggle whose chosen state is shown only by its colour (usable-on-any-device).
  'state by colour alone': stateByColourAlone,
  'retired class': count(/(?<![\w-])fc-(?:card|input|btn-primary|btn|label|pill)(?![\w-])/g),
  // The scrim token is solid black; a backdrop must dim the page, not hide it,
  // so bg-scrim always carries an opacity (bg-scrim/40 for a dialog).
  'opaque scrim': count(/(?<![\w-])bg-scrim(?![\w/-])/g),
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
      ['bg-[#fff]', 'border-[var(--x,#d1d8dd)]', "background: 'linear-gradient(#fff, #f3f4f6)'", "border: '1px solid #ccc'", 'fill="#2490ef"', "color: '#abc'", '`#1c2126`', "'#ffffff80'", "'#fff8'", 'shadow-[0_1px_2px_rgba(0,0,0,.1)]', "color: 'hsl(0 0% 0%)'", 'oklch(0.6 0.2 250)', 'fill="white"', "color: 'red'", "backgroundColor: 'black'"],
      ['(#380)', 'see #150 for why', 'PR #92 review', 'issues #12, #13', 'epic #4332', 'fixes, #123', 'href="/x#anchor"', "fill: 'var(--color-action)'", 'the red band'],
    ],
    [
      'text under 12px',
      ['text-[10px]', 'text-[11.5px]', 'text-[0.6rem]', 'text-[8pt]', 'fontSize={9.5}', 'fontSize="11"', 'fontSize: 10', "fontSize: '0.7rem'", 'font-size: 11px'],
      ['text-xs', 'text-[12px]', 'text-[0.75rem]', 'fontSize: 14', 'fontSize={12}', 'text-[10pt]', 'text-[12pt]'],
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
    ['opaque scrim', ['bg-scrim', 'fixed inset-0 bg-scrim px-4', 'md:bg-scrim'], ['bg-scrim/40', 'bg-scrim/30 md:hidden', 'text-on-scrim', 'bg-scrimmer']],
    [
      'state by colour alone',
      [
        "<button onClick={() => set('a')} className={`px-3 ${v === 'a' ? 'bg-action text-action-ink' : 'bg-surface'}`}>",
        "<button className={pillClasses(`border ${on ? 'border-action bg-action/10' : 'border-border'}`)}>",
      ],
      [
        "<button aria-pressed={v === 'a'} onClick={() => set('a')} className={`${v === 'a' ? 'bg-action' : ''}`}>",
        "<button aria-expanded={open} className={`${open ? 'border-action' : ''}`}>",
        '<button className={buttonClasses({ variant: "primary" })}>',
      ],
    ],
    [
      'small input text',
      ['<input className="w-full text-sm" />', '<select value={v} className="text-xs border" >', '<textarea className="text-sm">'],
      ['<input className={inputClasses(\'text-sm\')} />', '<span className="text-xs">', '<input className="pointer-fine:text-sm" />'],
    ],
    [
      'raw row count',
      ['{total} total', '{rows.data?.total ?? 0} rows', '`${n} rows imported`', '{count} records', "{total} row{total === 1 ? '' : 's'}", "{n} {n === 1 ? 'row' : 'rows'}"],
      [
        '{fmtCount(total)} total', '`${fmtCount(n)} rows`', '{label} columns', '{row.name}',
        'done={parts.done} total={parts.total}', 'cols={columns} rows={data}', '`${sheet} row`',
        '}\n      rows.push(x)', 'if (a) { b } total++', '{ x } records.forEach(f)', '{name} total', '{t.label} rows',
      ],
    ],
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
    // Retired names are counted even in declarations: none may be defined.
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

/** Each rule's hits in a file, by line, so a failure says where to look. */
function hitsByRule(file: string): string[] {
  const text = readFileSync(join(WEB, file), 'utf8')
  const css = file.endsWith('.css')
  return Object.entries(RULES).flatMap(([rule, hits]) => {
    if (RULE_EXEMPT[rule]?.includes(file)) return []
    const lines = text.split('\n').flatMap((line, i) => (hits(line, css) > 0 ? [`${file}:${i + 1} ${rule}`] : []))
    return lines.length ? lines : hits(text, css) ? [`${file} ${rule}`] : []
  })
}

test('every rule is a hard zero over every source file', () => {
  expect(files.filter((f) => violations(f) > 0).flatMap(hitsByRule)).toEqual([])
})

// ---------------------------------------------------------------- the shell (home cleanup, 26-Oct-2026)
// Layout jsdom cannot measure, so the contract is read from the source.

const source = (file: string) => readFileSync(join(WEB, file), 'utf8')
/** The opening tag carrying `data-testid="<id>"`. */
const tagWith = (text: string, id: string) => {
  const at = text.indexOf(`data-testid="${id}"`)
  return at < 0 ? '' : text.slice(text.lastIndexOf('<', at), text.indexOf('>', at) + 1)
}

describe('the Admin shell', () => {
  const shell = source('src/pages/AdminLayout.tsx')

  test("the navbar's left zone is exactly the sidebar's width, with the sidebar's padding", () => {
    const zone = tagWith(shell, 'navbar-left-zone')
    expect(zone).toMatch(/\bmd:w-60\b/)
    expect(zone).toMatch(/\bmd:shrink-0\b/)
    expect(zone).toMatch(/\bmd:px-3\b/)
    // The sidebar's tag holds an arrow function, so read a window, not up to '>'.
    expect(shell).toMatch(/data-testid="admin-sidebar"[\s\S]{0,600}\bmd:w-60\b/)
    // The header gives up its own left padding at md+, so the zone starts where the sidebar does.
    expect(tagWith(shell, 'admin-navbar')).toMatch(/\bmd:pl-0\b/)
  })

  test('the command bar fills the space up to the bell, capped on very wide screens', () => {
    const bar = tagWith(shell, 'awesomebar')
    expect(bar).toMatch(/\bsm:flex-1\b/)
    expect(bar).toMatch(/\bsm:max-w-3xl\b/)
    expect(bar).not.toMatch(/\bmx-auto\b|\bsm:max-w-md\b/)
  })

  test('the shell draws no native select arrow: it uses the design-system Select', () => {
    expect(shell).not.toMatch(/<select\b/)
    expect(shell).toMatch(/<Select\s[^>]*id="admin-app-switcher"/)
  })

  test('the sidebar group headings look exactly like "Recently opened": muted, sentence case, small icon', () => {
    const cls = (id: string) => /className="([^"]+)"/.exec(tagWith(shell, id))?.[1]
    expect(cls('sidebar-group-heading')).toBe(cls('sidebar-recents-heading'))
    expect(cls('sidebar-group-heading')).toMatch(/\btext-ink-subtle\b/)
    expect(cls('sidebar-group-heading')).not.toMatch(/\buppercase\b/)
    expect(tagWith(shell, 'sidebar-item-icon')).toMatch(/\btext-ink-subtle\b/)
    // Past imports is a nav item, no longer a small underlined link.
    expect(shell).not.toMatch(/data-testid="past-imports-link"[^>]*underline/)
  })

  test("the Select primitive hides the browser's arrow and draws the chevron", () => {
    const field = source('src/components/ui/Field.tsx')
    expect(field).toMatch(/appearance-none/)
    expect(field).toMatch(/<ChevronDown[\s\S]*?pointer-events-none/)
  })
})

describe('Home and the sidebar speak one kind vocabulary', () => {
  const kinds = source('src/lib/kind-icons.tsx')
  test('each kind has one icon and one token tint, in one shared module', () => {
    for (const [kind, icon, tint] of [
      ['page', 'LayoutDashboard', 'opportunity'],
      ['row', 'FileText', 'action'],
      ['list', 'List', 'positive'],
    ])
      expect(kinds).toMatch(new RegExp(`${kind}: \\{ label: '[^']+', Icon: ${icon}, tint: 'bg-${tint}-tint text-${tint}' \\}`))
  })
  test('the feed, the sidebar and the command bar draw kinds from it, never their own labels', () => {
    for (const file of ['src/components/ActivityFeed.tsx', 'src/pages/AdminLayout.tsx']) {
      const text = source(file)
      expect(text).toMatch(/<KindIcon kind=/)
      expect(text).not.toMatch(/KIND_LABEL|KIND_STYLE|RECENT_KIND_LABEL/)
    }
  })
  test('section headings on Home and in the sidebar are sentence case, never all capitals', () => {
    for (const file of ['src/components/HomeRecall.tsx', 'src/components/HomePageView.tsx', 'src/components/ActivityFeed.tsx'])
      expect(source(file)).not.toMatch(/\buppercase\b/)
    const shell = source('src/pages/AdminLayout.tsx')
    expect(tagWith(shell, 'sidebar-recents-heading')).not.toMatch(/\buppercase\b/)
  })
})
