// Person + linked identities (OpenSpec change `person-identities`, #275):
// email optional, outside sign-ins linked by the provider's permanent subject,
// sign-in methods as Sign In Method rows. The logic lives in src/ so
// `cli identities:plan` can rehearse it in a rolled-back transaction.
import { formatReport, migratePersonIdentities } from '../src/person-identities-migration'

export async function up() {
  console.log(formatReport(await migratePersonIdentities()))
}
