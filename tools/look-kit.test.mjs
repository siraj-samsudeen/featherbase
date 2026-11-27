// The look kit (#1408) cannot drift from the components without a test saying so.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { BUILT, CLASSES, ICONS, SOURCE, build, declaredTokens, iconSvg, ruleBody, staleness, tokenDifferences, tokenGroups } from './look-kit.mjs'

const KIT = dirname(BUILT)

// A source and a kit of the real shapes, small enough to read.
const source = (action = '#1d4ed8', extra = '') => `
@import 'tailwindcss';
/* a comment with a brace-free note */
@theme static {
  --font-sans: 'Inter Variable',
    sans-serif;
  --color-canvas: #f4f5f7; /* page background */
  --color-action: ${action};${extra}
}
@media (pointer: coarse) {
  :root {
    --spacing-control: 3rem;
  }
}
@media screen {
  [data-theme='dark'] {
    --color-canvas: #0b1220;
    --color-action: #60a5fa;
  }
}
[data-featherbase-accent='green'] {
  --color-action: #1f6b4f;
}
@media screen {
  [data-featherbase-accent='green'][data-theme='dark'] {
    --color-action: #5fcf9c;
  }
}
:root { color-scheme: light; }
`
const kit = (action = '#1d4ed8') => `
/* header */
:root {
  --font-sans: 'Inter Variable', sans-serif;
  --color-canvas: #f4f5f7;
  --color-action: ${action};
}
@media (pointer: coarse) {
  :root { --spacing-control: 3rem; }
}
@media screen {
  [data-theme='dark'], [data-featherbase-theme='dark'] {
    --color-canvas: #0b1220;
    --color-action: #60a5fa;
  }
}
[data-featherbase-accent='green'] { --color-action: #1f6b4f; }
@media screen {
  [data-featherbase-accent='green'][data-theme='dark'], [data-featherbase-accent='green'][data-featherbase-theme='dark'] { --color-action: #5fcf9c; }
}
:root { --fb-icon-info: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"); }
.fb-card { border-radius: var(--radius-card); }
`

test('a rule body is found by its prelude, past comments and strings', () => {
  assert.equal(ruleBody('/* { */ a { x: "}" } b { y: 1 }', 'b').body.trim(), 'y: 1')
  assert.equal(ruleBody('a { x: 1 }', 'b'), null)
})

test('declared tokens keep their values, without comments or line breaks', () => {
  const tokens = declaredTokens("--a: 1px; /* why */ --b: 'x',\n   y; color: red;")
  assert.deepEqual([...tokens], [['--a', '1px'], ['--b', "'x', y"]])
})

test('every token group is read from the source and from the kit', () => {
  const groups = tokenGroups(source(), 'source')
  assert.equal(groups.get('light').get('--color-action'), '#1d4ed8')
  assert.equal(groups.get('light').get('--font-sans'), "'Inter Variable', sans-serif")
  assert.equal(groups.get('dark').get('--color-action'), '#60a5fa')
  assert.equal(groups.get('touch').get('--spacing-control'), '3rem')
  assert.equal(groups.get('green accent, dark').get('--color-action'), '#5fcf9c')
  assert.equal(tokenGroups(kit(), 'kit').get('light').size, 3, "the kit's icons are not counted as tokens")
})

test('a kit with the source’s tokens has no differences', () => {
  assert.deepEqual(tokenDifferences(source(), kit()), [])
})

test('a token that differs is named, with both values', () => {
  assert.deepEqual(tokenDifferences(source('#1d4ed8'), kit('#2457d6')), ['light: --color-action is #2457d6 in the kit, #1d4ed8 in the source'])
})

test('a token the kit lacks, and one it invents, are both named', () => {
  assert.deepEqual(tokenDifferences(source('#1d4ed8', '\n  --color-new: #123456;'), kit()), ['light: --color-new is missing from the kit (the source has #123456)'])
  assert.deepEqual(tokenDifferences(source(), kit().replace('--color-canvas: #f4f5f7;', '--color-canvas: #f4f5f7; --accent: #2457d6;')), [
    'light: --accent is in the kit but not in the source',
  ])
})

test('a source that has lost a token group fails by name', () => {
  assert.throws(() => tokenGroups(source().replace("[data-theme='dark'] {\n    --color-canvas", '.other {\n    --color-canvas'), 'source'), /Cannot find the dark tokens/)
})

// --- The real files ---

test('an icon keeps every shape, whether lucide writes it on one line or several', () => {
  // The warning triangle's outline is written over several lines; its two marks on one each.
  assert.equal((iconSvg('triangle-alert').match(/<path /g) ?? []).length, 3)
  for (const name of ICONS) assert.match(iconSvg(name), /<(path|circle|rect|line|polyline|polygon|ellipse) /, name)
})

test("the committed kit's tokens are the components' tokens, light and dark", () => {
  assert.deepEqual(tokenDifferences(readFileSync(SOURCE, 'utf8'), readFileSync(BUILT, 'utf8')), [])
})

test('the committed kit is what the generator builds today', () => {
  assert.deepEqual(staleness(), [])
  assert.equal(readFileSync(BUILT, 'utf8'), build())
})

/** The kit's script is a plain browser script: loading it sets `fbLook` on the global object. */
async function kitScript() {
  await import(pathToFileURL(join(KIT, 'featherbase-look.js')).href)
  return globalThis.fbLook
}

const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/

test('the kit’s classes take every colour from a token', () => {
  const css = readFileSync(CLASSES, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const offending = css.split('\n').filter((line) => RAW_COLOUR.test(line.replace(/color-mix\(in oklab/g, '')))
  assert.deepEqual(offending, [], 'a colour written out in look-kit/src/classes.css; use a token')
})

test('the kit’s own pages bring no colour, font or stylesheet of their own', () => {
  for (const file of readdirSync(KIT).filter((name) => name.endsWith('.html'))) {
    const html = readFileSync(join(KIT, file), 'utf8')
    // The data slot is data, not look.
    const look = html.replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '').replace(/&#\d+;|&#x[0-9a-f]+;/gi, '')
    assert.equal(RAW_COLOUR.test(look.replace(/color-mix\(in oklab/g, '')), false, `${file} writes a colour out; use a token`)
    assert.equal(/font-family\s*:(?!\s*var\(--font-sans\)|\s*ui-monospace)/.test(look), false, `${file} sets a font of its own`)
    assert.match(html, /<link rel="stylesheet" href="featherbase-look\.css">/, `${file} links the kit's stylesheet`)
    assert.equal(/<link[^>]+href="https?:|<script[^>]+src="https?:|@import/.test(html), false, `${file} loads something from outside the kit`)
  }
})

test('a donut’s ring gives each part its share, in the series colours', async () => {
  const fbLook = await kitScript()
  assert.equal(
    fbLook.donut([50, 25, 25]),
    'conic-gradient(var(--color-series-1) 0.00% 50.00%, var(--color-series-2) 50.00% 75.00%, var(--color-series-3) 75.00% 100.00%)',
  )
})
