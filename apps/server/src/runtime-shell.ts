import { FEATHERBASE_ADMIN_DESTINATION, type AppTabIcon, type AppTabLink } from 'shared'

interface RuntimeDestination {
  name: string
  title: string
  href: string
  tabs?: AppTabLink[]
}

// #380 task 4.4: the tab icons, the same lucide outlines the Admin screens use
// (apps/web TopBar), inlined because the shell is plain HTML.
const TAB_ICON: Record<AppTabIcon, string> = {
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  report: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>',
  checklist: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
  calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  person: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
}

/** The open app's declared tabs, for a phone; the stylesheet hides them on a wider screen. */
function tabBar(destination: RuntimeDestination | undefined): string {
  if (!destination?.tabs?.length) return ''
  const tabs = destination.tabs.map(tab => `<a class="fc-runtime-tab" href="${escapeHtml(tab.href)}">`
    + `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${TAB_ICON[tab.icon] ?? ''}</svg>`
    + `<span>${escapeHtml(tab.label)}</span></a>`).join('')
  return `<nav class="fc-runtime-tabs" aria-label="${escapeHtml(destination.title)}" data-testid="runtime-tabs">${tabs}</nav>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

const mark = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <rect width="32" height="32" rx="8" fill="#2490ef" />
  <g transform="rotate(-32 16 16) translate(16 16) scale(1.08) translate(-16 -16)">
    <path d="M16 3.5C21 9.5 22 16.5 19 22.5L16 25.5L13 22.5C10 16.5 11 9.5 16 3.5Z" fill="#fff" />
    <path d="M16 24.5V29.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round" />
    <path d="M19.9 12.5L23 15.5L18.6 17.2Z" fill="#2490ef" />
    <path d="M16 3.5V25.5" stroke="#2490ef" stroke-width="2.1" />
  </g>
</svg>`

export function composeRuntimeShell(html: string, currentApp: string, destinations: RuntimeDestination[]): string {
  const options = [
    `<option value="${FEATHERBASE_ADMIN_DESTINATION.href}">${FEATHERBASE_ADMIN_DESTINATION.label}</option>`,
    ...destinations.map(destination => `<option value="${escapeHtml(destination.href)}"${destination.name === currentApp ? ' selected' : ''}>${escapeHtml(destination.title)}</option>`),
  ].join('')
  const tabs = tabBar(destinations.find(destination => destination.name === currentApp))
  const bodyMarks = tabs ? ' data-featherbase-runtime-shell data-featherbase-runtime-tabs' : ' data-featherbase-runtime-shell'
  const head = '<link rel="stylesheet" href="/featherbase/runtime-shell.css">'
  const shell = `<header class="fc-runtime-shell" data-testid="runtime-shell">
    <a class="fc-runtime-home" href="${FEATHERBASE_ADMIN_DESTINATION.href}" aria-label="${FEATHERBASE_ADMIN_DESTINATION.label}" title="${FEATHERBASE_ADMIN_DESTINATION.label}">${mark}</a>
    <label class="fc-runtime-label" for="fc-runtime-switcher">Switch application</label>
    <select id="fc-runtime-switcher" class="fc-runtime-switcher" aria-label="Switch application" data-current-app="${escapeHtml(currentApp)}">${options}</select>
  </header>${tabs}`
  const script = '<script src="/featherbase/runtime-shell.js" defer></script>'
  const rootedHtml = rootRuntimeEntryAssets(html, currentApp)
  // A page without a viewport lays out 980px wide on a phone, so the phone-only
  // tab bar would never show; the shell gives it the device's width.
  const viewport = tabs && !/<meta\s[^>]*name\s*=\s*["']?viewport/i.test(rootedHtml)
    ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''
  const withHead = /<\/head>/i.test(rootedHtml) ? rootedHtml.replace(/<\/head>/i, `${viewport}${head}</head>`) : `${viewport}${head}${rootedHtml}`
  const withBody = /<body(?:\s[^>]*)?>/i.test(withHead)
    ? withHead.replace(/<body(\s[^>]*)?>/i, `<body$1${bodyMarks}>`)
      .replace(/<body(?:\s[^>]*)?>/i, match => `${match}${shell}`)
    : `${shell}${withHead}`
  return /<\/body>/i.test(withBody) ? withBody.replace(/<\/body>/i, `${script}</body>`) : `${withBody}${script}`
}

// A nested navigation still serves the app's declared entry document. Root
// only the document's resource URLs: a <base> would also rewrite package-owned
// hash and query links away from the current deep location.
function rootRuntimeEntryAssets(html: string, app: string): string {
  const root = `https://runtime.invalid/${encodeURIComponent(app)}/`
  const rooted = (value: string) => {
    if (!value || /^(?:[/?#]|[a-z][a-z\d+.-]*:)/i.test(value)) return value
    const url = new URL(value, root)
    return `${url.pathname}${url.search}${url.hash}`
  }
  const rewriteAttribute = (tag: string, attribute: string, transform = rooted) => tag.replace(
    new RegExp(`(\\s${attribute}\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`, 'gi'),
    (_match, prefix: string, doubleQuoted: string | undefined, singleQuoted: string | undefined, unquoted: string | undefined) => {
      const value = doubleQuoted ?? singleQuoted ?? unquoted ?? ''
      const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : ''
      return `${prefix}${quote}${transform(value)}${quote}`
    },
  )
  const rewriteSrcset = (value: string) => {
    let result = ''
    let position = 0
    while (position < value.length) {
      const whitespace = value.slice(position).match(/^\s+/)?.[0]
      if (whitespace) {
        result += whitespace
        position += whitespace.length
      }
      if (position >= value.length) break
      if (value[position] === ',') {
        result += ','
        position += 1
        continue
      }

      const start = position
      const dataUrl = value.slice(position, position + 5).toLowerCase() === 'data:'
      while (position < value.length && !/\s/.test(value[position]) && (dataUrl || value[position] !== ',')) position += 1
      result += rooted(value.slice(start, position))
      while (position < value.length && value[position] !== ',') {
        result += value[position]
        position += 1
      }
    }
    return result
  }
  const rewriteCssUrls = (css: string) => css.replace(
    /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi,
    (_match, quote: string | undefined, quoted: string | undefined, unquoted: string | undefined) => {
      const value = quote ? (quoted ?? '') : (unquoted ?? '').trim()
      return `url(${quote ?? ''}${rooted(value)}${quote ?? ''})`
    },
  )

  const resources: Record<string, string[]> = {
    script: ['src'],
    img: ['src', 'srcset'],
    iframe: ['src'],
    embed: ['src'],
    source: ['src', 'srcset'],
    track: ['src'],
    audio: ['src'],
    video: ['src', 'poster'],
    input: ['src'],
    object: ['data'],
    link: ['href'],
  }
  const withResourceAttributes = html.replace(/<([a-z][\w:-]*)\b[^>]*>/gi, (tag, rawName: string) => {
    const name = rawName.toLowerCase()
    let rewritten = tag
    for (const attribute of resources[name] ?? [])
      rewritten = rewriteAttribute(rewritten, attribute, attribute === 'srcset' ? rewriteSrcset : rooted)
    return rewriteAttribute(rewritten, 'style', rewriteCssUrls)
  })
  return withResourceAttributes.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_match, opening: string, css: string, closing: string) => `${opening}${rewriteCssUrls(css)}${closing}`,
  )
}

export const runtimeShellCss = `
body[data-featherbase-runtime-shell] { --featherbase-runtime-shell-inset: 48px; padding-top: var(--featherbase-runtime-shell-inset) !important; }
.fc-runtime-shell { box-sizing: border-box !important; position: fixed !important; inset: 0 0 auto 0 !important; z-index: 2147483647 !important; display: flex !important; height: var(--featherbase-runtime-shell-inset) !important; align-items: center !important; gap: 8px !important; padding: 0 12px !important; border-bottom: 1px solid #ebeef0 !important; background: #fff !important; color: #1c2126 !important; font: 14px Inter, ui-sans-serif, system-ui, sans-serif !important; }
.fc-runtime-home { box-sizing: border-box !important; display: inline-flex !important; width: 36px !important; height: 36px !important; flex: 0 0 36px !important; align-items: center !important; justify-content: center !important; border-radius: 7px !important; }
.fc-runtime-home:hover { background: #f7f7f8 !important; }
.fc-runtime-home svg { display: block !important; width: 26px !important; height: 26px !important; }
.fc-runtime-label { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
.fc-runtime-switcher { box-sizing: border-box !important; width: min(280px, calc(100vw - 68px)) !important; min-height: 36px !important; margin: 0 !important; padding: 0 34px 0 11px !important; border: 1px solid #d1d8dd !important; border-radius: 6px !important; background: #fff !important; color: #1c2126 !important; font: 600 14px Inter, ui-sans-serif, system-ui, sans-serif !important; }
.fc-runtime-home:focus-visible, .fc-runtime-switcher:focus-visible { outline: 3px solid #2490ef !important; outline-offset: 2px !important; }
/* #380 4.4: the open app's tabs, on a phone only, fixed within reach of a thumb; 48px targets, the open one marked by a bar above it and a bolder label as well as by colour. Below an app's own dialogs (z-index 1000); an app that pins something to the bottom keeps --featherbase-runtime-shell-tabs-inset clear. */
.fc-runtime-tabs { display: none !important; }
@media (max-width: 639.98px) {
  body[data-featherbase-runtime-tabs] { --featherbase-runtime-shell-tabs-inset: calc(50px + env(safe-area-inset-bottom)); padding-bottom: var(--featherbase-runtime-shell-tabs-inset) !important; }
  .fc-runtime-tabs { box-sizing: border-box !important; position: fixed !important; inset: auto 0 0 0 !important; z-index: 1000 !important; height: var(--featherbase-runtime-shell-tabs-inset) !important; display: flex !important; padding: 0 0 env(safe-area-inset-bottom) !important; border-top: 1px solid #ebeef0 !important; background: #fff !important; font: 12px Inter, ui-sans-serif, system-ui, sans-serif !important; }
  .fc-runtime-tab { box-sizing: border-box !important; display: flex !important; min-width: 0 !important; height: 48px !important; flex: 1 1 0 !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; gap: 2px !important; padding: 0 4px !important; border-top: 2px solid transparent !important; color: #4b5563 !important; font-weight: 500 !important; text-decoration: none !important; }
  .fc-runtime-tab span { max-width: 100% !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
  .fc-runtime-tab[aria-current="page"] { border-top-color: #1d4ed8 !important; color: #1d4ed8 !important; font-weight: 600 !important; }
  .fc-runtime-tab:focus-visible { outline: 3px solid #2490ef !important; outline-offset: -3px !important; }
}
@media (pointer: coarse) { .fc-runtime-home, .fc-runtime-switcher { min-height: 44px !important; } .fc-runtime-home { width: 44px !important; flex-basis: 44px !important; } .fc-runtime-switcher { width: min(280px, calc(100vw - 76px)) !important; } }
`

export const runtimeShellJs = `(() => {
  // #380 4.4: mark the open tab, the one whose address the page is at or
  // under (the longest, since the app's root holds every other), and again
  // whenever the app moves to another address of its own.
  const tabs = [...document.querySelectorAll('.fc-runtime-tab')];
  function markTab() {
    const path = window.location.pathname;
    const under = (href) => path === href || path.startsWith(href.endsWith('/') ? href : href + '/');
    const open = tabs.map(tab => new URL(tab.href, window.location.href).pathname).filter(under).sort((a, b) => b.length - a.length)[0];
    for (const tab of tabs) {
      if (new URL(tab.href, window.location.href).pathname === open) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
  }
  if (tabs.length) {
    markTab();
    window.addEventListener('popstate', markTab);
    if (window.navigation) window.navigation.addEventListener('currententrychange', markTab);
    else for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) { const result = original.apply(this, args); markTab(); return result; };
    }
  }
  const switcher = document.querySelector('.fc-runtime-switcher');
  if (!(switcher instanceof HTMLSelectElement)) return;
  const current = switcher.dataset.currentApp;
  switcher.addEventListener('change', () => { window.location.assign(switcher.value); });
  let refreshing;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = fetch('/api/app_catalog', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('catalog unavailable')))
      .then(destinations => {
        const focused = document.activeElement === switcher;
        if (!destinations.some(destination => destination.name === current)) {
          window.location.assign(${JSON.stringify(FEATHERBASE_ADMIN_DESTINATION.href)});
          return;
        }
        switcher.replaceChildren(new Option(${JSON.stringify(FEATHERBASE_ADMIN_DESTINATION.label)}, ${JSON.stringify(FEATHERBASE_ADMIN_DESTINATION.href)}), ...destinations.map(destination => new Option(destination.title, destination.href, false, destination.name === current)));
        if (focused) switcher.focus();
      })
      .catch(() => {})
      .finally(() => { refreshing = undefined; });
    return refreshing;
  }
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
})();`
