import type { TableController } from '../controllers'
import { AppError } from '../errors'
import { config } from '../config'
import { invalidateMeta } from '../meta'
import { assertSystemManager } from '../permissions'
import { invalidateSources } from '../sources/registry'
import { readNamedVariable } from '../env'

// EDS-1 validation + spec S1/S3: saving a Data Source drops its cached
// config and pool, and invalidates the meta cache so bound Tables pick up a
// flipped access mode without a restart.
const ENGINES = new Set(['postgres', 'mysql', 'duckdb', 'csv-folder'])

const controller: TableController = {
  table: 'Data Source',
  hooks: {
    validate: async ({ row, user }) => {
      // P3: source administration is System Manager-only, enforced HERE
      // rather than by permission fixtures alone — a role granted ordinary
      // write/create on Data Source could otherwise repoint connection env
      // vars, roots, access mode and allowlists (review finding 9).
      await assertSystemManager(user)
      const name = String(row.row_id ?? '')
      if (!/^[a-z][a-z0-9-]*$/.test(name))
        throw new AppError('ValidationError', 'Invalid data source name', {
          name: 'Use lowercase letters, digits and hyphens, starting with a letter',
        })
      const engine = String(row.engine ?? '')
      if (!ENGINES.has(engine))
        throw new AppError('ValidationError', 'Invalid engine', {
          engine: 'engine must be postgres, mysql, duckdb or csv-folder',
        })
      if (engine === 'csv-folder') {
        if (!String(row.root_path ?? '').trim())
          throw new AppError('ValidationError', 'csv-folder sources need a folder', {
            root_path: 'root_path is required for csv-folder sources',
          })
      } else if (!String(row.url_env ?? '').trim()) {
        throw new AppError('ValidationError', 'Connection env var required', {
          url_env: 'Name the environment variable holding the connection string',
        })
      }
      // The duckdb driver has no write path; a read_write configuration
      // would only mislabel the UI (review finding 7).
      if (engine === 'duckdb' && row.access === 'read_write')
        throw new AppError('ValidationError', 'DuckDB sources are read-only', {
          access: 'The duckdb engine cannot write; use read_only',
        })
      // BV7!: refuse anything that looks like a pasted secret, not a var name.
      const urlEnv = String(row.url_env ?? '')
      if (/[:/@=]/.test(urlEnv))
        throw new AppError('ValidationError', 'url_env must be a variable NAME', {
          url_env: 'Store the name of an environment variable, never the connection string itself',
        })
      // #432: the platform's own connection is never a data source. This is
      // the early, obvious refusal; the driver proves it for any other URL to
      // the same database when it first connects (sources/platform-guard.ts).
      if (urlEnv && (urlEnv === 'DATABASE_URL' || readNamedVariable(urlEnv) === config.databaseUrl))
        throw new AppError('PermissionError', "A data source cannot use the platform's own database", {
          url_env: `${urlEnv} holds the platform's own connection; point the source at another database`,
        })
    },
    // POST-COMMIT only (review finding 6). Invalidating inside the save
    // transaction let a concurrent request repopulate both caches from the
    // still-committed OLD row — so a source flipped to read_only could stay
    // writable indefinitely. after_commit runs once the new row is visible.
    after_commit: async ({ row }) => {
      invalidateSources(String(row.row_id))
      // Bound Tables cache source_access/source_engine/source_writable.
      invalidateMeta()
    },
    on_trash: async ({ row, tx, user }) => {
      await assertSystemManager(user)
      const bound = await tx`
        select name from table_def where data_source = ${String(row.row_id)} limit 1`
      if (bound.length)
        throw new AppError(
          'ValidationError',
          `Data source ${row.row_id} still has bound Tables (e.g. ${bound[0].name}); delete them first`,
        )
      // Cache drop happens in after_commit, not here.
    },
  },
}

export default controller
