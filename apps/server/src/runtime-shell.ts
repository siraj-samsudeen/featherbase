// #650 (design D3, "One top bar on every address"): an installed app's entry
// document carries the platform's shared top bar. The server adds two things
// and nothing else: a host element, first in the body, naming the app, and the
// platform's bar script (a module, so it runs once the document is parsed).
// The bar bundle (apps/web/src/bar) draws the real TopBar into that host's
// shadow root. App code never runs in the bar, and the bar's styles never
// reach the app's page (ADR 0011).
export const BAR_SCRIPT = '/featherbase/bar.js'
const BAR_ELEMENT = 'featherbase-bar'

interface ShellApp {
  name: string
  title: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!)
}

export function composeRuntimeShell(html: string, app: ShellApp): string {
  const script = `<script type="module" src="${BAR_SCRIPT}"></script>`
  const host = `<${BAR_ELEMENT} data-app="${escapeHtml(app.name)}" data-title="${escapeHtml(app.title)}"></${BAR_ELEMENT}>`
  const rooted = rootRuntimeEntryAssets(html, app.name)
  const body = /<body(?:\s[^>]*)?>/i
  const head = /<\/head>/i
  if (!body.test(rooted) && !head.test(rooted)) return `${script}${host}${rooted}`
  const withScript = head.test(rooted) ? rooted.replace(head, `${script}</head>`) : `${script}${rooted}`
  return body.test(withScript)
    ? withScript.replace(body, (match) => `${match}${host}`)
    : withScript.replace(script, `${script}${host}`)
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
