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

  // META-010 / issue #42: `tab_translation` has a unique index on
  // (language, source_text) whose name does not match the generated
  // `tab_x_field_uq` shape, so the mapper used to blame `name` — a field that
  // was not the problem, and the reason this collision was hard to diagnose.
  test('a (language, source_text) collision names those fields, not `name`', async ({ admin }) => {
    await seedFrench(admin)
    await expect(
      admin.post('/api/save_doc', {
        doctype: 'Translation',
        // A different primary key: only the (language, source_text) pair clashes.
        doc: { name: 'other-name', language: 'fr', source_text: 'Save', translated_text: 'X' },
      }),
    ).rejects.toThrow(/Duplicate value for language, source_text/)
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
