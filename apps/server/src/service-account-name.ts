// #1224: how a service account reads, in one place. A leaf with no imports,
// so modules low in the import graph (meta, instance health) can use it.
/** A service account as a reader says it: the name an admin gave it, else
 *  "Automation (<its label, without the svc- prefix>)". The label itself is a
 *  slug other code finds the account by, so it is never renamed for display. */
export function serviceAccountName(account: { label?: unknown; display_name?: unknown }): string {
  const given = String(account.display_name ?? '').trim()
  if (given) return given
  const slug = String(account.label ?? '').trim().replace(/^svc[-_]/, '').replace(/[-_]+/g, ' ').trim()
  return slug ? `Automation (${slug})` : 'Automation'
}
