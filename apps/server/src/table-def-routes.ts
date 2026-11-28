import { Hono } from 'hono'
import { AppError } from './errors'
import { resolveTableName } from './meta'
import { createTable, deleteTable, setIdPattern, updateTable } from './table-engine'
import { renameColumn, renameCustomTable } from './table-rename'
import { deleteBatchTables, getBatch, listBatches } from './import-batches'
import { archiveTable, unarchiveTable } from './table-archive'
import { assertSystemManager } from './permissions'
import { ensureHomePageForTable } from './home-pages'
import { rowRuleReport, setRowRule } from './row-rule'
import { logAccess } from './audit'
import { who, type Env } from './route-context'

export const tableDefRoutes = new Hono<Env>()

// #74: `system` marks tables created by the migration chain. It is set only
// by migrations/seeds (through createTable directly) — a table created or
// updated over the API can never claim it.
function rejectSystemClaim(body: Record<string, unknown>) {
  if (body.system)
    throw new AppError('ValidationError', 'Invalid Table definition', {
      system: 'system is reserved for platform tables and cannot be set over the API',
    })
}

tableDefRoutes.post('/api/table_def', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as Record<string, unknown>
  rejectSystemClaim(body)
  const meta = await createTable(body)
  // #1459: who reads its rows is in the Access Log however it was said
  if (body.row_rule != null) await logAccess(who(c), 'set_row_rule', { table: meta.name, scope: JSON.stringify(body.row_rule).slice(0, 140) })
  // #80: a table you build never vanishes from navigation — its module's
  // home page is created on demand and the table's link appended.
  if (meta.kind !== 'sub_table') await ensureHomePageForTable(meta.name, meta.module)
  return c.json(meta, 201)
})

// NAM-001: change how a Table names new rows, without resending its schema.
tableDefRoutes.put('/api/table_def/:name/id_pattern', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as { id_pattern?: unknown }
  if (typeof body.id_pattern !== 'string')
    throw new AppError('ValidationError', 'Expected { id_pattern }')
  return c.json(await setIdPattern(c.req.param('name'), body.id_pattern))
})

// #1459: a System Manager's own rule for who reads which rows of a Table (null takes it away), and every Table's rule.
tableDefRoutes.put('/api/table_def/:name/row_rule', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as { row_rule?: unknown }
  if (!Object.hasOwn(body, 'row_rule')) throw new AppError('ValidationError', 'Expected { row_rule }')
  return c.json(await setRowRule(await resolveTableName(c.req.param('name')), body.row_rule, who(c)))
})

tableDefRoutes.get('/api/row_rules', async (c) => {
  await assertSystemManager(who(c))
  return c.json({ data: await rowRuleReport() })
})

// #206 (issue #197): the file-imports that have run, each rolled up from its
// Import Log parts — which Tables it created, which it added to, and what
// landed. This is a reading of the Import Log, so it answers to the Import
// Log's own read permission (own_rows_only included) rather than to merely
// holding a session; listBatches enforces that from the user it is given.
tableDefRoutes.get('/api/import/batches', async (c) => {
  const limit = Number(c.req.query('limit') ?? '')
  return c.json({
    batches: await listBatches(who(c), Number.isFinite(limit) ? limit : undefined),
  })
})

tableDefRoutes.get('/api/import/batches/:id', async (c) => {
  return c.json(await getBatch(who(c), c.req.param('id')))
})

// #207: delete every Table one import CREATED. Only the created ones — a
// Table that merely received rows is undone by the per-run revert, which is
// offered separately and does not destroy data the import never made.
tableDefRoutes.post('/api/import/batches/:id/delete_tables', async (c) => {
  return c.json(await deleteBatchTables(c.req.param('id'), who(c)))
})

// DEL-R1/R2 (docs/specs/0003-table-deletion.md): delete a Table outright.
tableDefRoutes.delete('/api/table_def/:name', async (c) => {
  await assertSystemManager(who(c))
  await deleteTable(c.req.param('name'), who(c))
  return c.json({ ok: true })
})

// #209 (issue #197): rename a column in place, keeping its data. PUT
// /api/table_def/:name matches columns BY NAME, so a changed name there reads
// as delete-plus-add, which it refuses (#250) — hence this route.
tableDefRoutes.post('/api/table_def/:name/rename_column', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as { from?: unknown; to?: unknown }
  if (typeof body.from !== 'string' || typeof body.to !== 'string')
    throw new AppError('ValidationError', 'Expected { from, to }')
  return c.json(await renameColumn(c.req.param('name'), body.from, body.to, who(c)))
})

// #905: archive a custom Table, or bring it back. Its rows stay readable.
tableDefRoutes.post('/api/table_def/:name/archive', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json().catch(() => ({}))) as { note?: unknown }
  return c.json(await archiveTable(await resolveTableName(c.req.param('name')), who(c), body.note))
})

tableDefRoutes.post('/api/table_def/:name/unarchive', async (c) => {
  await assertSystemManager(who(c))
  return c.json(await unarchiveTable(await resolveTableName(c.req.param('name')), who(c)))
})

// #871: rename a custom Table, carrying everything that names it.
tableDefRoutes.post('/api/table_def/:name/rename', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as { to?: unknown }
  if (typeof body.to !== 'string') throw new AppError('ValidationError', 'Expected { to }')
  return c.json(await renameCustomTable(await resolveTableName(c.req.param('name')), body.to, who(c)))
})

tableDefRoutes.put('/api/table_def/:name', async (c) => {
  await assertSystemManager(who(c))
  const body = (await c.req.json()) as Record<string, unknown> & { drop_columns?: boolean; remove_columns?: unknown }
  rejectSystemClaim(body)
  const { drop_columns, remove_columns, ...def } = body
  if (remove_columns !== undefined && !(Array.isArray(remove_columns) && remove_columns.every((c) => typeof c === 'string')))
    throw new AppError('ValidationError', 'remove_columns must be a list of column names')
  const updated = await updateTable(c.req.param('name'), def, { drop_columns, remove_columns })
  // #1459: a rule changed with the rest of the definition is in the Access Log too
  if (Object.hasOwn(def, 'row_rule'))
    await logAccess(who(c), 'set_row_rule', { table: updated.name, scope: (def.row_rule == null ? 'cleared' : JSON.stringify(def.row_rule)).slice(0, 140) })
  return c.json(updated)
})
