// The first Administrator's password: ADMIN_PASSWORD, or `admin` on a
// developer's machine or in a test run, and only while the Administrator has
// none (src/admin-bootstrap.ts). A step of its own because it reads the
// install's variables, which the generated baseline must not depend on.
import { bootstrapAdministrator } from '../src/admin-bootstrap'

export async function up() {
  await bootstrapAdministrator()
}
