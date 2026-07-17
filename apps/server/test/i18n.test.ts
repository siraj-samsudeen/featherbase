import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index'
import { sql } from '../src/db'
import { getCatalog, t } from '../src/i18n'
import { setUserPassword } from '../src/auth'
import { areq } from './helpers'

// I18N-001: the translation catalog + t() lookup, and per-user language.

async function cleanup() {
  await sql`delete from tab_translation where language = 'fr'`
  await sql`delete from tab_user where name = 'i18n-user@x.com'`
}

beforeAll(async () => {
  await cleanup()
  for (const [src, tr] of [['Save', 'Enregistrer'], ['Priority', 'Priorité']]) {
    await areq('/api/save_doc', {
      method: 'POST',
      body: JSON.stringify({ doctype: 'Translation', doc: { name: `t-fr-${src}`, language: 'fr', source_text: src, translated_text: tr } }),
    })
  }
})

afterAll(async () => {
  await cleanup()
  await sql.end()
})

describe('I18N-001: translations', () => {
  it('builds a source→translated catalog for a language', async () => {
    const cat = await getCatalog('fr')
    expect(cat).toMatchObject({ Save: 'Enregistrer', Priority: 'Priorité' })
  })

  it('returns an empty catalog for the default language', async () => {
    expect(await getCatalog('en')).toEqual({})
  })

  it('t() translates known strings and falls back to the source', () => {
    const cat = { Save: 'Enregistrer' }
    expect(t('Save', cat)).toBe('Enregistrer')
    expect(t('Unknown', cat)).toBe('Unknown')
  })

  it('exposes the catalog over HTTP', async () => {
    const res = await areq('/api/translations/fr')
    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, string>).toMatchObject({ Save: 'Enregistrer' })
  })

  it('persists a per-user language and rejects a bad code', async () => {
    await areq('/api/save_doc', { method: 'POST', body: JSON.stringify({ doctype: 'User', doc: { name: 'i18n-user@x.com', email: 'i18n-user@x.com', enabled: true } }) })
    await setUserPassword('i18n-user@x.com', 'i18npw12345')
    const token = ((await (await app.request('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ usr: 'i18n-user@x.com', pwd: 'i18npw12345' }) })).json()) as { token: string }).token
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    const ok = await app.request('/api/set_language', { method: 'POST', headers: auth, body: JSON.stringify({ language: 'fr' }) })
    expect(ok.status).toBe(200)
    const who = (await (await app.request('/api/whoami', { headers: { authorization: `Bearer ${token}` } })).json()) as { language: string }
    expect(who.language).toBe('fr')

    const bad = await app.request('/api/set_language', { method: 'POST', headers: auth, body: JSON.stringify({ language: '!!!' }) })
    expect(bad.status).toBe(417)
  })
})
