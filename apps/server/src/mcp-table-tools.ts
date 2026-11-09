// #1105 (openspec change mcp-table-lifecycle): an agent shapes a Table and
// imports a CSV into it over /mcp. Every write is an inner request to the
// route the Admin uses — the Table builder's and column editor's
// /api/table_def…, the import wizard's :import and :import-revert — with the
// caller's token, so the same permissions, schema rules, import invariants
// and history apply (D6). The tool layer does only what the wizard does in
// the browser: read the file, match headings, coerce cells, send parts (D3).
import { createHash, randomUUID } from 'node:crypto'
import * as z from 'zod'
import { LIST_COLUMNS_ON_CREATE, autoMapImportColumns, coerceRows, inferTableDef, splitForSend, type CoercedRow } from 'shared'
import { parseCsv, type CsvDelimiter } from './csv'
import { AppError } from './errors'
import { COLUMN_TYPE_VALUES, ROW_KEY } from './meta'
import {
  ADDS, ALTERS, LAYOUT_TYPES, NESTED, READS, describeColumn, tablePath,
  type Api, type ColumnMeta, type Json, type RegisterTool,
} from './mcp-common'

/** D3: the import route's own cap per request, and a ceiling on the text. */
export const MCP_IMPORT_MAX_ROWS = 10_000
export const MCP_IMPORT_MAX_BYTES = 5 * 1024 * 1024
/** The parts the wizard sends (lib/import-run.ts IMPORT_CHUNK). */
const IMPORT_PART = 500
/** spreadsheet-import "A large update is confirmed before it runs". */
export const CONFIRM_CHANGES_OVER = 20

type StoredColumn = ColumnMeta & { hidden?: boolean | null; unique?: boolean | null; default_value?: string | null }
type TableDef = Json & { name: string; label: string | null; description: string | null; columns: StoredColumn[] }

const tableArg = z.string().min(1).describe('The Table\'s name, as list_tables gives it')
const columnNameArg = z.string().min(1).describe('The column\'s name, as describe_table gives it')

// D2: a column in the words describe_table reads it in.
const columnArg = z.object({
  name: z.string().min(1).describe('snake_case, e.g. phone_number'),
  type: z.enum(COLUMN_TYPE_VALUES),
  label: z.string().optional().describe('What people read; made from the name when left out'),
  required: z.boolean().optional(),
  choices: z.array(z.string()).optional().describe('For a Choice column: the values it allows'),
  links_to: z.string().optional().describe('For a Reference column, the Table it links to; for a Sub-table column, the Table of its nested rows'),
  unique: z.boolean().optional(),
  description: z.string().optional().describe('One line every form shows under the column'),
  default: z.string().optional().describe('The value a new row starts with'),
})
type ColumnArg = z.infer<typeof columnArg>

function columnDef(column: ColumnArg): Json {
  return {
    column_name: column.name,
    column_type: column.type,
    ...(column.label !== undefined ? { label: column.label } : {}),
    ...(column.required !== undefined ? { reqd: column.required } : {}),
    ...(column.choices ? { choices: column.choices.join('\n') } : {}),
    ...(column.links_to ? { [column.type === NESTED ? 'row_table' : 'reference_table']: column.links_to } : {}),
    ...(column.unique !== undefined ? { unique: column.unique } : {}),
    ...(column.description !== undefined ? { description: column.description } : {}),
    ...(column.default !== undefined ? { default_value: column.default } : {}),
  }
}

/** A Table as the structure tools answer it: its value columns, as describe_table reads them. */
const described = (def: TableDef) => ({
  table: def.name,
  label: def.label || def.name,
  description: def.description,
  columns: def.columns.filter((c) => !LAYOUT_TYPES.has(c.column_type)).map(describeColumn),
})

const noColumn = (table: string, column: string) =>
  new AppError('ValidationError', `${table} has no column ${column}`, { [column]: 'not a column of this Table' })

// ---- the file --------------------------------------------------------------

const csvArgs = {
  csv: z.string().describe(`The file as CSV text, its header row first. At most ${MCP_IMPORT_MAX_ROWS} rows and 5 MB; an Excel workbook is saved as CSV first.`),
  delimiter: z.enum([',', '\t', ';']).optional().describe('What separates cells: a comma (the default), a tab or a semicolon'),
}

function readFile(csv: string, delimiter: CsvDelimiter = ','): { headers: string[]; rows: string[][] } {
  if (Buffer.byteLength(csv, 'utf8') > MCP_IMPORT_MAX_BYTES)
    throw new AppError('ValidationError', `The file is over 5 MB; send it in smaller files of at most ${MCP_IMPORT_MAX_ROWS} rows`)
  const [headers, ...rows] = parseCsv(csv, delimiter)
  if (!headers || !headers.some((h) => h.trim())) throw new AppError('ValidationError', 'The file has no header row')
  if (rows.length > MCP_IMPORT_MAX_ROWS)
    throw new AppError('ValidationError', `The file has ${rows.length} rows; an import takes at most ${MCP_IMPORT_MAX_ROWS} at a time`)
  return { headers, rows }
}

const blank = (row: string[]) => !row.some((cell) => cell.trim() !== '')

const importArgs = {
  table: tableArg,
  ...csvArgs,
  columns: z.record(z.string(), z.string().nullable()).optional().describe(
    'Heading to column name, for a heading whose column is not matched by name or label; null leaves a heading out. '
    + `"${ROW_KEY}" makes the file's values the rows' ids.`),
  key_column: z.string().optional().describe('Match each row of the file to an existing row by this column, and update it instead of adding one'),
  empty_cells: z.enum(['keep', 'clear']).optional().describe('With key_column: whether an empty cell keeps the matched row\'s value (the default) or clears it'),
}
type ImportArgs = z.infer<z.ZodObject<typeof importArgs>>

interface Failure { row: number; message: string; fields?: Record<string, string> }

interface Prepared {
  table: string
  mapping: Record<string, string | null>
  columns: string[]
  send: Record<string, unknown>[]
  sendRow: number[]
  failed: Failure[]
  skipped: number
  upsert: Json
}

/** The file's row number of a data row: the header is row 1 (as Excel shows it). */
const fileRow = (sourceIndex: number) => sourceIndex + 2

/** What the wizard does before sending: match headings, coerce cells by type, fail repeated keys. */
function prepare(def: TableDef, args: ImportArgs): Prepared {
  const { headers, rows } = readFile(args.csv, args.delimiter)
  const targets = def.columns.filter((c) =>
    !LAYOUT_TYPES.has(c.column_type) && c.column_type !== NESTED && !c.hidden && !c.read_only)
  const mapped = autoMapImportColumns(def.name, headers, targets)
  const errors: Record<string, string> = {}
  for (const [heading, column] of Object.entries(args.columns ?? {})) {
    const at = headers.indexOf(heading)
    if (at < 0) errors[heading] = 'not a heading of the file'
    else if (column !== null && column !== ROW_KEY && !targets.some((c) => c.column_name === column))
      errors[heading] = `${def.name} has no column ${column} a file can fill`
    else {
      // The agent's word wins over a heading matched by name.
      for (const [i, m] of mapped.entries()) if (m === column && column !== null) mapped[i] = null
      mapped[at] = column
    }
  }
  if (Object.keys(errors).length) throw new AppError('ValidationError', 'The columns mapping does not fit the file', errors)
  const picked = headers.flatMap((heading, index) => (mapped[index] ? [{ heading, index, column: mapped[index]! }] : []))
  if (!picked.length)
    throw new AppError('ValidationError', `No heading of the file matches a column of ${def.name}; name them in columns`)
  const typed = picked.map(({ column }) => ({
    column_name: column,
    column_type: column === ROW_KEY ? 'Data' : def.columns.find((c) => c.column_name === column)!.column_type,
  }))
  const coerced: CoercedRow[] = coerceRows(typed, rows.map((row) => picked.map(({ index }) => row[index])))
  const key = args.key_column ?? null
  const { send, sendIdx, dupFailed } = splitForSend(coerced, key)
  return {
    table: def.name,
    mapping: Object.fromEntries(headers.map((heading, i) => [heading, mapped[i] ?? null])),
    columns: picked.map((p) => p.column),
    send,
    sendRow: sendIdx.map(fileRow),
    failed: dupFailed.map((f) => ({ row: fileRow(f.sourceIndex), message: f.message })),
    skipped: rows.filter((row) => !blank(row)).length - coerced.length,
    upsert: key
      ? { key_column: key, ...(args.empty_cells ? { empty_cells: args.empty_cells } : {}), columns: picked.map((p) => p.column) }
      : args.empty_cells ? { empty_cells: args.empty_cells } : {},
  }
}

type PartReply = Json & { failed: { index: number; message: string; fields?: Record<string, string> }[] }

/** Send the prepared rows in parts; the failures name their row of the file. */
async function sendParts(api: Api, p: Prepared, body: (part: number, parts: number) => Json) {
  const totals = { valid: 0, inserted: 0, updated: 0, changed: 0, unchanged: 0 }
  const failed = [...p.failed]
  const parts = Math.ceil(p.send.length / IMPORT_PART)
  for (let at = 0; at < p.send.length; at += IMPORT_PART) {
    const reply = (await api('POST', `${tablePath(p.table)}:import`, {
      rows: p.send.slice(at, at + IMPORT_PART), ...p.upsert, ...body(at / IMPORT_PART + 1, parts),
    })) as PartReply
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += Number(reply[key] ?? 0)
    // A keyless rehearsal reports no per-action counts: every valid row is an insert.
    if (reply.inserted === undefined) totals.inserted += Number(reply.valid ?? 0)
    failed.push(...reply.failed.map((f) => ({ row: p.sendRow[at + f.index]!, message: f.message, ...(f.fields ? { fields: f.fields } : {}) })))
  }
  failed.sort((a, b) => a.row - b.row)
  return { ...totals, failed }
}

/** spreadsheet-import "A fully overlapping append is deliberate": the columns by which every row is already there. */
async function alreadyThere(api: Api, p: Prepared): Promise<{ column: string; rows: number }[]> {
  if (!p.send.length) return []
  const distinct = (column: string) => {
    const seen = new Set<string>()
    for (const row of p.send) {
      const key = row[column] == null ? '' : String(row[column]).trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
    }
    return true
  }
  const eligible = p.columns.filter(distinct)
  let found = eligible.map((column) => ({ column, matched: 0, complete: true }))
  for (let at = 0; at < p.send.length && found.length; at += IMPORT_PART) {
    const { key_candidates } = (await api('POST', `${tablePath(p.table)}:import`, {
      analyze_keys: true, columns: eligible, rows: p.send.slice(at, at + IMPORT_PART),
    })) as { key_candidates: { column: string; matched: number; complete: boolean }[] }
    found = found.flatMap((c) => {
      const part = key_candidates.find((k) => k.column === c.column)
      return part ? [{ column: c.column, matched: c.matched + part.matched, complete: c.complete && part.complete }] : []
    })
  }
  return found.filter((c) => c.complete).map((c) => ({ column: c.column, rows: c.matched }))
}

/** D4: what a check vouches for — this caller, this Table as it is shaped now, this file and these options. */
function checkDigest(tokenId: string, def: TableDef, args: ImportArgs): string {
  const shape = def.columns.map((c) => [c.column_name, c.column_type, c.reference_table ?? null, c.choices ?? null, Boolean(c.reqd)])
  const columns = Object.entries(args.columns ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256').update(JSON.stringify([
    tokenId, def.name, shape, args.csv, args.delimiter ?? ',', columns, args.key_column ?? null, args.empty_cells ?? null,
  ])).digest('base64url')
}

const CHECK_FIRST = 'Check the import first: run check_import with these same arguments and pass the check it returns'

// ---- the tools -------------------------------------------------------------

export function registerTableTools(tool: RegisterTool, api: Api, tokenId: string) {
  const definition = (table: string) => api('GET', `${tablePath(table)}:meta`) as Promise<TableDef>
  const putDefinition = async (def: TableDef, columns: unknown[], extra: Json = {}) =>
    described((await api('PUT', `/api/table_def/${encodeURIComponent(def.name)}`, { ...def, columns, ...extra })) as TableDef)
  const column = (def: TableDef, name: string) => {
    const found = def.columns.find((c) => c.column_name === name)
    if (!found) throw noColumn(def.name, name)
    return found
  }

  tool('create_table',
    'Make a new Table with these columns, as the Table builder does; needs the right to build Tables. '
    + 'For a file, suggest_table offers the columns. Returns the Table as describe_table reads it.',
    {
      table: z.string().min(1).describe('The new Table\'s name: letters, digits and spaces, e.g. "Supplier"'),
      label: z.string().optional(),
      description: z.string().optional(),
      id_pattern: z.string().optional().describe('How new rows get their id, e.g. "SUP-.###"; a random id when left out'),
      columns: z.array(columnArg).min(1),
    },
    ADDS,
    async ({ table, label, description, id_pattern, columns }) => described((await api('POST', '/api/table_def', {
      name: table,
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      ...(id_pattern ? { id_pattern } : {}),
      // As the wizard does: the first columns show in the Table's list.
      columns: columns.map((c, i) => ({ ...columnDef(c), in_list_view: i < LIST_COLUMNS_ON_CREATE })),
    })) as TableDef))

  tool('add_column',
    'Add a column to a Table, as the column editor does; every existing row has it empty. Needs the right to build Tables.',
    { table: tableArg, column: columnArg }, ADDS,
    async ({ table, column }) => {
      const def = await definition(table)
      return putDefinition(def, [...def.columns, columnDef(column)])
    })

  tool('change_column',
    'Change a column: its label, whether it is required, its choices, its description or default, whether it is unique, '
    + 'or turn a text column into a link (links_to: a Table whose row ids its values are) and a link back into text (links_to: null). '
    + 'Only what you name changes. Any other change of type is refused, as in Featherbase. Needs the right to build Tables.',
    {
      table: tableArg,
      column: columnNameArg,
      label: z.string().optional(),
      type: z.enum(COLUMN_TYPE_VALUES).optional(),
      required: z.boolean().optional(),
      choices: z.array(z.string()).optional(),
      links_to: z.string().nullable().optional(),
      unique: z.boolean().optional(),
      description: z.string().optional(),
      default: z.string().nullable().optional(),
    },
    ALTERS,
    async ({ table, column: name, links_to, type, ...changes }) => {
      const def = await definition(table)
      const old = column(def, name)
      const linking = links_to === undefined ? {}
        : links_to === null ? { reference_table: null, column_type: type ?? (old.column_type === 'Reference' ? 'Data' : old.column_type) }
          : { reference_table: links_to, column_type: type ?? 'Reference' }
      const changed: Json = {
        ...old,
        ...(type ? { column_type: type } : {}),
        ...linking,
        ...(changes.label !== undefined ? { label: changes.label } : {}),
        ...(changes.required !== undefined ? { reqd: changes.required } : {}),
        ...(changes.choices ? { choices: changes.choices.join('\n') } : {}),
        ...(changes.unique !== undefined ? { unique: changes.unique } : {}),
        ...(changes.description !== undefined ? { description: changes.description } : {}),
        ...(changes.default !== undefined ? { default_value: changes.default } : {}),
      }
      return putDefinition(def, def.columns.map((c) => (c.column_name === name ? changed : c)))
    })

  tool('rename_column',
    'Give a column a new name, keeping every value in it, as the column editor does. Filters and agents using the old name stop finding it. '
    + 'Needs the right to build Tables.',
    { table: tableArg, column: columnNameArg, to: z.string().min(1).describe('The new snake_case name') },
    ALTERS,
    async ({ table, column, to }) => {
      const def = await definition(table)
      return described((await api('POST', `/api/table_def/${encodeURIComponent(def.name)}/rename_column`, { from: column, to })) as TableDef)
    })

  tool('remove_column',
    'Take a column out of a Table. Its values are kept, and adding a column of the same name back brings them back. '
    + 'Needs the right to build Tables.',
    { table: tableArg, column: columnNameArg }, ALTERS,
    async ({ table, column }) => {
      const def = await definition(table)
      return putDefinition(def, def.columns.filter((c) => c.column_name !== column), { remove_columns: [column] })
    })

  tool('suggest_table',
    'Which Table would hold a file: a column for each heading, with the kind of value its cells hold. '
    + 'Writes nothing; pass the answer, changed as you like, to create_table, then check_import and run_import the file into it.',
    { table: z.string().min(1).describe('The new Table\'s name'), ...csvArgs }, READS,
    async ({ table, csv, delimiter }) => {
      const { headers, rows } = readFile(csv, delimiter)
      const inferred = inferTableDef(table, headers, rows.filter((row) => !blank(row)))
      return {
        table: inferred.name,
        id_pattern: inferred.id_pattern,
        columns: inferred.columns.map((c) => ({
          name: c.column_name, label: c.label, type: c.column_type,
          ...(c.choices ? { choices: c.choices.split('\n') } : {}),
        })),
      }
    })

  const rehearse = async (args: ImportArgs) => {
    const def = await definition(args.table)
    const prepared = prepare(def, args)
    const report = await sendParts(api, prepared, () => ({ dry_run: true }))
    return { def, prepared, report }
  }

  tool('check_import',
    'Check a CSV against a Table before importing it, as the import wizard\'s check does: how many rows would be added or updated, '
    + 'and which would be refused and why, by their row in the file (the header is row 1). Writes nothing. '
    + 'Headings go into the column of that name or label, or as columns says. Returns check, which run_import needs.',
    importArgs, READS,
    async (args) => {
      const { def, prepared, report } = await rehearse(args)
      const there = args.key_column ? [] : await alreadyThere(api, prepared)
      return {
        table: def.name,
        mapping: prepared.mapping,
        ...report,
        skipped: prepared.skipped,
        ...(there.length ? { already_there: there } : {}),
        check: checkDigest(tokenId, def, args),
      }
    })

  tool('run_import',
    'Import a CSV into a Table exactly as check_import checked it. Rows the check refused are refused again; the others land, '
    + 'each saved with the Table\'s checks and automations. Without key_column, a file whose every row is already in the Table '
    + `is refused unless add_anyway; with it, more than ${CONFIRM_CHANGES_OVER} changed rows need confirm_changes set to their number. `
    + 'Returns run_id, which undo_import takes.',
    {
      ...importArgs,
      check: z.string({ error: CHECK_FIRST }).min(1, CHECK_FIRST).describe('The check check_import returned for these same arguments'),
      add_anyway: z.boolean().optional().describe('Add the rows even though every one is already in the Table'),
      confirm_changes: z.number().int().optional().describe(`With key_column, the number of rows the import changes, when over ${CONFIRM_CHANGES_OVER}`),
      file_name: z.string().optional().describe('The file\'s name, recorded with the import'),
    },
    ALTERS,
    async ({ check, add_anyway, confirm_changes, file_name, ...args }) => {
      const def = await definition(args.table)
      if (check !== checkDigest(tokenId, def, args)) throw new AppError('ValidationError', CHECK_FIRST)
      const prepared = prepare(def, args)
      // As the wizard does on every click: rehearse again, now, before writing.
      if (args.key_column) {
        const { changed } = await sendParts(api, prepared, () => ({ dry_run: true }))
        if (changed > CONFIRM_CHANGES_OVER && confirm_changes !== changed)
          throw new AppError('ValidationError', `This import changes ${changed} existing rows of ${def.name}; to run it, pass confirm_changes: ${changed}`)
      } else if (!add_anyway) {
        const there = await alreadyThere(api, prepared)
        if (there.length)
          throw new AppError('ValidationError',
            `Every row of the file is already in ${def.name} by ${there.map((t) => t.column).join(' or ')}: importing adds them again. `
            + `Pass key_column: "${there[0]!.column}" to update them instead, or add_anyway: true to add them again`)
      }
      const runId = randomUUID()
      const { inserted, updated, failed } = await sendParts(api, prepared, (part, parts) => ({
        context: { run_id: runId, batch_id: runId, part, parts, ...(file_name ? { file_name } : {}) },
      }))
      return { table: def.name, run_id: runId, inserted, updated, failed, skipped: prepared.skipped }
    })

  tool('list_imports',
    'The imports into a Table, newest first, each with its run_id, file name, rows added, updated and refused, and when it was undone.',
    { table: tableArg }, READS,
    async ({ table }) => {
      const def = await definition(table)
      const query = new URLSearchParams({
        fields: JSON.stringify(['run_id', 'file_name', 'inserted', 'updated', 'failed', 'reverted_at', 'created_at']),
        filters: JSON.stringify([['ref_table', '=', def.name]]),
        order_by: 'created_at desc',
        limit_page_length: '500',
      })
      const { data } = (await api('GET', `${tablePath('Import Log')}?${query}`)) as { data: Json[] }
      const runs = new Map<string, Json & { inserted: number; updated: number; failed: number }>()
      for (const part of data) {
        if (!part.run_id) continue // an import from before runs had ids cannot be undone
        const id = String(part.run_id)
        const run = runs.get(id) ?? { run_id: id, file_name: part.file_name ?? null, at: part.created_at, inserted: 0, updated: 0, failed: 0, undone_at: null }
        run.inserted += Number(part.inserted ?? 0)
        run.updated += Number(part.updated ?? 0)
        run.failed += Number(part.failed ?? 0)
        run.undone_at ??= part.reverted_at ?? null
        runs.set(id, run)
      }
      return { table: def.name, imports: [...runs.values()] }
    })

  tool('undo_import',
    'Undo an import, as the import wizard does: rows it added are deleted, rows it updated get their earlier values back. '
    + 'A row changed since is left alone and named, unless its id is in override. With dry_run, says what it would do and writes nothing.',
    {
      table: tableArg,
      run_id: z.string().min(1).describe('The import\'s run_id, as list_imports or run_import gave it'),
      dry_run: z.boolean().optional(),
      override: z.array(z.string()).optional().describe('Ids of rows changed since the import, to undo all the same'),
    },
    ALTERS,
    ({ table, run_id, dry_run, override }) => api('POST', `${tablePath(table)}:import-revert`, {
      run_id, ...(dry_run ? { dry_run } : {}), ...(override ? { override } : {}),
    }))
}
