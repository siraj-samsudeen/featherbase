import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// #941 checklist 17: Tickets colours itself only through Shop Floor tokens, so
// the accent its manifest names (and dark mode) reach every part of its page.
// A literal colour in its stylesheet or components would stay the same in
// every theme and accent.
const source = resolve('../..', 'example-apps/tickets/src')
const LITERAL_COLOUR = new RegExp([
  String.raw`#[0-9a-fA-F]{3,8}\b`,
  String.raw`\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(`,
  String.raw`(?<![\w-])(?:white|black|red|green|blue|orange|yellow|purple|gray|grey|pink|brown|navy|teal|silver|gold|maroon|olive|lime|aqua|fuchsia|beige|ivory|crimson|coral|salmon|tomato|indigo|violet|khaki)(?![\w-])`,
].join('|'), 'g')

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path)
    return /\.(css|tsx)$/.test(entry.name) ? [path] : []
  })
}

// Only where a colour could be written: CSS declarations, and style or class
// strings in components. Ordinary words in copy ("green" in a sentence) are
// not colours, so .tsx files are checked inside style={…} and className only.
function colourContexts(path: string, text: string): string[] {
  if (path.endsWith('.css')) return [text.replace(/\/\*[\s\S]*?\*\//g, '')]
  return [...text.matchAll(/style=\{\{[\s\S]*?\}\}|className=(?:"[^"]*"|\{`[^`]*`\})/g)].map(match => match[0])
}

describe('Tickets uses only Shop Floor tokens (#941)', () => {
  test('no Tickets stylesheet or component names a literal colour', () => {
    const found = files(source).flatMap(path => {
      const text = readFileSync(path, 'utf8')
      return colourContexts(path, text).flatMap(context =>
        [...context.matchAll(LITERAL_COLOUR)].map(match => `${relative(source, path)}: ${match[0]}`))
    })
    expect(found).toEqual([])
  })
})
