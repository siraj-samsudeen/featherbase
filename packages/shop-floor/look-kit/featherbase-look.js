// Featherbase look kit (#1408): the few things a plain-HTML prototype needs beside
// the stylesheet. No build step and no dependency: <script src="featherbase-look.js">.
//
//   fbLook.data()            the page's rows, read from its one data slot
//   fbLook.inr / exact / count / pct / date / month
//                            amounts, counts and dates as Featherbase writes them
//   fbLook.donut(shares)     the ring of a "built from" donut
//   fbLook.theme('dark')     paint the page light or dark
//
// On the address: ?theme=dark paints dark; ?full lets the page grow instead of
// scrolling inside its panel, for a full-page screenshot.
//
// It also makes the kit's three toggling controls work by themselves: a Segmented,
// ContentTabs, and a table row that opens in place. A page that redraws itself
// from its own state listens for their events (fb:change, fb:toggle), keeps the
// choice in that state, and draws aria-pressed, aria-selected and aria-expanded
// from it, because a redraw replaces what a click changed.
//
// The formats restate packages/shop-floor/src/format.ts; tools/look-kit.test.mjs
// runs both on the same values and fails when they differ.
;(function (root) {
  'use strict'

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const absent = (x) => x == null || Number.isNaN(x) || !Number.isFinite(x)

  /** Readable rupees: Indian grouping under a lakh, then "₹2.48 L" and "₹1.74 Cr". `signed` shows + as well as -. */
  function inr(x, options) {
    if (absent(x)) return '—'
    const signed = Boolean(options && options.signed)
    const rupees = Math.round(Math.abs(x))
    const sign = rupees === 0 ? '' : x < 0 ? '-' : signed ? '+' : ''
    let body
    if (rupees < 100000) body = rupees.toLocaleString('en-IN')
    else {
      const lakh = Math.round(rupees / 1000) / 100
      const crore = Math.round(rupees / 100000) / 100
      body = lakh < 100 ? lakh.toFixed(2) + ' L' : crore.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Cr'
    }
    return sign + '₹' + body
  }

  /** Exact rupees, Indian grouping, two decimals, never scaled: for amounts that are paid or must add up. */
  function exact(x) {
    if (x == null || Number.isNaN(x)) return '—'
    return (x < 0 ? '-' : '') + '₹' + Math.abs(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  /** A count or quantity: Indian grouping, no unit. */
  function count(x, decimals) {
    if (absent(x)) return '—'
    const places = decimals || 0
    const scale = Math.pow(10, places)
    const rounded = Math.round(x * scale) / scale || 0
    return rounded.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: places })
  }

  /** A percentage to one decimal. `signed` shows + as well as -, for a change ("+9.1%"); the components have no such form yet. */
  function pct(x, options) {
    if (absent(x)) return '—'
    const plus = options && options.signed && x > 0 ? '+' : ''
    return plus + x.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%'
  }

  /** "2026-12-01" as 01-Dec-2026. The data slot holds days as YYYY-MM-DD text. */
  function date(iso) {
    if (!iso) return '—'
    const parts = String(iso).slice(0, 10).split('-')
    const month = MONTHS[Number(parts[1]) - 1]
    return month ? parts[2] + '-' + month + '-' + parts[0] : String(iso)
  }

  /** "2026-12-01" as December 2026: a month named in a heading. */
  function month(iso) {
    if (!iso) return '—'
    const parts = String(iso).slice(0, 10).split('-')
    const name = MONTHS_LONG[Number(parts[1]) - 1]
    return name ? name + ' ' + parts[0] : String(iso)
  }

  /**
   * The page's data: the JSON inside <script type="application/json" id="fb-data">.
   * Every name and figure a prototype shows comes from this one slot, so the same
   * file can later be fed real rows by filling the slot and changing nothing else.
   */
  function data(id) {
    const slot = document.getElementById(id || 'fb-data')
    if (!slot) throw new Error('No data slot: add <script type="application/json" id="' + (id || 'fb-data') + '"> to the page')
    return JSON.parse(slot.textContent)
  }

  /**
   * The ring of a donut from its parts' shares, in order: fbLook.donut([42, 28, 30])
   * gives the value for style="--fb-donut: ...". Parts take the series colours 1 to 5.
   */
  function donut(shares) {
    const total = shares.reduce((sum, share) => sum + share, 0) || 1
    let from = 0
    return 'conic-gradient(' + shares.map((share, i) => {
      const to = from + (share / total) * 100
      const stop = 'var(--color-series-' + ((i % 5) + 1) + ') ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%'
      from = to
      return stop
    }).join(', ') + ')'
  }

  /** Paint the page light or dark, as the Featherbase bar does. */
  function theme(name) {
    document.documentElement.setAttribute('data-theme', name === 'dark' ? 'dark' : 'light')
  }

  /** Text safe to put inside markup built as a string. */
  function escape(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  }

  const api = { inr, exact, count, pct, date, month, data, donut, theme, escape }
  root.fbLook = api
  if (typeof document === 'undefined') return

  // ?theme=dark on the address paints dark, so a page can be looked at both ways.
  const address = new URLSearchParams(root.location ? root.location.search : '')
  const asked = address.get('theme')
  if (asked === 'dark' || asked === 'light') theme(asked)
  // ?full lets the page grow instead of scrolling inside its panel, for a full-page screenshot.
  if (address.has('full')) document.documentElement.setAttribute('data-fb-full', '')

  // The toggling controls. Each announces its change as an event on itself, so
  // a page listens instead of wiring clicks:
  //   segmented.addEventListener('fb:change', (event) => event.detail.value)
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    // A prototype's record links go nowhere yet; a click must not jump to the top of the page.
    const nowhere = target.closest('a[href="#"]')
    if (nowhere) event.preventDefault()

    const choice = target.closest('.fb-segmented > button')
    if (choice) {
      const group = choice.parentElement
      for (const button of group.children) button.setAttribute('aria-pressed', String(button === choice))
      group.dispatchEvent(new CustomEvent('fb:change', { bubbles: true, detail: { value: choice.dataset.value || choice.textContent.trim() } }))
      return
    }

    const tab = target.closest('.fb-tabs > [role="tab"]')
    if (tab) {
      for (const other of tab.parentElement.children) {
        const open = other === tab
        other.setAttribute('aria-selected', String(open))
        const panel = document.getElementById(other.getAttribute('aria-controls') || '')
        if (panel) panel.hidden = !open
      }
      tab.parentElement.dispatchEvent(new CustomEvent('fb:change', { bubbles: true, detail: { value: tab.dataset.value || tab.textContent.trim() } }))
      return
    }

    const toggle = target.closest('.fb-row-toggle')
    if (toggle) {
      const row = toggle.closest('tr')
      const detail = row && row.nextElementSibling
      if (!detail || !detail.classList.contains('fb-row-detail')) return
      const open = toggle.getAttribute('aria-expanded') !== 'true'
      toggle.setAttribute('aria-expanded', String(open))
      detail.hidden = !open
      row.dispatchEvent(new CustomEvent('fb:toggle', { bubbles: true, detail: { open } }))
    }
  })
})(typeof globalThis !== 'undefined' ? globalThis : this)
