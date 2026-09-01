// Spec 0007, BUD-R1 (review finding: "one non-closed book per table" was
// check-then-insert, not an invariant). The controller looks the sibling up
// and refuses — but two concurrent creations can both pass that lookup, and
// activeBookFor(... limit 1) then picks one of the two silently, so the
// write-lock's "which book governs this table?" has no single answer.
//
// A partial unique index makes it a database fact. The controller check
// stays: it is what turns the race into a friendly named refusal for the
// common (sequential) case, while this index is what makes the rare one
// impossible rather than merely unlikely.
import { sql } from '../src/db'

export async function up() {
  // Converge an existing checkout that already carries duplicates rather
  // than failing the migration: report them, and let the index creation
  // raise if any genuinely remain.
  const dupes = await sql`
    select ref_table, count(*)::int as n from budget_book
    where lifecycle <> 'closed' group by ref_table having count(*) > 1`
  if (dupes.length)
    throw new Error(
      `cannot add the one-non-closed-book-per-table index: ${dupes
        .map((d) => `${String(d.ref_table)} has ${String(d.n)}`)
        .join('; ')} — close the extras first`,
    )
  await sql.unsafe(
    `create unique index if not exists budget_book_one_open_per_table
     on budget_book (ref_table) where lifecycle <> 'closed'`,
  )
}
