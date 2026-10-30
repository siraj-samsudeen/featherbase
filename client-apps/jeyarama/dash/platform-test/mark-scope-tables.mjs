// The instance setup step the provider and report tests rely on: it marks the
// old Store Sections Tables `decides_scope`, so Feather Dash's scope provider
// may read them for stores not yet live on the new org chart (a read of an
// unmarked one fails the whole scope closed). The step itself is run on an
// instance from the client's private instance repository; this is the test
// copy of its function, without the command-line wrapper.

/** The Tables today's derivation reads (Feather Dash's provider declares the same six). */
export const SCOPE_TABLES = [
  'Sales Target Assignment',
  'Employee Section Map',
  'Section Ownership',
  'Store Manager',
  'Section Merchandise Map',
  'Section Name Alias',
]

// The parts of a Table's definition a table_def write takes back.
const DEFINITION = ['name', 'label', 'module', 'kind', 'is_submittable', 'id_pattern', 'title_column', 'description', 'columns']

/** `request(path, init)` answers with the parsed JSON body, and throws on an error status. */
export async function markScopeTables(request, tables = SCOPE_TABLES) {
  const outcome = []
  for (const table of tables) {
    const meta = await request(`/api/table/${encodeURIComponent(table)}:meta`)
    if (meta.decides_scope) {
      outcome.push({ table, outcome: 'already marked' })
      continue
    }
    const definition = Object.fromEntries(DEFINITION.filter(key => meta[key] != null).map(key => [key, meta[key]]))
    await request(`/api/table_def/${encodeURIComponent(table)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...definition, decides_scope: true }),
    })
    outcome.push({ table, outcome: 'marked' })
  }
  return outcome
}
