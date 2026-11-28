#!/usr/bin/env node
// The look kit's stylesheet (#1408): one self-contained file that draws a plain
// HTML page in Featherbase's look, opened from disk with no build step.
//
//   packages/shop-floor/look-kit/featherbase-look.css   <- built here, committed
//
// It is put together from four parts, so none of them is kept by hand twice:
//   1. the tokens, light and dark, copied from packages/shop-floor/src/styles.css;
//   2. the icons, drawn from the same lucide set the components use;
//   3. the classes, written by hand in look-kit/src/classes.css;
//   4. the Inter font the app serves, embedded so the file needs nothing beside it.
//
//   node tools/look-kit.mjs           write the stylesheet
//   node tools/look-kit.mjs --check   fail when the committed one is stale, naming
//                                     each token that differs from the source
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOP_FLOOR = join(ROOT, 'packages/shop-floor')
export const SOURCE = join(SHOP_FLOOR, 'src/styles.css')
export const ICON_SET = join(SHOP_FLOOR, 'src/icons.ts')
export const CLASSES = join(SHOP_FLOOR, 'look-kit/src/classes.css')
export const BUILT = join(SHOP_FLOOR, 'look-kit/featherbase-look.css')

/** The icons a prototype can draw: lucide file names, each one in the components' own set (icons.ts). */
export const ICONS = [
  'arrow-down', 'arrow-up', 'calendar-days', 'chart-column', 'check', 'chevron-down', 'chevron-left', 'chevron-right',
  'circle-check', 'circle-x', 'clock', 'external-link', 'house', 'inbox', 'info', 'list-checks', 'pencil', 'plus',
  'search', 'target', 'triangle-alert', 'user-round', 'x',
]

/** The font subsets embedded: Latin, and Latin Extended, which holds the rupee sign. */
const FONT_SUBSETS = ['latin', 'latin-ext']

// ---------------------------------------------------------------------------
// Reading CSS: just enough to lift one rule's body out of a stylesheet.

/** The index of the next `brace` at or after `from` that is outside every comment and string, or -1. */
function next(css, brace, from) {
  for (let i = from; i < css.length; i++) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2)
      if (end === -1) return -1
      i = end + 1
    } else if (css[i] === '"' || css[i] === "'") {
      const end = css.indexOf(css[i], i + 1)
      if (end === -1) return -1
      i = end
    } else if (brace.includes(css[i])) return i
  }
  return -1
}

/** The index after the `}` that closes the `{` at `open`. */
function closing(css, open) {
  let depth = 0
  for (let i = next(css, '{}', open); i !== -1; i = next(css, '{}', i + 1)) {
    if (css[i] === '{') depth++
    else if (--depth === 0) return i + 1
  }
  throw new Error('Unbalanced braces in the stylesheet')
}

/**
 * The body of the first top-level rule whose prelude (the text before its `{`)
 * is exactly `prelude`, searching from `from`. Preludes are compared with their
 * white space collapsed. Returns null when there is none.
 */
export function ruleBody(css, prelude, from = 0) {
  const want = prelude.replace(/\s+/g, ' ').trim()
  let i = from
  while (i < css.length) {
    const open = next(css, '{', i)
    if (open === -1) return null
    // The prelude runs back to the previous `}`, `;` or `{`, or a comment's end.
    let start = open
    while (start > 0 && !'{};'.includes(css[start - 1]) && css.slice(start - 2, start) !== '*/') start--
    const got = css.slice(start, open).replace(/\s+/g, ' ').trim()
    const end = closing(css, open)
    if (got === want) return { body: css.slice(open + 1, end - 1), start, end }
    i = end // only this level: a rule nested in another is reached through bodyAt()
  }
  return null
}

/** The custom properties a rule body declares, in order: name -> value, comments and line breaks dropped. */
export function declaredTokens(body) {
  const tokens = new Map()
  for (const part of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const name = part.slice(0, colon).trim()
    if (name.startsWith('--')) tokens.set(name, part.slice(colon + 1).replace(/\s+/g, ' ').trim())
  }
  return tokens
}

// ---------------------------------------------------------------------------
// 1. Tokens

/**
 * Where each group of tokens sits: in the source (styles.css) and in the kit.
 * The kit names the dark theme twice: `data-theme` is what Featherbase's own
 * pages paint, and `data-featherbase-theme` is what the shared bar writes on an
 * app's page, so the same file works opened from disk and served under the bar.
 */
export const TOKEN_GROUPS = [
  { name: 'light', source: ['@theme static'], kit: [':root'] },
  { name: 'touch', source: ['@media (pointer: coarse)', ':root'], kit: ['@media (pointer: coarse)', ':root'] },
  { name: 'dark', source: ['@media screen', "[data-theme='dark']"], kit: ['@media screen', "[data-theme='dark'], [data-featherbase-theme='dark']"] },
  { name: 'green accent', source: ["[data-featherbase-accent='green']"], kit: ["[data-featherbase-accent='green']"] },
  {
    name: 'green accent, dark',
    source: ['@media screen', "[data-featherbase-accent='green'][data-theme='dark']"],
    kit: ['@media screen', "[data-featherbase-accent='green'][data-theme='dark'], [data-featherbase-accent='green'][data-featherbase-theme='dark']"],
  },
]

/** The body at a path of nested preludes, or null. An outer rule is tried again when it lacks the inner one. */
function bodyAt(css, path) {
  const [outer, ...inner] = path
  let from = 0
  for (;;) {
    const found = ruleBody(css, outer, from)
    if (!found) return null
    if (!inner.length) return found.body
    const nested = bodyAt(found.body, inner)
    if (nested != null) return nested
    from = found.end
  }
}

/** Every token group of a stylesheet: group name -> Map(token -> value). `side` is 'source' or 'kit'. */
export function tokenGroups(css, side) {
  const groups = new Map()
  for (const group of TOKEN_GROUPS) {
    const body = bodyAt(css, group[side])
    if (body == null) throw new Error(`Cannot find the ${group.name} tokens (${group[side].join(' > ')}) in the ${side} stylesheet`)
    groups.set(group.name, declaredTokens(body))
  }
  return groups
}

/** Each token that differs between the source and the kit, in words. Empty when they agree. */
export function tokenDifferences(sourceCss, kitCss) {
  const source = tokenGroups(sourceCss, 'source')
  const kit = tokenGroups(kitCss, 'kit')
  const differences = []
  for (const [group, wanted] of source) {
    const got = kit.get(group)
    for (const [name, value] of wanted) {
      if (!got.has(name)) differences.push(`${group}: ${name} is missing from the kit (the source has ${value})`)
      else if (got.get(name) !== value) differences.push(`${group}: ${name} is ${got.get(name)} in the kit, ${value} in the source`)
    }
    for (const name of got.keys()) if (!wanted.has(name)) differences.push(`${group}: ${name} is in the kit but not in the source`)
  }
  return differences
}

const indent = (body) => body.replace(/^\n+|\s+$/g, '')

function tokenCss(sourceCss) {
  const out = []
  for (const group of TOKEN_GROUPS) {
    const body = bodyAt(sourceCss, group.source)
    if (body == null) throw new Error(`packages/shop-floor/src/styles.css has changed shape: cannot find the ${group.name} tokens (${group.source.join(' > ')})`)
    const [outer, inner] = group.kit
    const text = indent(body)
    // A nested body keeps the source's own deeper indentation.
    out.push(inner ? `${outer} {\n  ${inner} {\n${text}\n  }\n}` : `${outer} {\n${text}\n}`)
  }
  out.push(":root {\n  color-scheme: light;\n}\n@media screen {\n  [data-theme='dark'], [data-featherbase-theme='dark'] {\n    color-scheme: dark;\n  }\n}")
  return out.join('\n\n')
}

// ---------------------------------------------------------------------------
// 2. Icons: each lucide drawing as a mask, so an icon takes the colour of its text.

const pascal = (kebab) => kebab.replace(/(^|-)([a-z0-9])/g, (_, __, ch) => ch.toUpperCase())

/** A lucide icon's shapes as SVG text, read from the package the components import. */
export function iconSvg(name) {
  const file = join(SHOP_FLOOR, 'node_modules/lucide-react/dist/esm/icons', `${name}.mjs`)
  if (!existsSync(file)) throw new Error(`No lucide icon named ${name} (looked for ${relative(ROOT, file)}; run pnpm install)`)
  const node = /node:\s*(\[[\s\S]*?\])\s*\n\};/.exec(readFileSync(file, 'utf8'))
  if (!node) throw new Error(`Cannot read the shapes of the lucide icon ${name}`)
  // A shape is ["path", { d: "...", key: "..." }], on one line or spread over several.
  const shapes = [...node[1].matchAll(/\[\s*"(\w+)",\s*\{([^}]*)\}\s*\]/g)].map(([, tag, attrs]) => {
    const pairs = [...attrs.matchAll(/(\w+):\s*"([^"]*)"/g)].filter(([, key]) => key !== 'key')
    return `<${tag} ${pairs.map(([, key, value]) => `${key}='${value}'`).join(' ')}/>`
  })
  // Every shape carries one `key`; a shape this reader missed would otherwise be drawn as nothing.
  const expected = (node[1].match(/\bkey:/g) ?? []).length
  if (shapes.length !== expected) throw new Error(`Read ${shapes.length} of the ${expected} shapes of the lucide icon ${name}`)
  if (!shapes.length) throw new Error(`The lucide icon ${name} has no shapes`)
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${shapes.join('')}</svg>`
}

function iconCss() {
  const set = readFileSync(ICON_SET, 'utf8')
  const lines = []
  for (const name of ICONS) {
    if (!new RegExp(`\\b${pascal(name)}\\b`).test(set)) throw new Error(`The kit's icon ${name} is not in the components' set (packages/shop-floor/src/icons.ts)`)
    const uri = iconSvg(name).replace(/</g, '%3C').replace(/>/g, '%3E').replace(/#/g, '%23')
    lines.push(`  --fb-icon-${name}: url("data:image/svg+xml,${uri}");`)
  }
  return [
    ':root {',
    ...lines,
    '}',
    ...ICONS.map((name) => `.fb-icon--${name} { --fb-icon: var(--fb-icon-${name}); }`),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 4. The font

function fontCss() {
  const pkg = join(SHOP_FLOOR, 'node_modules/@fontsource-variable/inter')
  if (!existsSync(pkg)) throw new Error('Cannot find @fontsource-variable/inter (run pnpm install)')
  const index = readFileSync(join(pkg, 'index.css'), 'utf8')
  return FONT_SUBSETS.map((subset) => {
    const file = `inter-${subset}-wght-normal.woff2`
    // The face's own rule in the package says which characters the subset covers.
    const face = index.split('@font-face').find((rule) => rule.includes(`./files/${file})`))
    const range = face && /unicode-range:\s*([^;]+);/.exec(face)
    if (!range) throw new Error(`Cannot find the character range of ${file} in @fontsource-variable/inter`)
    const data = readFileSync(join(pkg, 'files', file)).toString('base64')
    return `@font-face { font-family: 'Inter Variable'; font-style: normal; font-display: swap; font-weight: 100 900; unicode-range: ${range[1].trim()}; src: url(data:font/woff2;base64,${data}) format('woff2-variations'); }`
  }).join('\n')
}

// ---------------------------------------------------------------------------

const HEADER = `/* Featherbase look kit (#1408). GENERATED by tools/look-kit.mjs: do not edit this file.
   Change the classes in look-kit/src/classes.css, or the tokens in
   packages/shop-floor/src/styles.css, then run: pnpm look-kit
   How to use it: README.md beside this file. Every class is shown in index.html.

   Parts: 1 tokens (light and dark) · 2 icons · 3 classes · 4 the Inter font.
   Part 4 is two very long lines of font data at the end; there is nothing to read in it. */`

/** The whole stylesheet, from the files as they are now. */
export function build() {
  const source = readFileSync(SOURCE, 'utf8')
  return [
    HEADER,
    '/* ==== 1. Tokens: copied from packages/shop-floor/src/styles.css ==== */',
    tokenCss(source),
    '/* ==== 2. Icons: the lucide drawings the components use, as masks ==== */',
    iconCss(),
    '/* ==== 3. Classes: from look-kit/src/classes.css ==== */',
    readFileSync(CLASSES, 'utf8').trim(),
    '/* ==== 4. The Inter font the app serves, embedded ==== */',
    fontCss(),
    '',
  ].join('\n\n').replace(/\n\n$/, '\n')
}

/** What is wrong with the committed stylesheet, as lines for a person. Empty when it is current. */
export function staleness() {
  if (!existsSync(BUILT)) return [`${relative(ROOT, BUILT)} does not exist. Run: pnpm look-kit`]
  const committed = readFileSync(BUILT, 'utf8')
  if (committed === build()) return []
  let differences = []
  try { differences = tokenDifferences(readFileSync(SOURCE, 'utf8'), committed) } catch (error) { differences = [error.message] }
  return [
    `${relative(ROOT, BUILT)} is not what tools/look-kit.mjs builds from the source today.`,
    ...differences.map((line) => `  ${line}`),
    ...(differences.length ? [] : ['  The tokens agree; the classes, the icons or the font changed.']),
    'Run: pnpm look-kit   (and commit the result)',
  ]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = staleness()
    if (problems.length) {
      console.error(problems.join('\n'))
      process.exit(1)
    }
    console.log('The look kit is current: its tokens, icons, classes and font match the source.')
  } else {
    writeFileSync(BUILT, build())
    console.log(`Wrote ${relative(ROOT, BUILT)}`)
  }
}
