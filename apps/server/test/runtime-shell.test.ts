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

  // #380 task 4.4: the tabs the open app declares, drawn by the shell for a phone.
  test("the open app's declared tabs follow the shell as a labelled bar of links, escaped", () => {
    const html = composeRuntimeShell('<html><head></head><body class="app"><main>app</main></body></html>', 'notes', [
      { name: 'notes', title: 'Notes & "Ideas"', href: '/notes/', tabs: [
        { label: 'Today', icon: 'home', href: '/notes/' },
        { label: '<Mine>', icon: 'person', href: '/notes/mine?a=1&b=2' },
      ] },
      { name: 'odd', title: 'Odd', href: '/odd/', tabs: [{ label: 'Elsewhere', icon: 'list', href: '/odd/x' }] },
    ])
    expect(html).toContain('<body class="app" data-featherbase-runtime-shell data-featherbase-runtime-tabs>')
    const nav = html.match(/<nav class="fc-runtime-tabs"[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(nav).toContain('aria-label="Notes &amp; &quot;Ideas&quot;"')
    expect([...nav.matchAll(/<a class="fc-runtime-tab" href="([^"]*)">/g)].map(m => m[1])).toEqual(['/notes/', '/notes/mine?a=1&amp;b=2'])
    expect(nav).toContain('<span>&lt;Mine&gt;</span>')
    expect(nav.match(/<svg /g)).toHaveLength(2)
    expect(nav).not.toContain('Elsewhere')
    // After the shell's header, before the app's own content.
    expect(html.indexOf('</header>')).toBeLessThan(html.indexOf('<nav class="fc-runtime-tabs"'))
    expect(html.indexOf('<nav class="fc-runtime-tabs"')).toBeLessThan(html.indexOf('<main>app</main>'))
  })

  test('an app that declares no tabs gets no tab bar', () => {
    const html = composeRuntimeShell('<html><body><main>app</main></body></html>', 'notes', [{ name: 'notes', title: 'Notes', href: '/notes/' }])
    expect(html).not.toContain('fc-runtime-tabs')
    expect(html).not.toContain('data-featherbase-runtime-tabs')
  })
})
