// Run by settings-fixture-release.test.ts with TODAY's code, after the
// release: what a server start does with installed apps, then an uninstall of
// the app the old code installed with a System Settings fixture.
import { loadInstalledApps, uninstallApp } from '../../src/apps'
import { sql } from '../../src/db'

await loadInstalledApps()
await uninstallApp('instance_manifest')
await sql.end()
