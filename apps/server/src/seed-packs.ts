// Seed packs (person-resolution D2): an organisation's own configuration,
// shipped as data and applied by `cli seed-pack apply <name>`. Idempotent: a
// row already present is left as the administrator has it; only what is
// missing is added. Core ships the generic rows; a pack adds the rest.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from './db'
import { saveDoc } from './document'
import { AppError } from './errors'
import { CORE_PEOPLE_REVIEW_JSON } from './person-identifiers'
import { completeSystemRow } from './identifiers'

const SEEDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'seeds')

/** Save a new Identifier System row with its kind's defaults filled in and
 *  its derived columns stamped — the same result as the controller, for
 *  callers that run with no controllers loaded (migrations). */
export async function saveIdentifierSystem(row: Record<string, unknown>): Promise<void> {
  const full = completeSystemRow(row)
  await saveDoc('Identifier System', full, 'Administrator', 'insert')
  await sql`update identifier_system set storage = ${String(full.storage)}, display = ${String(full.display)}, tier = ${String(full.tier)}
    where row_id = ${String(full.row_id)}`
}

export function seedPackFile(name: string): string {
  return join(SEEDS, name, 'identifier-systems.json')
}

interface SeedPack {
  pack: string
  identifier_systems?: Record<string, unknown>[]
  sign_in_methods?: Record<string, { identifier_system?: string }>
  people_review?: unknown
}

export interface SeedPackResult {
  added: string[]
  kept: string[]
  methodsLinked: string[]
  peopleReview: 'set' | 'kept'
}

export async function applySeedPack(name: string): Promise<SeedPackResult> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new AppError('ValidationError', `Unknown seed pack "${name}"`)
  const file = seedPackFile(name)
  if (!existsSync(file)) throw new AppError('NotFoundError', `Seed pack ${name} not found (${file})`)
  const pack = JSON.parse(readFileSync(file, 'utf8')) as SeedPack
  const result: SeedPackResult = { added: [], kept: [], methodsLinked: [], peopleReview: 'kept' }
  for (const row of pack.identifier_systems ?? []) {
    const id = String(row.row_id)
    const [have] = await sql`select 1 from identifier_system where row_id = ${id}`
    if (have) {
      result.kept.push(id)
      continue
    }
    await saveIdentifierSystem(row)
    result.added.push(id)
  }
  for (const [method, link] of Object.entries(pack.sign_in_methods ?? {})) {
    if (!link.identifier_system) continue
    const updated = await sql`
      update sign_in_method set identifier_system = ${link.identifier_system}
      where row_id = ${method} and identifier_system is null returning row_id`
    if (updated.length) result.methodsLinked.push(method)
  }
  if (pack.people_review) {
    // Replaces only the core default, never an administrator's own setting.
    const [current] = await sql`select value from single_value where table_name = 'System Settings' and field = 'people_review'`
    if (!current || String(current.value) === CORE_PEOPLE_REVIEW_JSON) {
      await sql`
        insert into single_value (table_name, field, value) values ('System Settings', 'people_review', ${JSON.stringify(pack.people_review)})
        on conflict (table_name, field) do update set value = excluded.value`
      result.peopleReview = 'set'
    }
  }
  return result
}
