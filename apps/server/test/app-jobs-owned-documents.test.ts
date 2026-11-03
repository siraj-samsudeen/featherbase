import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { drainJobs } from '../src/jobs'
import { sql } from '../src/db'

async function fixture(handler: string, declaration: unknown = { owner_table: 'ownerjobs.note', tables: ['ownerjobs.note'] }) {
  const dir = await mkdtemp(resolve('test/.owner-jobs-'))
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'package.json'), JSON.stringify({ name: 'owner-jobs', version: '1.0.0', type: 'module' }))
  await writeFile(resolve(dir, 'featherbase.json'), JSON.stringify({
    manifestVersion: 1, platformVersion: '2026-10', name: 'ownerjobs', title: 'Owned jobs', server: 'server.mjs', entryTable: 'ownerjobs.note',
    roles: ['Owner jobs member'], tables: [{ name: 'ownerjobs.note', label: 'Note', id_pattern: 'NOTE-.#####',
      access_policy: { version: 1, roles: ['Owner jobs member'], shared_column: 'shared' },
      columns: [{ column_name: 'body', column_type: 'Data' }, { column_name: 'shared', column_type: 'Check' }] }],
    permissions: [{ table: 'ownerjobs.note', role: 'Owner jobs member', can_read: true, can_create: true, can_write: true }],
    jobs: [{ name: 'advance', cadence: 'hourly', description: 'Advance owned notes', ...(declaration ? { documents: declaration } : {}) }],
  }))
  await writeFile(resolve(dir, 'server.mjs'), `export const platformVersion='2026-10'; export const jobs={async advance(ctx){${handler}}}`)
  return dir
}
async function run() {
  await sql`update background_job set run_at=now()-interval '1 second' where job_status='queued'`
  await drainJobs()
}

test('a declared document job preserves private row creators', async ({ admin, createUser }) => {
  const dir = await fixture(`await ctx.documents.forEachOwner(async ({user,documents})=>{
    const rows=await documents.list('ownerjobs.note',{fields:['row_id','body','created_by','updated_at'],filters:[['created_by','=',user]]});
    for(const row of rows) await documents.update('ownerjobs.note',{row_id:row.row_id,updated_at:row.updated_at,body:row.body+' advanced'});
  });`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    const headers = { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }
    const created = await owner.fetch('/api/save_row', { method: 'POST', headers, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Private work' } }) })
    const note = await created.json() as { row_id: string }
    expect(created.status).toBe(201)
    await run()
    const res = await owner.fetch(`/api/table/ownerjobs.note/${note.row_id}`, { headers })
    expect(await res.json()).toMatchObject({ body: 'Private work advanced', created_by: owner.user })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a document job rolls back the owner scope after a callback failure', async ({ admin, createUser }) => {
  const dir = await fixture(`await ctx.documents.forEachOwner(async ({user,documents})=>{
    const [row]=await documents.list('ownerjobs.note',{fields:['row_id','updated_at'],filters:[['created_by','=',user]]});
    await documents.update('ownerjobs.note',{row_id:row.row_id,updated_at:row.updated_at,body:'Must roll back'});
    throw Error('Callback failed');
  });`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    const headers = { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }
    const created = await owner.fetch('/api/save_row', { method: 'POST', headers, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Keep this' } }) })
    const note = await created.json() as { row_id: string }
    await run()
    const res = await owner.fetch(`/api/table/ownerjobs.note/${note.row_id}`, { headers })
    expect(await res.json()).toMatchObject({ body: 'Keep this' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a document job skips a creator whose membership was revoked', async ({ admin, createUser }) => {
  const dir = await fixture(`await ctx.documents.forEachOwner(async ({user,documents})=>{
    const [row]=await documents.list('ownerjobs.note',{fields:['row_id','updated_at'],filters:[['created_by','=',user]]});
    await documents.update('ownerjobs.note',{row_id:row.row_id,updated_at:row.updated_at,body:'Must not run'});
  });`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    const headers = { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }
    const created = await owner.fetch('/api/save_row', { method: 'POST', headers, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Retain revoked work' } }) })
    const note = await created.json() as { row_id: string }
    const before = await admin.get<Record<string, unknown>>(`/api/table/Person/${owner.user}`)
    const revoked = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'Person', row: { row_id: owner.user, updated_at: before.updated_at, roles: [] } })
    await run()
    await admin.post('/api/save_row', { table: 'Person', row: { row_id: owner.user, updated_at: revoked.updated_at, roles: [{ role: 'Owner jobs member' }] } })
    const res = await owner.fetch(`/api/table/ownerjobs.note/${note.row_id}`, { headers })
    expect(await res.json()).toMatchObject({ body: 'Retain revoked work' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a document job refuses undeclared Tables after a caught access error', async ({ admin, createUser }) => {
  const dir = await fixture(`await ctx.documents.forEachOwner(async ({user,documents})=>{
    const [row]=await documents.list('ownerjobs.note',{fields:['row_id','updated_at'],filters:[['created_by','=',user]]});
    await documents.update('ownerjobs.note',{row_id:row.row_id,updated_at:row.updated_at,body:'Must roll back'});
    try { await documents.list('Person') } catch {}
  });`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    const headers = { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }
    const created = await owner.fetch('/api/save_row', { method: 'POST', headers, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Keep private' } }) })
    const note = await created.json() as { row_id: string }
    await run()
    const res = await owner.fetch(`/api/table/ownerjobs.note/${note.row_id}`, { headers })
    expect(await res.json()).toMatchObject({ body: 'Keep private' })
    const [failure] = await sql`select job_status from background_job where method='ownerjobs.advance' order by created_at desc limit 1`
    expect(failure.job_status).toBe('failed')
    expect(await sql`select 1 from access_log where method='ownerjobs.advance:document_table'`).toHaveLength(1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('an unawaited document owner scope cannot commit after its job returns', async ({ admin, createUser }) => {
  const dir = await fixture(`ctx.documents.forEachOwner(async ({user,documents})=>{
    const [row]=await documents.list('ownerjobs.note',{fields:['row_id','updated_at'],filters:[['created_by','=',user]]});
    await documents.update('ownerjobs.note',{row_id:row.row_id,updated_at:row.updated_at,body:'Must not commit'});
  });`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    const headers = { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }
    const created = await owner.fetch('/api/save_row', { method: 'POST', headers, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Keep original' } }) })
    const note = await created.json() as { row_id: string }
    await run()
    const res = await owner.fetch(`/api/table/ownerjobs.note/${note.row_id}`, { headers })
    expect(await res.json()).toMatchObject({ body: 'Keep original' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a document job cannot declare a platform Table', async () => {
  const dir = await fixture('', { owner_table: 'ownerjobs.note', tables: ['ownerjobs.note', 'Person'] })
  try {
    const failures = await discoverPackages([dir])
    expect(failures).toHaveLength(1)
    expect(failures[0].error).toMatch(/own|declared stored Tables/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('saved owner helpers refuse use after their callback closes', async ({ admin, createUser }) => {
  const dir = await fixture(`await ctx.documents.forEachOwner(async ({documents})=>{globalThis.__ownerJobEscaped=documents});`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    await owner.fetch('/api/save_row', { method: 'POST', headers: { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Private' } }) })
    await run()
    const escaped = (globalThis as unknown as { __ownerJobEscaped: { list(table: string): Promise<unknown> } }).__ownerJobEscaped
    await expect(escaped.list('ownerjobs.note')).rejects.toThrow('scope has closed')
  } finally {
    delete (globalThis as { __ownerJobEscaped?: unknown }).__ownerJobEscaped
    await rm(dir, { recursive: true, force: true })
  }
})
