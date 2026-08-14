// Table deletion — docs/specs/0003-table-deletion.md. Test titles quote
// spec IDs (static traceability); the evidence CSV carries the verdicts.
import { afterAll, beforeAll, describe, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from './pg-test'
import type { TestClient } from 'feather-testing-postgres'
import { sql } from '../src/db'
import { invalidateSources } from '../src/sources/registry'

const DT = 'Deletion Target'
const ENC = encodeURIComponent(DT)

async function makeTable(admin: TestClient, name = DT, extra: object[] = []) {
  await admin.post('/api/doctype', {
    name,
    columns: [{ column_name: 'title', column_type: 'Data' }, ...extra],
  })
}

async function physicalExists(name: string): Promise<boolean> {
  const physical = name.toLowerCase().replace(/\s+/g, '_')
  const [row] = await sql`select to_regclass(${'"' + physical + '"'}) as t`
  return row.t != null
}

describe('DEL-R1: who may delete', () => {
  test('DEL-R1: a non-manager is refused whole-request; the Table survives', async ({
    admin,
    createUser,
  }) => {
    await makeTable(admin)
    const user = await createUser()
    await expect(user.delete(`/api/doctype/${ENC}`)).rejects.toMatchObject({
      status: 403,
    })
    const meta = (await admin.get(`/api/table/${ENC}:meta`)) as { name: string }
    expect(meta.name).toBe(DT)
    expect(await physicalExists(DT)).toBe(true)
  })
})

describe('DEL-R2: deletion removes what creation wrote', () => {
  test('DEL-R2: def row, column defs, physical table + rows, and its own child rows go; the child Table stays', async ({
    admin,
  }) => {
    await admin.post('/api/doctype', {
      name: 'Deletion Child',
      kind: 'sub_table',
      columns: [{ column_name: 'item', column_type: 'Data' }],
    })
    await makeTable(admin, DT, [
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Deletion Child' },
    ])
    await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { title: 'one', lines: [{ item: 'a' }, { item: 'b' }] },
    })

    await admin.delete(`/api/doctype/${ENC}`)

    await expect(admin.get(`/api/table/${ENC}:meta`)).rejects.toMatchObject({ status: 404 })
    const [defs] = await sql`select count(*)::int as n from column_def where parent = ${DT}`
    expect(defs.n).toBe(0)
    expect(await physicalExists(DT)).toBe(false)
    // The child Table definition survives; this parent's child ROWS do not.
    const childMeta = (await admin.get('/api/table/Deletion%20Child:meta')) as { name: string }
    expect(childMeta.name).toBe('Deletion Child')
    const [orphans] = await sql`
      select count(*)::int as n from deletion_child where parenttype = ${DT}`
    expect(orphans.n).toBe(0)
  })

  test('DEL-R2: a settings Table sheds metadata only; a nonexistent name 404s', async ({
    admin,
  }) => {
    await admin.post('/api/doctype', {
      name: 'Deletion Settings',
      kind: 'settings',
      columns: [{ column_name: 'flag', column_type: 'Check' }],
    })
    await admin.delete('/api/doctype/Deletion%20Settings')
    await expect(admin.get('/api/table/Deletion%20Settings:meta')).rejects.toMatchObject({
      status: 404,
    })
    await expect(admin.delete('/api/doctype/No%20Such%20Table')).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('DEL-R3: schema references block, and say who', () => {
  test('DEL-R3: a Reference column blocks — even with zero rows — naming Table.column', async ({
    admin,
  }) => {
    await makeTable(admin)
    await admin.post('/api/doctype', {
      name: 'Deletion Referrer',
      columns: [
        { column_name: 'zone', column_type: 'Reference', reference_table: DT },
      ],
    })
    await expect(admin.delete(`/api/doctype/${ENC}`)).rejects.toMatchObject({
      status: 417,
      message: expect.stringContaining('Deletion Referrer.zone'),
    })
    // Unblock by deleting the referrer, then the delete goes through (DEL-J2).
    await admin.delete('/api/doctype/Deletion%20Referrer')
    await admin.delete(`/api/doctype/${ENC}`)
    await expect(admin.get(`/api/table/${ENC}:meta`)).rejects.toMatchObject({ status: 404 })
  })

  test('DEL-R3: a Sub-table column blocks its row-storage Table; self-references never block', async ({
    admin,
  }) => {
    await admin.post('/api/doctype', {
      name: 'Deletion Child',
      kind: 'sub_table',
      columns: [{ column_name: 'item', column_type: 'Data' }],
    })
    await makeTable(admin, DT, [
      { column_name: 'lines', column_type: 'Sub-table', row_table: 'Deletion Child' },
    ])
    await expect(admin.delete('/api/doctype/Deletion%20Child')).rejects.toMatchObject({
      status: 417,
      message: expect.stringContaining(`${DT}.lines`),
    })
    // A submittable Table references itself via amended_from — deletable.
    await admin.post('/api/doctype', {
      name: 'Deletion Selfref',
      is_submittable: true,
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    await admin.delete('/api/doctype/Deletion%20Selfref')
    await expect(admin.get('/api/table/Deletion%20Selfref:meta')).rejects.toMatchObject({
      status: 404,
    })
  })

  test('DEL-R3: system tables are platform anatomy — refused', async ({ admin }) => {
    for (const name of ['User', 'Table', 'Column']) {
      await expect(admin.delete(`/api/doctype/${name}`)).rejects.toMatchObject({
        status: 417,
        message: expect.stringContaining('system table'),
      })
    }
  })
})

describe('DEL-R4 + DEL-I1: the sidecar sweep', () => {
  test('DEL-R4: live pointers (Permission, Import Log, home-page link) go; text testimony (Access Log) stays', async ({
    admin,
  }) => {
    await makeTable(admin)
    // Residue an import journey would leave: a permission row, an Import
    // Log entry, and the module home-page link created with the Table.
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: DT, role: 'All', can_read: true },
    })
    await admin.post('/api/save_doc', {
      doctype: 'Import Log',
      doc: { ref_table: DT, file_name: 'zones.csv', inserted: 8, failed: 0 },
    })
    await admin.delete(`/api/doctype/${ENC}`)

    const [perms] = await sql`select count(*)::int as n from permission where ref_table = ${DT}`
    const [logs] = await sql`select count(*)::int as n from import_log where ref_table = ${DT}`
    const [links] = await sql`
      select count(*)::int as n from home_page_link where link_to = ${DT}`
    expect({ perms: perms.n, logs: logs.n, links: links.n }).toEqual({
      perms: 0,
      logs: 0,
      links: 0,
    })
    // DEL-I1: nothing dangles anywhere a Reference → Table column exists.
    const pointerCols = await sql<{ parent: string; column_name: string }[]>`
      select cd.parent, cd.column_name from column_def cd
      join table_def td on td.name = cd.parent
      where cd.column_type = 'Reference' and cd.reference_table = 'Table'
        and td.kind <> 'settings' and td.data_source is null`
    for (const p of pointerCols) {
      const physical = p.parent.toLowerCase().replace(/\s+/g, '_')
      const rows = await sql.unsafe(
        `select count(*)::int as n from "${physical}" where "${p.column_name}" = $1`,
        [DT],
      )
      expect({ table: p.parent, dangling: rows[0].n }).toEqual({ table: p.parent, dangling: 0 })
    }
    const [cols] = await sql`
      select count(*)::int as n from column_def
      where parent = ${DT} or reference_table = ${DT} or row_table = ${DT}`
    expect(cols.n).toBe(0)
  })

  test('DEL-R8: the deletion writes an Access Log line that survives the sweep', async ({
    admin,
  }) => {
    await makeTable(admin)
    await admin.delete(`/api/doctype/${ENC}`)
    const [line] = await sql`
      select "user", operation, ref_table from access_log
      where operation = 'delete_table' and ref_table = ${DT}`
    expect(line).toMatchObject({ user: 'Administrator', ref_table: DT })
  })
})

describe('DEL-R9: a stale pointer gets a tombstone, not a shrug', () => {
  test('DEL-R9: a deleted Table answers with who and when; a never-created name stays plain', async ({
    admin,
  }) => {
    await makeTable(admin)
    await admin.delete(`/api/doctype/${ENC}`)
    await expect(admin.get(`/api/table/${ENC}:meta`)).rejects.toMatchObject({
      status: 404,
      message: expect.stringMatching(
        new RegExp(`Table ${DT} was deleted by Administrator on \\d{4}-\\d{2}-\\d{2}$`),
      ),
    })
    await expect(admin.get('/api/table/Never%20Existed:meta')).rejects.toMatchObject({
      status: 404,
      message: expect.stringMatching(/Table Never Existed not found$/),
    })
  })

  test('DEL-R9: recreated and deleted again — the latest burial speaks', async ({ admin }) => {
    await makeTable(admin)
    await admin.delete(`/api/doctype/${ENC}`)
    await makeTable(admin)
    await admin.delete(`/api/doctype/${ENC}`)
    // Two delete_table lines exist; the tombstone is still singular.
    const [lines] = await sql`
      select count(*)::int as n from access_log
      where operation = 'delete_table' and ref_table = ${DT}`
    expect(lines.n).toBe(2)
    await expect(admin.get(`/api/table/${ENC}:meta`)).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining(`Table ${DT} was deleted by Administrator on`),
    })
  })
})

describe('DEL-I2: a refusal changes nothing', () => {
  test('DEL-I2: after a blocked delete every row count is exactly as before', async ({
    admin,
  }) => {
    await makeTable(admin)
    await admin.post('/api/doctype', {
      name: 'Deletion Referrer',
      columns: [{ column_name: 'zone', column_type: 'Reference', reference_table: DT }],
    })
    await admin.post('/api/save_doc', { doctype: DT, doc: { title: 'keep me' } })
    await admin.post('/api/save_doc', {
      doctype: 'Permission',
      doc: { ref_table: DT, role: 'All', can_read: true },
    })
    const counts = async () => {
      const [a] = await sql`select count(*)::int as n from deletion_target`
      const [b] = await sql`select count(*)::int as n from permission where ref_table = ${DT}`
      const [c] = await sql`select count(*)::int as n from column_def where parent = ${DT}`
      return { rows: a.n, perms: b.n, cols: c.n }
    }
    const before = await counts()
    await expect(admin.delete(`/api/doctype/${ENC}`)).rejects.toMatchObject({ status: 417 })
    expect(await counts()).toEqual(before)
    expect(await physicalExists(DT)).toBe(true)
  })
})

describe('DEL-R5: row-id series survive deletion', () => {
  test('DEL-R5: recreate the same Table — ids continue, never restart', async ({ admin }) => {
    await admin.post('/api/doctype', {
      name: DT,
      id_pattern: 'DELTGT-.###',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const first = (await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { title: 'a' },
    })) as { name: string }
    await admin.delete(`/api/doctype/${ENC}`)
    await admin.post('/api/doctype', {
      name: DT,
      id_pattern: 'DELTGT-.###',
      columns: [{ column_name: 'title', column_type: 'Data' }],
    })
    const second = (await admin.post('/api/save_doc', {
      doctype: DT,
      doc: { title: 'b' },
    })) as { name: string }
    const num = (s: string) => Number(s.split('-').pop())
    expect(num(second.row_id)).toBeGreaterThan(num(first.row_id))
  })
})

describe('DEL-R7: attachments', () => {
  test('DEL-R7: File registry rows sweep with the Table and the bytes are gone', async ({
    admin,
  }) => {
    await makeTable(admin)
    const form = new FormData()
    form.append('file', new File(['attached bytes'], 'note.txt', { type: 'text/plain' }))
    form.append('ref_doctype', DT)
    const res = await admin.fetch('/api/upload_file', { method: 'POST', body: form })
    expect(res.status).toBe(201)
    const doc = (await res.json()) as { file_url: string }

    await admin.delete(`/api/doctype/${ENC}`)

    const [reg] = await sql`select count(*)::int as n from file where ref_table = ${DT}`
    expect(reg.n).toBe(0)
    const served = await admin.fetch(doc.file_url)
    expect(served.status).toBe(404)
  })
})

describe('DEL-R6: a bound Table sheds its binding, never its source', () => {
  let dir: string
  const CSV = 'zone_code,zone_name\nA,Alpha\nB,Bravo\n'
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'fb-del-src-'))
    writeFileSync(path.join(dir, 'zones.csv'), CSV)
  })
  afterAll(() => {
    invalidateSources()
    rmSync(dir, { recursive: true, force: true })
  })

  test('DEL-R6: the binding goes; the source file keeps its bytes', async ({ admin }) => {
    invalidateSources()
    await admin.post('/api/table/Data%20Source', {
      row_id: 'del-fixture',
      engine: 'csv-folder',
      root_path: dir,
      access: 'read_write',
    })
    const res = await admin.fetch('/api/table/Data%20Source/del-fixture:reflect', {
      method: 'POST',
      body: JSON.stringify({ tables: ['zones.csv'] }),
    })
    expect(res.status).toBe(200)
    const { created } = (await res.json()) as { created: { name: string }[] }
    const bound = created[0].name

    await admin.delete(`/api/doctype/${encodeURIComponent(bound)}`)

    await expect(admin.get(`/api/meta/${encodeURIComponent(bound)}`)).rejects.toMatchObject({
      status: 404,
    })
    expect(readFileSync(path.join(dir, 'zones.csv'), 'utf8')).toBe(CSV)
  })
})
