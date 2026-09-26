import { FEATHERBASE_HOME_DESTINATION } from 'shared'

interface RuntimeDestination {
  name: string
  title: string
  href: string
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
    `<option value="${FEATHERBASE_HOME_DESTINATION.href}">${FEATHERBASE_HOME_DESTINATION.label}</option>`,
    ...destinations.map(destination => `<option value="${escapeHtml(destination.href)}"${destination.name === currentApp ? ' selected' : ''}>${escapeHtml(destination.title)}</option>`),
  ].join('')
  const head = '<link rel="stylesheet" href="/featherbase/runtime-shell.css">'
  const shell = `<header class="fc-runtime-shell" data-testid="runtime-shell">
    <a class="fc-runtime-home" href="${FEATHERBASE_HOME_DESTINATION.href}" aria-label="${FEATHERBASE_HOME_DESTINATION.label}" title="${FEATHERBASE_HOME_DESTINATION.label}">${mark}</a>
    <label class="fc-runtime-label" for="fc-runtime-switcher">Switch application</label>
    <select id="fc-runtime-switcher" class="fc-runtime-switcher" aria-label="Switch application" data-current-app="${escapeHtml(currentApp)}">${options}</select>
  </header>`
  const script = '<script src="/featherbase/runtime-shell.js" defer></script>'
  const rootedHtml = rootRuntimeEntryAssets(html, currentApp)
  const withHead = /<\/head>/i.test(rootedHtml) ? rootedHtml.replace(/<\/head>/i, `${head}</head>`) : `${head}${rootedHtml}`
  const withBody = /<body(?:\s[^>]*)?>/i.test(withHead)
    ? withHead.replace(/<body(\s[^>]*)?>/i, '<body$1 data-featherbase-runtime-shell>')
      .replace(/<body(?:\s[^>]*)?>/i, match => `${match}${shell}`)
    : `${shell}${withHead}`
  return /<\/body>/i.test(withBody) ? withBody.replace(/<\/body>/i, `${script}</body>`) : `${withBody}${script}`
}

// A nested navigation still serves the app's declared entry document. Root
// only the document's resource URLs: a <base> would also rewrite package-owned
// hash and query links away from the current deep location.
export function rootRuntimeEntryAssets(html: string, app: string): string {
  const root = `https://runtime.invalid/${encodeURIComponent(app)}/`
  const rooted = (value: string) => {
    if (/^(?:[/?#]|[a-z][a-z\d+.-]*:)/i.test(value)) return value
    const url = new URL(value, root)
    return `${url.pathname}${url.search}${url.hash}`
  }
  const rewrite = (tag: string, attribute: 'src' | 'href' | 'poster') => tag.replace(
    new RegExp(`(\\s${attribute}\\s*=\\s*)(["'])([^"']+)\\2`, 'i'),
    (_match, prefix: string, quote: string, value: string) => `${prefix}${quote}${rooted(value)}${quote}`,
  )
  return html.replace(/<(?:script|img|iframe|embed|source|track|audio|video|input)\b[^>]*>/gi, tag => {
    const withSource = rewrite(tag, 'src')
    return /^<video\b/i.test(tag) ? rewrite(withSource, 'poster') : withSource
  }).replace(/<link\b[^>]*>/gi, tag => rewrite(tag, 'href'))
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
@media (pointer: coarse) { .fc-runtime-home, .fc-runtime-switcher { min-height: 44px !important; } .fc-runtime-home { width: 44px !important; flex-basis: 44px !important; } .fc-runtime-switcher { width: min(280px, calc(100vw - 76px)) !important; } }
`

export const runtimeShellJs = `(() => {
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
          window.location.assign(${JSON.stringify(FEATHERBASE_HOME_DESTINATION.href)});
          return;
        }
        switcher.replaceChildren(new Option(${JSON.stringify(FEATHERBASE_HOME_DESTINATION.label)}, ${JSON.stringify(FEATHERBASE_HOME_DESTINATION.href)}), ...destinations.map(destination => new Option(destination.title, destination.href, false, destination.name === current)));
        if (focused) switcher.focus();
      })
      .catch(() => {})
      .finally(() => { refreshing = undefined; });
    return refreshing;
  }
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
})();`
