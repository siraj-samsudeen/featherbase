import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect } from './pg-test'
import { discoverPackages } from '../src/runtime-packages'
import { drainJobs } from '../src/jobs'
import { sql } from '../src/db'
import { expectStatus } from './fixtures'

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
    await expectStatus(created, 201)
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

test('a job without document access cannot hide a caught document refusal', async ({ admin }) => {
  const dir = await fixture(`try { await ctx.documents.forEachOwner(async()=>{}) } catch {} ctx.setResult('Pretended success');`, null)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const [queued] = await sql`select row_id from background_job where method='ownerjobs.advance' and job_status='queued' order by created_at limit 1`
    await run()
    expect(await sql`select job_status from background_job where row_id=${queued.row_id}`).toEqual([{ job_status: 'failed' }])
    expect(await sql`select operation from access_log where method='ownerjobs.advance:documents'`).toEqual([{ operation: 'app_access_denied' }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a job with a non-function owner callback fails instead of succeeding silently', async ({ admin }) => {
  const dir = await fixture('try { await ctx.documents.forEachOwner(null) } catch {}')
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const [queued] = await sql`select row_id from background_job where method='ownerjobs.advance' and job_status='queued' order by created_at limit 1`
    await run()
    expect(await sql`select outcome from job_execution where job=${queued.row_id} and attempt=1`).toEqual([{ outcome: 'error' }])
    const [entry] = await sql`select error from job_execution where job=${queued.row_id} and attempt=1`
    expect(entry.error).toContain('Document owner scopes must be awaited sequentially inside the job')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a saved owner iterator refuses a new scope after its job closes', async ({ admin }) => {
  const dir = await fixture('globalThis.__savedOwnerIterator=ctx.documents.forEachOwner')
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    await run()
    const iterate = (globalThis as unknown as { __savedOwnerIterator: (callback: () => Promise<void>) => Promise<void> }).__savedOwnerIterator
    await expect(iterate(async () => {})).rejects.toThrow('inside the job')
    expect(await sql`select outcome from job_execution where method='ownerjobs.advance'`).toEqual([{ outcome: 'success' }])
  } finally {
    delete (globalThis as { __savedOwnerIterator?: unknown }).__savedOwnerIterator
    await rm(dir, { recursive: true, force: true })
  }
})

test('a document job declaration must include its owner Table', async () => {
  const dir = await fixture('', { owner_table: 'ownerjobs.note', tables: ['ownerjobs.other'] })
  try {
    expect(await discoverPackages([dir])).toEqual([{ path: dir, error: 'A document job must declare its owner Table' }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a document job cannot use a membership-only Table as its private owner registry', async () => {
  const dir = await fixture('')
  try {
    const { readFile } = await import('node:fs/promises')
    const file = resolve(dir, 'featherbase.json')
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    delete manifest.tables[0].access_policy.shared_column
    await writeFile(file, JSON.stringify(manifest))
    expect(await discoverPackages([dir])).toEqual([{ path: dir, error: 'A document job owner Table must declare creator privacy' }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

async function documentUpgrade(declaration: { owner_table: string; tables: string[] }, target: { owner_table: string; tables: string[] } | null) {
  const { readFile, cp } = await import('node:fs/promises')
  const prior = await fixture('', declaration)
  const source = resolve(prior, 'featherbase.json')
  const manifest = JSON.parse(await readFile(source, 'utf8'))
  manifest.tables.push({ ...structuredClone(manifest.tables[0]), name: 'ownerjobs.other', label: 'Other private registry' })
  manifest.permissions.push({ ...manifest.permissions[0], table: 'ownerjobs.other' })
  await writeFile(source, JSON.stringify(manifest))
  const next = await mkdtemp(resolve('test/.owner-jobs-upgrade-'))
  await cp(prior, next, { recursive: true })
  const pkg = JSON.parse(await readFile(resolve(next, 'package.json'), 'utf8'))
  await writeFile(resolve(next, 'package.json'), JSON.stringify({ ...pkg, version: '2.0.0' }))
  if (target) manifest.jobs[0].documents = target
  else delete manifest.jobs[0].documents
  manifest.migrations = [{ id: 'document_scope_v2', fromVersion: '1.0.0', toVersion: '2.0.0', operations: [] }]
  await writeFile(resolve(next, 'featherbase.json'), JSON.stringify(manifest))
  return { prior, next }
}

for (const widened of ['a new Table', 'a different owner registry'] as const) {
  test(`a kept document job cannot gain ${widened} during an upgrade`, async ({ admin }) => {
    const allowed = widened === 'a new Table' ? ['ownerjobs.note'] : ['ownerjobs.note', 'ownerjobs.other']
    const source = await documentUpgrade({ owner_table: 'ownerjobs.note', tables: allowed }, {
      owner_table: widened === 'a new Table' ? 'ownerjobs.note' : 'ownerjobs.other', tables: ['ownerjobs.note', 'ownerjobs.other'],
    })
    try {
      expect(await discoverPackages([source.prior])).toEqual([])
      await admin.post('/api/install_app', { name: 'ownerjobs' })
      expect(await discoverPackages([source.prior, source.next])).toEqual([])
      const { loadInstalledApps } = await import('../src/apps')
      await loadInstalledApps()
      await expect(admin.post('/api/preview_app_upgrade', { name: 'ownerjobs', version: '2.0.0' })).rejects.toMatchObject({
        status: 417, message: expect.stringContaining(widened === 'a new Table' ? 'the Table ownerjobs.other' : 'a different document owner Table'),
      })
      expect(await sql`select package_version from installed_app where name='ownerjobs'`).toEqual([{ package_version: '1.0.0' }])
    } finally { await rm(source.prior, { recursive: true, force: true }); await rm(source.next, { recursive: true, force: true }) }
  })
}

for (const target of [null, { owner_table: 'ownerjobs.note', tables: ['ownerjobs.note'] }]) {
  test(`a document upgrade preview exposes ${target ? 'narrowed Table access' : 'removed document access'}`, async ({ admin }) => {
    const source = await documentUpgrade({ owner_table: 'ownerjobs.note', tables: ['ownerjobs.note', 'ownerjobs.other'] }, target)
    try {
      expect(await discoverPackages([source.prior])).toEqual([])
      await admin.post('/api/install_app', { name: 'ownerjobs' })
      expect(await discoverPackages([source.prior, source.next])).toEqual([])
      const { loadInstalledApps } = await import('../src/apps')
      await loadInstalledApps()
      const preview = await admin.post<{ jobs: unknown[] }>('/api/preview_app_upgrade', { name: 'ownerjobs', version: '2.0.0' })
      expect(preview.jobs).toEqual([{ change: { name: 'advance', documents: target } }])
    } finally { await rm(source.prior, { recursive: true, force: true }); await rm(source.next, { recursive: true, force: true }) }
  })
}

test('overlapping owner iterators roll back the first scope rather than duplicate its work', async ({ admin, createUser }) => {
  const dir = await fixture(`const first=ctx.documents.forEachOwner(async ({user,documents})=>{
    const [row]=await documents.list('ownerjobs.note',{fields:['row_id','updated_at'],filters:[['created_by','=',user]]});
    await documents.update('ownerjobs.note',{row_id:row.row_id,updated_at:row.updated_at,body:'Must not commit'});
  });
  const second=ctx.documents.forEachOwner(async()=>{});
  await Promise.allSettled([first,second]);`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    const headers = { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }
    const created = await owner.fetch('/api/save_row', { method: 'POST', headers, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Retain one copy' } }) })
    const note = await created.json() as { row_id: string }
    await run()
    expect(await (await owner.fetch(`/api/table/ownerjobs.note/${note.row_id}`, { headers })).json()).toMatchObject({ body: 'Retain one copy' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('an unawaited failing owner callback is recorded as a job error', async ({ admin, createUser }) => {
  const dir = await fixture(`ctx.documents.forEachOwner(async()=>{throw Error('unawaited callback failed')});`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    await owner.fetch('/api/save_row', { method: 'POST', headers: { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Private work' } }) })
    const [queued] = await sql`select row_id from background_job where method='ownerjobs.advance' and job_status='queued' order by created_at limit 1`
    await run()
    expect(await sql`select outcome,error from job_execution where job=${queued.row_id} and attempt=1`).toEqual([
      { outcome: 'error', error: expect.stringContaining('unawaited callback failed') },
    ])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a saved job handler refuses execution after its app is disabled', async ({ admin }) => {
  const dir = await fixture('')
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const { bindAppJobs } = await import('../src/app-jobs')
    const { loadAppSetup } = await import('../src/app-settings')
    let ran = false
    const [registered] = bindAppJobs({
      app: 'ownerjobs',
      jobs: [{ name: 'advance', cadence: 'hourly', description: 'Advance owned notes' }],
      handlers: new Map([['advance', async () => { ran = true }]]),
      setup: () => loadAppSetup('ownerjobs', { title: 'Owned jobs' }), datasets: [],
    })
    await admin.post('/api/set_app_enabled', { name: 'ownerjobs', enabled: false })
    await expect(registered.handler({}, {
      job: { row_id: 'stale-bound-job', trigger: 'schedule' },
      setProgress: () => {}, setResult: () => {}, refuse: () => {},
    })).rejects.toThrow('The app ownerjobs is disabled or unavailable, so its job advance did not run')
    expect(ran).toBe(false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a document job fails closed if its owner registry loses creator privacy after installation', async ({ admin, createUser }) => {
  const dir = await fixture(`await ctx.documents.forEachOwner(async ({user,documents})=>{
    const [row]=await documents.list('ownerjobs.note',{fields:['row_id','updated_at'],filters:[['created_by','=',user]]});
    await documents.update('ownerjobs.note',{row_id:row.row_id,updated_at:row.updated_at,body:'Must not run'});
  });`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    const headers = { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }
    const created = await owner.fetch('/api/save_row', { method: 'POST', headers, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Keep protected work' } }) })
    const note = await created.json() as { row_id: string }
    const [queued] = await sql`select row_id from background_job where method='ownerjobs.advance' and job_status='queued' order by created_at limit 1`
    // Model damaged restored metadata. The ordinary schema-edit route refuses
    // to weaken an installed policy, so this fault is injected at storage.
    await sql`update table_def set access_policy='{"version":1,"roles":["Owner jobs member"]}'::jsonb where name='ownerjobs.note'`
    const { invalidateMeta } = await import('../src/meta')
    invalidateMeta('ownerjobs.note')
    await run()
    expect(await sql`select outcome,error from job_execution where job=${queued.row_id} and attempt=1`).toEqual([
      { outcome: 'error', error: expect.stringContaining('The document owner Table is unavailable') },
    ])
    expect(await (await owner.fetch(`/api/table/ownerjobs.note/${note.row_id}`, { headers })).json()).toMatchObject({ body: 'Keep protected work' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a document job skips a disabled creator who retains app membership', async ({ admin, createUser }) => {
  const dir = await fixture(`await ctx.documents.forEachOwner(async ({user,documents})=>{
    const [row]=await documents.list('ownerjobs.note',{fields:['row_id','updated_at'],filters:[['created_by','=',user]]});
    await documents.update('ownerjobs.note',{row_id:row.row_id,updated_at:row.updated_at,body:'Must not mutate disabled work'});
    await documents.create('ownerjobs.note',{body:'Must not impersonate disabled creator'});
  });`)
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const owner = await createUser({ roles: ['Owner jobs member'] })
    const headers = { 'X-Featherbase-App-Version': 'ownerjobs@1.0.0' }
    const created = await owner.fetch('/api/save_row', { method: 'POST', headers, body: JSON.stringify({ table: 'ownerjobs.note', row: { body: 'Retain disabled work' } }) })
    const note = await created.json() as { row_id: string }
    await expectStatus(created, 201)
    const before = await admin.get<Record<string, unknown>>(`/api/table/Person/${owner.user}`)
    const disabled = await admin.post<Record<string, unknown>>('/api/save_row', { table: 'Person', row: { row_id: owner.user, updated_at: before.updated_at, enabled: false } })
    expect(disabled).toMatchObject({ enabled: false, roles: expect.arrayContaining([expect.objectContaining({ role: 'Owner jobs member' })]) })
    await run()
    await admin.post('/api/save_row', { table: 'Person', row: { row_id: owner.user, updated_at: disabled.updated_at, enabled: true } })
    const res = await owner.fetch('/api/table/ownerjobs.note?fields=%5B%22row_id%22%2C%22body%22%2C%22created_by%22%5D', { headers })
    await expectStatus(res, 200)
    expect(await res.json()).toMatchObject({ total: 1, data: [{ row_id: note.row_id, body: 'Retain disabled work', created_by: owner.user }] })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('a document job cannot declare an embedded sub-table as a transactional document', async () => {
  const dir = await fixture('', { owner_table: 'ownerjobs.note', tables: ['ownerjobs.note', 'ownerjobs.line'] })
  try {
    const { readFile } = await import('node:fs/promises')
    const file = resolve(dir, 'featherbase.json')
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    manifest.tables.push({ name: 'ownerjobs.line', label: 'Embedded line', kind: 'sub_table', columns: [{ column_name: 'body', column_type: 'Data' }] })
    await writeFile(file, JSON.stringify(manifest))
    expect(await discoverPackages([dir])).toEqual([{ path: dir, error: 'A document job may name only its app’s declared stored Tables' }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('an upgrade adding a document job exposes its private document access in the preview', async ({ admin }) => {
  const { readFile, cp } = await import('node:fs/promises')
  const prior = await fixture('')
  const next = await mkdtemp(resolve('test/.owner-job-new-'))
  try {
    await cp(prior, next, { recursive: true })
    const sourceFile = resolve(prior, 'featherbase.json')
    const source = JSON.parse(await readFile(sourceFile, 'utf8'))
    source.jobs = []
    await writeFile(sourceFile, JSON.stringify(source))
    await writeFile(resolve(prior, 'server.mjs'), "export const platformVersion='2026-10';export const jobs={}")
    const nextFile = resolve(next, 'featherbase.json')
    const target = JSON.parse(await readFile(nextFile, 'utf8'))
    target.migrations = [{ id: 'new_document_job', fromVersion: '1.0.0', toVersion: '2.0.0', operations: [] }]
    await writeFile(nextFile, JSON.stringify(target))
    const pkg = JSON.parse(await readFile(resolve(next, 'package.json'), 'utf8'))
    await writeFile(resolve(next, 'package.json'), JSON.stringify({ ...pkg, version: '2.0.0' }))
    expect(await discoverPackages([prior])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    expect(await discoverPackages([prior, next])).toEqual([])
    const { loadInstalledApps } = await import('../src/apps')
    await loadInstalledApps()
    const preview = await admin.post<{ jobs: unknown[] }>('/api/preview_app_upgrade', { name: 'ownerjobs', version: '2.0.0' })
    expect(preview.jobs).toEqual([{ add: {
      name: 'advance', cadence: 'hourly', description: 'Advance owned notes', grants: [],
      documents: { owner_table: 'ownerjobs.note', tables: ['ownerjobs.note'] },
    } }])
  } finally { await rm(prior, { recursive: true, force: true }); await rm(next, { recursive: true, force: true }) }
})

test('a document job refused after its handler returned, before its work commits, still fails for good', async ({ admin }) => {
  // The undeclared read starts once the handler has returned and the job's
  // own checks have passed, while its transaction is still committing.
  const dir = await fixture('void (async () => { for (let i = 0; i < 40; i++) await null; ctx.people.list().catch(() => {}) })()')
  try {
    expect(await discoverPackages([dir])).toEqual([])
    await admin.post('/api/install_app', { name: 'ownerjobs' })
    const [queued] = await sql`select row_id from background_job where method='ownerjobs.advance' and job_status='queued' order by created_at limit 1`
    await run()
    expect(await sql`select outcome, error from job_execution where job=${queued.row_id} and attempt=1`)
      .toEqual([{ outcome: 'error', error: 'The job ownerjobs.advance has not declared the grant read_people' }])
    expect(await sql`select job_status from background_job where row_id=${queued.row_id}`).toEqual([{ job_status: 'failed' }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
