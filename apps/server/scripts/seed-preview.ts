// Seed a dev-preview deployment: the named user the /preview link signs in
// as, plus a little data so the app is not an empty shell on arrival.
//
// Idempotent by construction, and gated: it runs in the pre-deploy step of
// EVERY environment, so it must converge on a second run and do nothing at
// all where preview sign-in is not configured.
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
import { previewLogin } from '../src/preview'

const FULL_NAME = process.env.PREVIEW_USER_NAME?.trim() || 'Preview Visitor'

async function ensureUser(email: string): Promise<void> {
  const [existing] = await sql`
    select row_id, enabled from "user"
    where lower(row_id) = lower(${email}) or lower(email) = lower(${email})`

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
      row_id: email,
      email,
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
  await setUserPassword(email, randomBytes(24).toString('base64url'))
  console.log(`created preview user ${email} (System Manager, not Administrator)`)
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
  // Gated on the SAME resolution the /preview route uses, because this now
  // runs on every deploy of every environment (see railway.json). A
  // deployment that is not a preview must not grow a preview account: that
  // account exists to be signed into by anyone holding a link, so creating
  // one where no link can work is pure attack surface for no benefit.
  //
  // Deliberately not "default the email and seed anyway" — a default here
  // would put preview@featherbase.dev into production the first time someone
  // wires this release step up.
  const config = previewLogin()
  if (!config) {
    console.log('preview sign-in is not configured here — nothing to seed')
    return
  }
  await ensureUser(config.user)
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
