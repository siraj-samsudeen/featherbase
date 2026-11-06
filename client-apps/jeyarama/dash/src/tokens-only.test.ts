import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// #950 checklist 9: Dash colours itself only through Shop Floor's tokens, so the theme the top bar
// paints (and an accent, should Dash ever name one) reaches every part of its page. A literal
// colour would stay the same in every theme. The same check as Tickets' (#941), wider.
const source = import.meta.dirname
// Every colour name CSS defines. `transparent` is allowed: it has no hue to clash with a theme.
const COLOUR_NAMES = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue
  chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
  darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue
  dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow
  grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen
  linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream
  mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred
  papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
  seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle
  tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/).join('|')
const LITERAL_COLOUR = new RegExp([
  String.raw`#[0-9a-fA-F]{3,8}\b`,
  String.raw`\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(`,
  String.raw`(?<![\w-])(?:${COLOUR_NAMES})(?![\w-])`,
].join('|'), 'gi')
// Tailwind's palette classes (text-red-500, bg-white) carry a colour the tokens don't control.
// They never appear in copy, so a component is searched whole: a class chosen by a condition counts.
const PALETTE_CLASS = /\b(?:text|bg|border|ring|fill|stroke|outline|accent|from|via|to|divide|decoration|caret|shadow)-(?:[a-z]+-\d{2,3}|black|white)\b/g

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
      const literals = colourContexts(path, text).flatMap(context => [...context.matchAll(LITERAL_COLOUR)])
      return [...literals, ...text.matchAll(PALETTE_CLASS)].map(match => `${relative(source, path)}: ${match[0]}`)
    })
    expect(found).toEqual([])
  })

  it("takes its tokens from Shop Floor's stylesheet, not a copy", () => {
    const css = readFileSync(join(source, 'style.css'), 'utf8')
    expect(css).toMatch(/@import '@featherbase\/shop-floor\/styles\.css'/)
    expect(css).not.toMatch(/@theme\b/)
  })
})
