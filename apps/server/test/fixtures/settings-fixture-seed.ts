// Copied into the pinned pre-#465 checkout by settings-fixture-release.test.ts.
// Imports resolve against that checkout's engine, which still accepted
// instance settings as manifest fixtures.
import { installAppFromManifest } from '../../src/apps'
import { saveDoc } from '../../src/document'
import { sql } from '../../src/db'

// An instance manifest of that era: its System Settings as a fixture, the
// shape rama_dw shipped.
await installAppFromManifest({
  name: 'instance_manifest',
  fixtures: [{ table: 'System Settings', rows: [{ app_name: 'Fixture Dash', session_hours: 12, currency: 'INR' }] }],
})
// Then the live instance moved on: an Admin edit after the install, and a
// sign-in method configured by hand.
await saveDoc('System Settings', { app_name: 'Edited In Admin', time_zone: 'Asia/Kolkata' }, 'Administrator')
await sql`update sign_in_method set allowed_email_domains = 'example.com,example.org' where row_id = 'google'`
await sql.end()
