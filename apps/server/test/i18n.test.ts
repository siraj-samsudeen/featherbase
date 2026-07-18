import { describe, expect } from 'vitest'
import { getCatalog, t } from '../src/i18n'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'

// I18N-001: the translation catalog + t() lookup, and per-user language.

// Each test seeds its French translations inside its own sandbox transaction.
async function seedFrench(admin: TestClient) {
  for (const [src, tr] of [
    ['Save', 'Enregistrer'],
    ['Priority', 'Priorité'],
  ]) {
    await admin.post('/api/save_doc', {
      doctype: 'Translation',
      doc: { name: `t-fr-${src}`, language: 'fr', source_text: src, translated_text: tr },
    })
  }
}

describe('I18N-001: translations', () => {
  test('builds a source→translated catalog for a language', async ({ admin }) => {
    await seedFrench(admin)
    const cat = await getCatalog('fr')
    expect(cat).toMatchObject({ Save: 'Enregistrer', Priority: 'Priorité' })
  })

  test('returns an empty catalog for the default language', async ({ admin }) => {
    await seedFrench(admin)
    expect(await getCatalog('en')).toEqual({})
  })

  test('t() translates known strings and falls back to the source', () => {
    const cat = { Save: 'Enregistrer' }
    expect(t('Save', cat)).toBe('Enregistrer')
    expect(t('Unknown', cat)).toBe('Unknown')
  })

  test('exposes the catalog over HTTP', async ({ admin }) => {
    await seedFrench(admin)
    const res = await admin.fetch('/api/translations/fr')
    expect(res.status).toBe(200)
    expect((await res.json()) as Record<string, string>).toMatchObject({ Save: 'Enregistrer' })
  })

  test('persists a per-user language and rejects a bad code', async ({ admin, createUser }) => {
    await seedFrench(admin)
    const user = await createUser()

    const ok = await user.fetch('/api/set_language', {
      method: 'POST',
      body: JSON.stringify({ language: 'fr' }),
    })
    expect(ok.status).toBe(200)
    const who = await user.get<{ language: string }>('/api/whoami')
    expect(who.language).toBe('fr')

    const bad = await user.fetch('/api/set_language', {
      method: 'POST',
      body: JSON.stringify({ language: '!!!' }),
    })
    expect(bad.status).toBe(417)
  })
})
