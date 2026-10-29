// The Google sign-in method starts enabled where the mock Google provider is
// switched on (ALLOW_MOCK_OAUTH: a developer's machine, the test suites), so it
// can be used at once; elsewhere an administrator enables it with a real client
// id. An instance installed before the baseline made this choice in 0100, so it
// records this step as done.
import { sql } from '../src/db'
import { switchedOn } from '../src/env'

export async function up() {
  if (switchedOn('ALLOW_MOCK_OAUTH')) await sql`update sign_in_method set enabled = true where row_id = 'google'`
}
