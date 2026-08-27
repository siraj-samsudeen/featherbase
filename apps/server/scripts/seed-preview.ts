// Seed a dev-preview deployment: the named user the /preview link signs in
// as, plus a little data so the app is not an empty shell on arrival.
//
// Idempotent by construction — it runs on every deploy of the preview
// service, so a second run must converge rather than fail or duplicate.
//
// The user is deliberately NOT Administrator. Administrator is break-glass
// (#130) and preview.ts refuses to hand it out; a preview should show the app
// as an ordinary signed-in person sees it. It IS given System Manager,
// because creating a Table goes through assertSystemManager — without that
// role the import wizard's whole new-Table path (the file overview, merge
// groups, everything Part A added) refuses, and the preview would show a
// permission wall rather than the feature.
import { randomBytes } from 'node:crypto'
import { sql } from '../src/db'
import { saveDoc } from '../src/document'
import { setUserPassword } from '../src/auth'
import { createTable } from '../src/table-engine'

const EMAIL = process.env.PREVIEW_LOGIN_USER?.trim() || 'preview@featherbase.dev'
const FULL_NAME = process.env.PREVIEW_USER_NAME?.trim() || 'Preview Visitor'

async function ensureUser(): Promise<void> {
  if (EMAIL === 'Administrator') throw new Error('PREVIEW_LOGIN_USER must not be Administrator')

  const [existing] = await sql`
    select row_id, enabled from "user"
    where lower(row_id) = lower(${EMAIL}) or lower(email) = lower(${EMAIL})`

  if (existing) {
    // Converge rather than recreate: a re-deploy must not reset a session or
    // strip a role someone added by hand while looking at the preview.
    await sql`update "user" set enabled = true where row_id = ${existing.row_id as string}`
    console.log(`preview user ${existing.row_id as string} already exists — left in place`)
    return
  }

  await saveDoc(
    'User',
    {
      row_id: EMAIL,
      email: EMAIL,
      full_name: FULL_NAME,
      enabled: true,
      roles: [{ role: 'System Manager' }, { role: 'All' }],
    },
    'Administrator',
  )

  // The preview signs in through /preview, so no human ever types this. Give
  // it a random one anyway: an account with no password at all is a different
  // and worse thing to leave lying around, and login() already refuses a
  // password-less account.
  await setUserPassword(EMAIL, randomBytes(24).toString('base64url'))
  console.log(`created preview user ${EMAIL} (System Manager, not Administrator)`)
}

// A Table the import wizard can be pointed at, so "import into an existing
// Table" is reachable on a fresh preview without building one first.
const DEMO_TABLE = 'Store Sections'

async function ensureDemoTable(): Promise<void> {
  const [existing] = await sql`select 1 from table_def where name = ${DEMO_TABLE}`
  if (existing) {
    console.log(`demo Table ${DEMO_TABLE} already exists — left in place`)
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
  console.log(`created demo Table ${DEMO_TABLE}`)
}

async function main() {
  await ensureUser()
  await ensureDemoTable()
  console.log('preview seed complete')
}

main()
  .then(() => sql.end())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('preview seed failed:', err instanceof Error ? err.message : err)
    await sql.end().catch(() => {})
    process.exit(1)
  })
