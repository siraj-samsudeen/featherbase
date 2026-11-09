// Replays a recording (stories/record.ts) as MSW handlers: each request gets
// the answer the real server gave to the same method and address, or, when
// the address differs only in its query, the last answer for that path.
// Writes the server didn't see are acknowledged and change nothing.
import { http, HttpResponse, type HttpHandler } from 'msw'

export interface Recording {
  url: string
  answers: { method: string; path: string; status: number; body: unknown }[]
}

export function replay(recording: Recording): HttpHandler[] {
  const exact = new Map<string, Recording['answers'][number]>()
  const byPath = new Map<string, Recording['answers'][number]>()
  for (const a of recording.answers) {
    exact.set(`${a.method} ${a.path}`, a)
    byPath.set(`${a.method} ${a.path.split('?')[0]}`, a)
  }
  return [
    http.all('/api/*', ({ request }) => {
      const url = new URL(request.url)
      const hit = exact.get(`${request.method} ${url.pathname}${url.search}`) ?? byPath.get(`${request.method} ${url.pathname}`)
      if (hit) return HttpResponse.json(hit.body as object, { status: hit.status })
      if (request.method !== 'GET') return HttpResponse.json({})
      return HttpResponse.json({ error: { type: 'NotFoundError', message: `Not recorded: ${url.pathname}` } }, { status: 404 })
    }),
  ]
}
