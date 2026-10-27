// The Featherbase shell wrapped around an installed app's entry document: the
// home mark and the application switcher, with the shell's stylesheet and script.
import { describe, expect, test } from 'vitest'
import { composeRuntimeShell } from '../src/runtime-shell'

describe('the runtime shell', () => {
  test('app names and links in the switcher are escaped, and the current app is selected', () => {
    const html = composeRuntimeShell('<html><head></head><body><main>app</main></body></html>', 'notes', [
      { name: 'notes', title: 'Notes & "Ideas"', href: '/notes/' },
      { name: 'odd', title: "<O'Brien>", href: '/odd/?a=1&b=2' },
    ])
    expect(html).toContain('<option value="/notes/" selected>Notes &amp; &quot;Ideas&quot;</option>')
    expect(html).toContain('<option value="/odd/?a=1&amp;b=2">&lt;O&#39;Brien&gt;</option>')
    expect(html).not.toContain("<O'Brien>")
  })

  test('a document without head or body still gets the stylesheet and the shell first and the script last', () => {
    const html = composeRuntimeShell('<main>bare</main>', 'notes', [])
    expect(html.startsWith('<header class="fc-runtime-shell"')).toBe(true)
    expect(html).toContain('<link rel="stylesheet" href="/featherbase/runtime-shell.css"><main>bare</main>')
    expect(html.endsWith('<script src="/featherbase/runtime-shell.js" defer></script>')).toBe(true)
  })
})
