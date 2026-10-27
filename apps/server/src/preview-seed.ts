// Seed a dev-preview deployment: the named person the /preview link signs in
// as, plus a little data so the app is not an empty shell on arrival.
//
// Idempotent by construction, and gated: it runs in the pre-deploy step of
// EVERY environment (pre-deploy.ts), so it must converge on a second run and
// do nothing at all where preview sign-in is not configured.
//
// The person is deliberately NOT Administrator. Administrator is break-glass
// (#130) and preview.ts refuses to hand it out; a preview should show the app
// as an ordinary signed-in person sees it. They ARE given System Manager,
// because creating a Table goes through assertSystemManager — without that
// role the import wizard's whole new-Table path (the file overview, merge
// groups, everything Part A added) refuses, and the preview would show a
// permission wall rather than the feature.
import { sql } from './db'
import type { CommandIO } from './command-io'
import { readVariable } from './env'
import { createTable } from './table-engine'
import { previewLogin } from './preview'
import { ensurePreviewPerson } from './preview-person'

// A Table the import wizard can be pointed at, so "import into an existing
// Table" is reachable on a fresh preview without building one first.
const DEMO_TABLE = 'Store Sections'

async function ensureDemoTable(io: CommandIO): Promise<void> {
  const [existing] = await sql`select 1 from table_def where name = ${DEMO_TABLE}`
  if (existing) {
    io.out(`demo Table ${DEMO_TABLE} already exists — left in place`)
    return
  }
  await createTable({
    name: DEMO_TABLE,
    module: 'Core',
    columns: [
      { column_name: 'zone', label: 'Zone', column_type: 'Data', in_list_view: true },
      { column_name: 'floor', label: 'Floor', column_type: 'Data', in_list_view: true },
      { column_name: 'aisle', label: 'Aisle', column_type: 'Data', in_list_view: true },
      { column_name: 'sku_count', label: 'SKU Count', column_type: 'Int', in_list_view: true },
      { column_name: 'last_audit', label: 'Last Audit', column_type: 'Date' },
    ],
  })
  io.out(`created demo Table ${DEMO_TABLE}`)
}

export async function seedPreview(io: CommandIO): Promise<void> {
  // Gated on the SAME resolution the /preview route uses, because this runs
  // on every deploy of every environment. A deployment that is not a preview
  // must not grow a preview account: that account exists to be signed into
  // by anyone holding a link, so creating one where no link can work is pure
  // attack surface for no benefit.
  //
  // Deliberately not "default the email and seed anyway" — a default here
  // would put a preview account into production the first time someone
  // wires this step up.
  const config = previewLogin()
  if (!config) {
    io.out('preview sign-in is not configured here — nothing to seed')
    return
  }
  await ensurePreviewPerson(config.user, readVariable('PREVIEW_USER_NAME')?.trim() || 'Preview Visitor', io.out)
  await ensureDemoTable(io)
  io.out('preview seed complete')
}
