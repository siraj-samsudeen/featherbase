import type { Context } from 'hono'
import { sql } from './db'
import { AppError } from './errors'
import { getDoc } from './document'
import { hasMandatoryRowAccess } from './mandatory-access'
import { resolveToken } from './auth'
import { readStored, verifyFileSignature } from './storage'
import type { Env } from './route-context'
import { authCredential } from './session-cookies'

// FILE-001: serve stored files. Only files registered as a File doc are
// readable. Public bucket needs no session; the private bucket accepts a
// bearer header, the `sid` cookie a browser sends on its own (so <img src>
// and download links work — #173), or a signed URL.
export async function serveFile(c: Context<Env>, fileUrl: string, isPrivate: boolean) {
  const [row] = await sql`
    select row_id, file_name, mime_type, ref_table, ref_name
    from file where file_url = ${fileUrl}`
  if (!row) throw new AppError('NotFoundError', `File not found: ${fileUrl}`)

  // FILE-003: private files require either a valid signed URL (minted after a
  // permission check) or a session that can read the linked row. A user
  // without read on that row gets a 403.
  const protectedRow = row.ref_table && row.ref_name && await hasMandatoryRowAccess(String(row.ref_table), String(row.ref_name))
  if (isPrivate || protectedRow) {
    const signed = !protectedRow && verifyFileSignature(fileUrl, c.req.query('expires'), c.req.query('signature'))
    if (!signed) {
      // #137/#173: the credential is the Authorization header, or the HttpOnly
      // `sid` cookie the browser already sends on a same-origin <img>/<a>
      // request. `?token=` is deliberately not read — a URL lands in history,
      // in `Referer` and in proxy logs, and that is true of a session JWT just
      // as it is of an access token. A caller that can set no header at all
      // mints a short-lived signed URL from /api/signed_url instead.
      const user = await resolveToken(authCredential(c))
      if (row.ref_table && row.ref_name)
        await getDoc(row.ref_table as string, row.ref_name as string, user.row_id)
      else await getDoc('File', row.row_id as string, user.row_id)
    }
  }

  const content = await readStored(fileUrl)
  // #506: the type is whatever the uploader declared, and the file is served
  // from this app's own address. Only types a browser shows without running
  // script open in place; anything else (HTML, SVG, scripts) downloads, so an
  // uploaded page can never run as the app. An <img> ignores the download
  // header, so an SVG still shows where a form embeds it.
  // The stored type is an editable field, so it is reduced again here and the
  // header is built from that, never sent as stored: a browser reads
  // `text/plain,text/html` as its LAST type and would run it as a page.
  // #561: an SVG keeps its own type, which an <img> needs to draw it; it is
  // still an attachment, so opened directly it downloads and its script never runs.
  const type = mimeEssence(row.mime_type as string)
  const inPlace = SHOWN_IN_PLACE.has(type)
  const disposition = inPlace ? 'inline' : 'attachment'
  return c.body(new Uint8Array(content), 200, {
    'content-type': inPlace || type === 'image/svg+xml' ? type : 'application/octet-stream',
    'content-disposition': `${disposition}; filename="${(row.file_name as string).replace(/"/g, '')}"`,
  })
}

// #562: sound and video are a fixed list too, never a wildcard: an uploader
// could otherwise pick a type such as `video/xhtml+xml` that a browser may
// render as a document.
const SHOWN_IN_PLACE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'application/pdf', 'text/plain',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
])

// A declared type reduced to its bare `type/subtype`, lowercased, with nothing
// after the first `;` or `,`. Anything that isn't a well-formed type becomes
// application/octet-stream.
export function mimeEssence(declared: string | null | undefined): string {
  const essence = (declared ?? '').split(/[;,]/)[0].trim().toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(essence) ? essence : 'application/octet-stream'
}
