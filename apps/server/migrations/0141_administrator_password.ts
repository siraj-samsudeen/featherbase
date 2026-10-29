// The first Administrator's password: ADMIN_PASSWORD, or `admin` on a
// developer's machine or in a test run, and only while the Administrator has
// none (src/admin-bootstrap.ts). An instance installed before the baseline set
// it in 0006, so it records this step as done.
import { bootstrapAdministrator } from '../src/admin-bootstrap'

export async function up() {
  await bootstrapAdministrator()
}
