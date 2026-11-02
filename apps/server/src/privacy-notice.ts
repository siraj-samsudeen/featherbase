// #401: GET /privacy renders the instance's configured notice (System Settings
// `privacy_notice`, markdown). Raw HTML in the markdown is escaped, not
// rendered, and markdown-it refuses javascript:/vbscript: links. Images never
// load (a privacy page must not fetch third-party pixels): image syntax renders
// as a link carrying its alt text. The page carries no script and a CSP that
// forbids scripts and images (a meta tag: the global secureHeaders middleware
// rewrites the response header after the handler).
import MarkdownIt from 'markdown-it'
import { sql } from './db'

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false })
// markdown-it 15's linkify-it 6 stopped linking a bare www.example.com; a
// notice written for 14 still links it.
markdown.linkify.set({ fuzzyLink: true })
markdown.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx]
  const src = String(token.attrGet('src') ?? '')
  const alt = markdown.utils.escapeHtml(token.content || src)
  return /^(https?|mailto):/i.test(src) ? `<a href="${markdown.utils.escapeHtml(src)}">${alt}</a>` : alt
}

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'"

function page(content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Privacy notice</title>
<style>
  :root { --bg: #fbfaf7; --fg: #1f2328; --muted: #5b6168; --rule: #dcd8cf; --head: #f0ede6; color-scheme: light dark }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181b; --fg: #e8e6e1; --muted: #a3a8ae; --rule: #33373c; --head: #22252a } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
  main { max-width: 44rem; margin: 0 auto; padding: 2.5rem 16px 3rem; overflow-wrap: anywhere }
  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 1rem }
  h2 { font-size: 1.15rem; margin: 2rem 0 .5rem }
  h3 { font-size: 1rem; margin: 1.5rem 0 .5rem }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0; display: block; overflow-x: auto }
  th, td { text-align: left; vertical-align: top; padding: .5rem .75rem; border: 1px solid var(--rule) }
  th { background: var(--head) }
  blockquote { margin: 1rem 0; padding: 0 1rem; border-left: 3px solid var(--rule); color: var(--muted) }
  code { font-size: .95em }
  a { color: inherit }
</style>
</head>
<body>
<main>
${content}</main>
</body>
</html>
`
}

/** The page to serve: the rendered notice, or a plain 404 page when none is configured. */
export async function privacyNoticePage(): Promise<{ status: 200 | 404; html: string }> {
  const [row] = await sql`select value from single_value where table_name = 'System Settings' and field = 'privacy_notice'`
  const source = (row?.value as string | null | undefined) ?? ''
  if (!source.trim()) return { status: 404, html: page('<p>No privacy notice is published here.</p>\n') }
  return { status: 200, html: page(markdown.render(source)) }
}
