import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// #950 checklist 9: Dash colours itself only through Shop Floor's tokens, so the theme the top bar
// paints (and an accent, should Dash ever name one) reaches every part of its page. A literal
// colour would stay the same in every theme. The same check as Tickets' (#941), and `transparent`
// is allowed: it has no hue to clash with a theme.
const source = import.meta.dirname
const LITERAL_COLOUR = new RegExp([
  String.raw`#[0-9a-fA-F]{3,8}\b`,
  String.raw`\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(`,
  String.raw`(?<![\w-])(?:white|black|red|green|blue|orange|yellow|purple|gray|grey|pink|brown|navy|teal|silver|gold|maroon|olive|lime|aqua|fuchsia|beige|ivory|crimson|coral|salmon|tomato|indigo|violet|khaki|cyan|magenta|tan)(?![\w-])`,
  // Tailwind's palette classes (text-red-500) carry a colour the tokens don't control.
  String.raw`\b(?:text|bg|border|ring|fill|stroke|outline|accent|from|via|to|divide|decoration|caret|shadow)-[a-z]+-\d{2,3}\b`,
].join('|'), 'g')

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return files(path)
    return /\.(css|tsx)$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : []
  })
}

// Only where a colour could be written: CSS declarations, and style or class strings in
// components. A word in the copy is not a colour.
function colourContexts(path: string, text: string): string[] {
  if (path.endsWith('.css')) return [text.replace(/\/\*[\s\S]*?\*\//g, '')]
  return [...text.matchAll(/style=\{\{[\s\S]*?\}\}|className=(?:"[^"]*"|\{`[^`]*`\})/g)].map(match => match[0])
}

describe('Dash uses only Shop Floor tokens (#950)', () => {
  it('names no literal colour in its stylesheet or components', () => {
    const found = files(source).flatMap(path => {
      const text = readFileSync(path, 'utf8')
      return colourContexts(path, text).flatMap(context =>
        [...context.matchAll(LITERAL_COLOUR)].map(match => `${relative(source, path)}: ${match[0]}`))
    })
    expect(found).toEqual([])
  })

  it("takes its tokens from Shop Floor's stylesheet, not a copy", () => {
    const css = readFileSync(join(source, 'style.css'), 'utf8')
    expect(css).toMatch(/@import '@featherbase\/shop-floor\/styles\.css'/)
    expect(css).not.toMatch(/@theme\b/)
  })
})
