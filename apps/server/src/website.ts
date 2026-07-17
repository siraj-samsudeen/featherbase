import { sql } from './db'

// WEB-001: server-render a published Web Page. Only `published` pages are
// reachable; the content is authored HTML wrapped in a minimal document.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

export interface RenderedPage {
  found: boolean
  html: string
}

export async function renderWebPage(route: string): Promise<RenderedPage> {
  const [page] = await sql`
    select title, content, published from tab_web_page where route = ${route}`
  if (!page || !page.published) {
    return {
      found: false,
      html: `<!doctype html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>404</h1><p>No published page at this route.</p></body></html>`,
    }
  }
  const title = escapeHtml((page.title as string) ?? route)
  // Content is authored HTML (trusted author input), rendered as the page body.
  const content = (page.content as string) ?? ''
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body data-testid="web-page">
<main class="web-content">
${content}
</main>
</body>
</html>`
  return { found: true, html }
}
