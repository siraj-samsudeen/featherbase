// recipe() (components/ui/cx.ts) builds `pointer-fine:<class>` at runtime, so
// Tailwind's scanner never sees those strings in src/. Until #386 the rules
// existed only because the literals happened to sit in test files. index.css
// now safelists them with @source inline. This compiles index.css with NO
// scanned candidates, which is the production CSS minus everything the scanner
// would add, and checks every class the helper can emit is still there.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { compile } from 'tailwindcss'
import { describe, expect, test } from 'vitest'

const web = join(__dirname, '..')
const require = createRequire(join(web, 'package.json'))

async function safelistOnlyCss(): Promise<string> {
  const compiler = await compile(readFileSync(join(web, 'src/index.css'), 'utf8'), {
    base: join(web, 'src'),
    loadStylesheet: async (id: string, base: string) => {
      const path = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : join(base, id)
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
    },
  })
  return compiler.build([])
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

// Every size class that appears in src/: a superset of what call sites can hand
// recipe(), whose touch-kept groups are text size, min-h and size.
function sizeClassesInSource(): string[] {
  const found = new Set<string>()
  const re = /(?<![\w:[/-])(text-(?:xs|sm|base|lg|xl|[2-9]xl|control)|min-h-(?:\[[^\]\s]+\]|[\w.]+)|size-(?:\[[^\]\s]+\]|[\w.]+))(?![\w-])/g
  for (const file of sourceFiles(join(web, 'src'))) for (const m of readFileSync(file, 'utf8').matchAll(re)) found.add(m[1])
  return [...found].sort()
}

const escape = (cls: string) => cls.replace(/[:[\]/.%()]/g, (c) => `\\${c}`)

describe('#386: pointer-fine overrides exist in the production CSS', () => {
  test('every size class the recipe can move under a mouse is generated from the safelist alone', async () => {
    const css = await safelistOnlyCss()
    const missing = sizeClassesInSource().filter((cls) => !css.includes(`.pointer-fine\\:${escape(cls)}`))
    expect(missing).toEqual([])
  })

  test('the probe sees the classes it should (text-sm, min-h-0, size-control)', () => {
    expect(sizeClassesInSource()).toEqual(expect.arrayContaining(['text-sm', 'min-h-0', 'size-control']))
  })
})
