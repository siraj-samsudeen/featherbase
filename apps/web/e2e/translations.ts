import type { APIRequestContext } from '@playwright/test'

// Seeding Translation rows from an e2e spec has two traps, and both bit us.
//
// 1. `tab_translation` carries a UNIQUE index on (language, source_text), so a
//    row left behind by another spec blocks an insert even under a different
//    `name`. Clearing only the name this spec uses is not enough — whoever
//    currently occupies the pair has to go.
// 2. These rows are committed, not sandboxed, so they outlive the run and fail
//    the *server* suite (`apps/server/test/i18n.test.ts`), which seeds the same
//    pairs inside a transaction. A spec that does not clean up makes
//    `pnpm test` pass or fail depending on whether e2e ran first.
//
// The name is derived from the pair, so at most one row per (language, source)
// can ever exist and two specs seeding the same string cannot collide.

type Row = { name: string; language: string; source_text: string }
type Headers = Record<string, string>

const docName = (language: string, source: string) =>
  `${language}-${source.replace(/\s+/g, '-')}`

async function listTranslations(request: APIRequestContext, headers: Headers): Promise<Row[]> {
  const res = await request.get(
    '/api/resource/Translation?fields=["name","language","source_text"]&limit=500',
    { headers },
  )
  if (!res.ok()) throw new Error(`list Translation: ${res.status()}`)
  return ((await res.json()) as { data?: Row[] }).data ?? []
}

// Seeds [source, translated] pairs for a language and returns the names created,
// to hand back to clearTranslations() in afterAll.
export async function seedTranslations(
  request: APIRequestContext,
  headers: Headers,
  language: string,
  entries: [string, string][],
): Promise<string[]> {
  const existing = await listTranslations(request, headers)
  const names: string[] = []
  for (const [source, translated] of entries) {
    for (const row of existing.filter((r) => r.language === language && r.source_text === source))
      await request.delete(`/api/resource/Translation/${encodeURIComponent(row.name)}`, { headers })

    const name = docName(language, source)
    const res = await request.post('/api/save_doc', {
      headers,
      data: {
        doctype: 'Translation',
        doc: { name, language, source_text: source, translated_text: translated },
      },
    })
    // Checking this is the point: the old specs ignored the status, so a seed
    // that never landed looked like successful setup, and the test passed only
    // because another spec's leftover row happened to carry the same string.
    if (!res.ok()) throw new Error(`seed ${name}: ${res.status()} ${await res.text()}`)
    names.push(name)
  }
  return names
}

export async function clearTranslations(
  request: APIRequestContext,
  headers: Headers,
  names: string[],
): Promise<void> {
  for (const name of names)
    await request.delete(`/api/resource/Translation/${encodeURIComponent(name)}`, { headers })
}
