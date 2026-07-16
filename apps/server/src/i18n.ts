import { sql } from './db'

// I18N-001: server-side translation. `getCatalog(lang)` returns the source→
// translated map for a language; `t(text, catalog)` looks a string up (falling
// back to the source). The client fetches the catalog and translates in the UI.

export async function getCatalog(language: string): Promise<Record<string, string>> {
  if (!language || language === 'en') return {}
  const [ok] = await sql`select 1 from information_schema.tables where table_name = 'tab_translation'`
  if (!ok) return {}
  const rows = await sql`
    select source_text, translated_text from tab_translation where language = ${language}`
  const map: Record<string, string> = {}
  for (const r of rows) map[r.source_text as string] = r.translated_text as string
  return map
}

export function t(text: string, catalog: Record<string, string>): string {
  return catalog[text] ?? text
}
