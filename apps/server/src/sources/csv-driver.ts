import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AppError } from '../errors'
import { parseCsv, serializeCsv, serializeRecord, type CsvModel } from './csv'
import type {
  Binding,
  IntrospectedTable,
  ListSpec,
  SourceConfig,
  SourceDriver,
  SourceFilter,
  SourceRow,
} from './types'

// M1 (execution plan): dbt seed CSVs edited in the Desk. A csv-folder source
// points root_path at a real directory (e.g. a dbt repo's seeds/); every
// *.csv under it is a bindable table whose external_table is the file's
// relative path. Rows are addressed by a synthetic 1-based row number
// (external_pk '_row'); optimistic locking rides the file's mtime
// (external_modified '_mtime') — if the file changed since the client
// loaded, the save conflicts instead of clobbering someone's edit.
//
// Values are kept as verbatim strings and untouched records keep their raw
// bytes (csv.ts), so a no-op round trip is byte-identical and every edit
// produces a minimal, reviewable git diff in the dbt repo. Deliberately NOT
// routed through storage.ts — that is an opaque blob store; this is a
// browsable folder someone else also edits.

interface CacheEntry {
  mtimeMs: number
  size: number
  model: CsvModel
}
const cache = new Map<string, CacheEntry>()
// Serialize read-modify-write per file so two concurrent saves can't
// interleave (single process, so an in-memory mutex is enough).
const fileLocks = new Map<string, Promise<unknown>>()

function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(file) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  fileLocks.set(
    file,
    next.catch(() => {}),
  )
  return next
}

function rootOf(cfg: SourceConfig): string {
  if (!cfg.root_path)
    throw new AppError('ValidationError', `Data source ${cfg.name} has no root_path configured`)
  return path.resolve(cfg.root_path)
}

// Path traversal guard: external_table is a relative path that must resolve
// inside root_path.
function resolveFile(cfg: SourceConfig, rel: string): string {
  const root = rootOf(cfg)
  const abs = path.resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + path.sep))
    throw new AppError('ValidationError', `Invalid csv path ${rel}`)
  return abs
}

async function loadModel(cfg: SourceConfig, rel: string): Promise<{ file: string; model: CsvModel; mtimeMs: number }> {
  const file = resolveFile(cfg, rel)
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    throw new AppError('DataSourceError', `Data source ${cfg.name}: file ${rel} does not exist`)
  }
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size)
    return { file, model: cached.model, mtimeMs: stat.mtimeMs }
  const text = await fs.readFile(file, 'utf8')
  const model = parseCsv(text)
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, model })
  return { file, model, mtimeMs: stat.mtimeMs }
}

// Atomic write: temp file in the same directory, then rename over the
// original. Refreshes the cache from the new stat.
async function writeModel(file: string, model: CsvModel): Promise<number> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.fb-tmp`)
  await fs.writeFile(tmp, serializeCsv(model), 'utf8')
  await fs.rename(tmp, file)
  const stat = await fs.stat(file)
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, model })
  return stat.mtimeMs
}

function mtimeIso(mtimeMs: number): string {
  return new Date(mtimeMs).toISOString()
}

// A record as the dispatcher sees it: source columns by header name, plus
// the synthetic pk and modified marker.
function toRow(model: CsvModel, index: number, mtimeMs: number): SourceRow {
  const rec = model.records[index]
  const row: SourceRow = { _row: String(index + 1), _mtime: mtimeIso(mtimeMs) }
  model.headers.forEach((h, i) => {
    row[h] = rec.fields[i] ?? ''
  })
  return row
}

function cmp(a: unknown, b: unknown): number {
  const na = Number(a)
  const nb = Number(b)
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb))
    return na < nb ? -1 : na > nb ? 1 : 0
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function likeToRegExp(pattern: string): RegExp {
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${esc.replace(/%/g, '.*').replace(/_/g, '.')}$`, 'i')
}

function matches(row: SourceRow, f: SourceFilter): boolean {
  const v = row[f.column]
  switch (f.op) {
    case '=':
      return cmp(v, f.value) === 0
    case '!=':
      return cmp(v, f.value) !== 0
    case '>':
      return cmp(v, f.value) > 0
    case '<':
      return cmp(v, f.value) < 0
    case '>=':
      return cmp(v, f.value) >= 0
    case '<=':
      return cmp(v, f.value) <= 0
    case 'like':
      return likeToRegExp(String(f.value ?? '')).test(String(v ?? ''))
    case 'not like':
      return !likeToRegExp(String(f.value ?? '')).test(String(v ?? ''))
    case 'in':
      return Array.isArray(f.value) && (f.value as unknown[]).some((x) => cmp(v, x) === 0)
    case 'not in':
      return !(Array.isArray(f.value) && (f.value as unknown[]).some((x) => cmp(v, x) === 0))
  }
}

async function allRows(bind: Binding): Promise<{ rows: SourceRow[]; model: CsvModel; file: string; mtimeMs: number }> {
  const { file, model, mtimeMs } = await loadModel(bind.source, bind.table)
  const rows = model.records.map((_, i) => toRow(model, i, mtimeMs))
  return { rows, model, file, mtimeMs }
}

async function listCsvFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.csv'))
        out.push(path.relative(root, abs))
    }
  }
  await walk(root)
  return out.sort()
}

// Values in edited records come back from the Desk as typed JS values;
// everything is stored as its string form (null → empty string).
function toCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function applyValues(model: CsvModel, fields: string[], values: SourceRow): string[] {
  const next = [...fields]
  while (next.length < model.headers.length) next.push('')
  model.headers.forEach((h, i) => {
    if (h in values) next[i] = toCell(values[h])
  })
  return next
}

function pkIndex(model: CsvModel, pk: string): number {
  const idx = Number(pk) - 1
  if (!Number.isInteger(idx) || idx < 0 || idx >= model.records.length) return -1
  return idx
}

export const csvFolderDriver: SourceDriver = {
  engine: 'csv-folder',
  writable: true,

  async test(cfg) {
    const root = rootOf(cfg)
    const stat = await fs.stat(root).catch(() => null)
    if (!stat?.isDirectory())
      throw new AppError('DataSourceError', `root_path ${root} is not a readable directory`)
  },

  async introspect(cfg): Promise<IntrospectedTable[]> {
    const root = rootOf(cfg)
    const files = await listCsvFiles(root)
    const tables: IntrospectedTable[] = []
    for (const rel of files) {
      let model: CsvModel
      try {
        model = (await loadModel(cfg, rel)).model
      } catch {
        continue
      }
      if (!model.headers.length || model.headers.every((h) => !h.trim())) continue
      const sample = model.records.slice(0, 200)
      tables.push({
        schema: '',
        table: rel,
        pk: '_row',
        columns: model.headers.map((h, i) => {
          const maxLen = Math.max(0, ...sample.map((r) => (r.fields[i] ?? '').length))
          return {
            name: h,
            data_type: 'text',
            nullable: true,
            has_default: false,
            is_pk: false,
            max_length: maxLen,
            // Verbatim strings only — typed coercion would break byte
            // stability (leading zeros, number formatting).
            column_type: maxLen > 120 ? 'Text' : 'Data',
          }
        }),
      })
    }
    return tables
  },

  async getList(bind, spec: ListSpec) {
    const { rows } = await allRows(bind)
    const filtered = rows.filter((r) => spec.filters.every((f) => matches(r, f)))
    const dir = spec.order.dir === 'desc' ? -1 : 1
    const col = spec.order.column
    const sorted =
      col === '_row'
        ? dir === 1
          ? filtered
          : [...filtered].reverse()
        : [...filtered].sort((a, b) => dir * cmp(a[col], b[col]))
    const page = sorted.slice(spec.offset, spec.offset + spec.limit)
    const wanted = new Set(['_row', '_mtime', ...spec.columns])
    const projected = page.map((r) =>
      Object.fromEntries(Object.entries(r).filter(([k]) => wanted.has(k))),
    )
    return { rows: projected, total: filtered.length }
  },

  async getDoc(bind, pk) {
    const { model, mtimeMs } = await loadModel(bind.source, bind.table)
    const idx = pkIndex(model, pk)
    return idx === -1 ? null : toRow(model, idx, mtimeMs)
  },

  async count(bind, filters) {
    const { rows } = await allRows(bind)
    return rows.filter((r) => filters.every((f) => matches(r, f))).length
  },

  async groupCount(bind, column, filters) {
    const { rows } = await allRows(bind)
    const counts = new Map<string, number>()
    for (const r of rows) {
      if (!filters.every((f) => matches(r, f))) continue
      const label = String(r[column] ?? '')
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1))
  },

  async insert(bind, values) {
    return withFileLock(resolveFile(bind.source, bind.table), async () => {
      const { file, model } = await loadModel(bind.source, bind.table)
      const fields = applyValues(model, model.headers.map(() => ''), values)
      model.records.push({ fields, raw: serializeRecord(fields) })
      const mtimeMs = await writeModel(file, model)
      return toRow(model, model.records.length - 1, mtimeMs)
    })
  },

  async update(bind, pk, values, expectModified) {
    return withFileLock(resolveFile(bind.source, bind.table), async () => {
      const { file, model, mtimeMs } = await loadModel(bind.source, bind.table)
      const idx = pkIndex(model, pk)
      if (idx === -1) return 'missing' as const
      if (expectModified != null && expectModified !== mtimeIso(mtimeMs)) return 'conflict' as const
      const fields = applyValues(model, model.records[idx].fields, values)
      model.records[idx] = { fields, raw: serializeRecord(fields) }
      const newMtime = await writeModel(file, model)
      return toRow(model, idx, newMtime)
    })
  },

  async remove(bind, pk) {
    await withFileLock(resolveFile(bind.source, bind.table), async () => {
      const { file, model } = await loadModel(bind.source, bind.table)
      const idx = pkIndex(model, pk)
      if (idx === -1) throw new AppError('NotFoundError', `Row ${pk} not found in ${bind.table}`)
      model.records.splice(idx, 1)
      await writeModel(file, model)
    })
  },

  dispose() {
    cache.clear()
  },
}
